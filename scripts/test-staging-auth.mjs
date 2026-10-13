import assert from 'node:assert/strict';

// Run against an already-running compiled Worker with synthetic local bindings:
// STAGING_AUTH_SETUP=true; portal/prototype/demo/local flags=false;
// EMAIL_MODE=dry_run; OCR_MODE=off; client_fixture/org_fixture/user_fixture;
// WORKOS_REDIRECT_URI=http://127.0.0.1:4325/auth/callback.
// This script never reads credentials or follows a redirect to WorkOS.
const origin = 'http://127.0.0.1:4325';
const callbackUri = `${origin}/auth/callback`;
const fixtureId = '00000000-0000-4000-8000-000000000000';
const forgedCookies = 'wos-session=tampered-session; portal-demo-role=admin; pending-invitation=synthetic';
const results = [];
let requests = 0;

async function request(path, init = {}) {
  const url = new URL(origin + path);
  assert.equal(url.origin, origin, 'Checks must stay on the fixed loopback origin');
  requests++;
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
}

function privateResponse(response, label) {
  assert.match(response.headers.get('cache-control') || '', /(?:^|[,\s])private(?:[,\s]|$)/i, `${label}: private`);
  assert.match(response.headers.get('cache-control') || '', /no-store/i, `${label}: no-store`);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/i, `${label}: no indexing`);
  assert.equal(response.headers.get('x-frame-options'), 'DENY', `${label}: no framing`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${label}: no MIME sniffing`);
}

async function checked(label, run) {
  await run();
  results.push(label);
  console.log(`PASS ${label}`);
}

async function denied(path, method = 'GET', headers = {}) {
  const response = await request(path, { method, headers });
  assert.equal(response.status, 404, `${method} ${path}`);
  privateResponse(response, `${method} ${path}`);
  assert.equal(response.headers.has('location'), false, `${path}: no authentication redirect`);
  assert.equal(response.headers.has('set-cookie'), false, `${path}: no session side effects`);
  const body = await response.text();
  if (method === 'HEAD') assert.equal(body, '', `${path}: HEAD has no response body`);
  else assert.equal(body, 'Not found', `${path}: generic denial before business logic`);
}

function signIn(response) {
  assert.equal(response.status, 302);
  privateResponse(response, 'administrator sign-in');
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin, 'https://api.workos.com');
  assert.equal(url.searchParams.get('client_id'), 'client_fixture');
  assert.equal(url.searchParams.get('organization_id'), 'org_fixture');
  assert.equal(url.searchParams.get('redirect_uri'), callbackUri);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43,128}$/);
  const state = url.searchParams.get('state');
  assert.ok(state, 'PKCE state exists');
  assert.doesNotMatch(url.toString(), /attacker|org_evil|client_evil/);
  const cookies = response.headers.getSetCookie();
  const verifier = cookies.find(value => value.startsWith('wos-auth-verifier-'));
  assert.ok(verifier, 'PKCE verifier cookie exists');
  assert.match(verifier, /HttpOnly/i);
  assert.match(verifier, /SameSite=Lax/i);
  assert.match(verifier, /Path=\//i);
  assert.match(verifier, /Max-Age=600/i);
  assert.doesNotMatch(verifier, /Domain=/i);
  for (const sessionCookie of cookies.filter(value => value.startsWith('wos-session='))) {
    const attributes = sessionCookie.split(';').slice(1).map(value => value.trim());
    const maxAge = attributes.find(value => /^max-age=/i.test(value))?.slice('max-age='.length);
    const expires = attributes.find(value => /^expires=/i.test(value))?.slice('expires='.length);
    // Max-Age takes precedence over Expires. Cleanup is allowed; a live session is not.
    const expired = maxAge !== undefined
      ? /^-?\d+$/.test(maxAge) && Number(maxAge) <= 0
      : expires !== undefined && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= Date.now();
    assert.ok(expired, 'Sign-in start may clear an old session but cannot grant a live session');
  }
  return { state, verifierName: verifier.split('=')[0] };
}

await checked('unauthenticated setup page is private and does not disclose account configuration', async () => {
  for (const cookie of [undefined, forgedCookies]) {
    const response = await request('/auth/setup', { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal(response.status, 200);
    privateResponse(response, '/auth/setup');
    assert.match(response.headers.get('content-type') || '', /text\/html/i);
    const body = await response.text();
    assert.match(body, /Iniciar sesi[oó]n/);
    assert.match(body, /href=["']\/auth\/admin["']/);
    assert.doesNotMatch(body, /client_fixture|org_fixture|user_fixture|tampered-session|WORKOS_API_KEY|WORKOS_COOKIE_PASSWORD|sk_test_/);
    assert.equal(response.headers.has('location'), false);
  }
});

await checked('administrator sign-in ignores injected client, organization and return destinations', async () => {
  for (const query of [
    '',
    '?organization_id=org_evil&organizationId=org_evil&client_id=client_evil',
    '?redirect_uri=https%3A%2F%2Fattacker.invalid%2Fcallback&returnTo=https%3A%2F%2Fattacker.invalid&returnPathname=%2Fadmin',
    '?redirect_uri=%2F%2Fattacker.invalid&organization_id=org_evil&organization_id=org_fixture',
  ]) signIn(await request(`/auth/admin${query}`, { headers: { Cookie: forgedCookies } }));
});

await checked('HEAD preserves setup, sign-in and callback status without response bodies', async () => {
  const setup = await request('/auth/setup', { method: 'HEAD' });
  assert.equal(setup.status, 200);
  privateResponse(setup, 'HEAD setup');
  assert.equal(await setup.text(), '');
  const admin = await request('/auth/admin', { method: 'HEAD' });
  signIn(admin);
  assert.equal(await admin.text(), '');
  const callback = await request('/auth/callback', { method: 'HEAD' });
  assert.equal(callback.status, 400);
  privateResponse(callback, 'HEAD callback');
  assert.equal(await callback.text(), '');
});

await checked('failed callbacks expose only a generic retry to administrator authentication', async () => {
  for (const path of [
    '/auth/callback',
    '/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL',
    '/auth/callback?code=NEVER_EXCHANGED&state=invalid-state',
  ]) {
    const response = await request(path, { headers: { Cookie: forgedCookies } });
    assert.equal(response.status, 400, path);
    privateResponse(response, path);
    assert.equal(response.headers.has('location'), false);
    const body = await response.text();
    assert.match(body, /No fue posible iniciar sesi[oó]n/);
    assert.match(body, /\/auth\/admin/);
    assert.doesNotMatch(body, /PRIVATE_PROVIDER_DETAIL|access_denied|NEVER_EXCHANGED|invalid-state|client_fixture|org_fixture|stack|\/auth\/login|\/portal\/acceso/i);
  }
});

await checked('tampered verifier fails before a provider exchange and clears its pending cookie', async () => {
  const { state, verifierName } = signIn(await request('/auth/admin'));
  const response = await request(`/auth/callback?code=NEVER_EXCHANGED&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: `${verifierName}=tampered-verifier` },
  });
  assert.equal(response.status, 400);
  privateResponse(response, 'tampered verifier');
  const body = await response.text();
  assert.match(body, /\/auth\/admin/);
  assert.doesNotMatch(body, /NEVER_EXCHANGED|tampered-verifier|stack|PKCE/i);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${verifierName}=`) && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(value)));
});

await checked('exact setup endpoints reject every unsupported method', async () => {
  for (const path of ['/auth/admin', '/auth/callback', '/auth/setup', '/auth/logout']) {
    const methods = path === '/auth/logout' ? ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] : ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    for (const method of methods) {
      const response = await request(path, { method, headers: { Origin: origin } });
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('allow'), path === '/auth/logout' ? 'POST' : 'GET, HEAD');
      privateResponse(response, `${method} ${path}`);
      assert.equal(response.headers.has('location'), false);
      assert.equal(response.headers.has('set-cookie'), false);
    }
  }
});

await checked('parent, prototype, business pages and nested paths stay unavailable', async () => {
  const paths = [
    '/auth', '/auth/', '/auth/login', '/auth/parent', '/auth/unknown',
    '/login', '/login/', '/login/nested', '/%6Cogin',
    '/portal', '/portal/', '/portal/acceso', '/portal/invitacion?token=synthetic',
    `/portal/comprobantes/${fixtureId}`, '/admin', '/admin/', '/admin/alumnos',
    '/prototype', '/prototype/nested', '/demo', '/demo/nested',
  ];
  for (const path of paths) {
    await denied(path, 'GET', { Cookie: forgedCookies });
    await denied(path, 'HEAD');
    await denied(path, 'POST', { Origin: origin, Cookie: forgedCookies });
  }
});

await checked('trailing, encoded, case and nested auth paths cannot expand the route allowlist', async () => {
  for (const path of [
    '/auth/admin/', '/auth/callback/', '/auth/setup/', '/auth/logout/',
    '/auth/admin/nested', '/auth/callback/nested', '/auth/setup/nested', '/auth/logout/nested',
    '/auth//admin', '/auth/%61dmin', '/auth/admin%2F', '/auth/admin%3Fignored',
    '/Auth/admin', '/auth/Admin', '/auth/Setup', '/auth/parent/nested',
  ]) await denied(path, 'GET', { Cookie: forgedCookies });
});

await checked('every current API route and unknown API paths are blocked before reads or mutations', async () => {
  const paths = [
    '/api', '/api/', '/api/unknown', '/api/auth/setup',
    '/api/prototype', '/api/prototype/run', '/api/prototype/email', '/api/prototype/sample',
    `/api/prototype/files/${fixtureId}`, `/api/prototype/receipts/${fixtureId}`,
    '/api/admin', '/api/admin/charges', '/api/admin/links', '/api/admin/export?kind=payments',
    '/api/admin/email', '/api/admin/invitations', '/api/admin/athletes',
    `/api/admin/athletes/${fixtureId}`, `/api/admin/payments/${fixtureId}/review`, '/api/admin/slips/cleanup',
    '/api/portal', '/api/portal/invitations/redeem', `/api/portal/files/${fixtureId}`,
    '/api/portal/demo', '/api/portal/payments', `/api/portal/payments/${fixtureId}/revise`,
    '/api/portal/slips', `/api/portal/slips/${fixtureId}/extract`, '/api/portal/unknown/nested',
  ];
  for (const path of paths) {
    await denied(path, 'GET', { Cookie: forgedCookies });
    await denied(path, 'HEAD');
    await denied(path, 'POST', { Origin: origin, Cookie: forgedCookies });
  }
});

await checked('logout rejects missing, malformed and unrelated origins', async () => {
  for (const value of [undefined, 'null', 'https://attacker.invalid', 'http://127.0.0.1:4326', `${origin}/path`, 'malformed']) {
    const response = await request('/auth/logout', {
      method: 'POST', headers: { ...(value === undefined ? {} : { Origin: value }), Cookie: forgedCookies },
    });
    assert.equal(response.status, 403, `Origin ${value ?? '(missing)'}`);
    if (value === undefined || response.headers.has('cache-control')) {
      privateResponse(response, 'denied logout');
    } else {
      // Astro's origin-check middleware rejects form-like cross-origin POSTs
      // before application middleware can add private headers. Its exact generic
      // response must contain no provider, session or configuration details.
      assert.notEqual(value, origin);
      assert.match(response.headers.get('content-type') || '', /text\/plain/i);
      assert.equal(await response.text(), 'Cross-site POST form submissions are forbidden');
    }
    assert.equal(response.headers.has('location'), false);
    assert.equal(response.headers.has('set-cookie'), false, 'CSRF failure does not alter session cookies');
  }
});

await checked('same-origin logout with no verified session clears cookies and returns only to root', async () => {
  for (const cookie of [undefined, forgedCookies]) {
    const response = await request('/auth/logout?returnTo=https%3A%2F%2Fattacker.invalid', {
      method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    assert.equal(response.status, 303);
    privateResponse(response, 'local logout');
    assert.equal(response.headers.get('location'), '/');
    assert.ok(response.headers.getSetCookie().some(value => value.startsWith('wos-session=') && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(value)));
  }
});

console.log(JSON.stringify({
  runtime: 'local compiled workerd', checks: results.length, requests,
  verified: 'Staging setup route isolation, local PKCE start and failure handling only. No redirect followed, successful provider login, live email, database mutation or cloud performance test.',
}, null, 2));
