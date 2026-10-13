import assert from 'node:assert/strict';

// Test an already-running compiled local Worker with synthetic WorkOS bindings:
// STAGING_AUTH_SETUP=true, STAGING_PORTAL_TEST=true, PORTAL_ENABLED=true;
// PORTAL_DEMO=false, PROTOTYPE_ENABLED=false, PROTOTYPE_LOCAL=false;
// EMAIL_MODE=dry_run, OCR_MODE=off, client_fixture/org_fixture/user_fixture;
// WORKOS_REDIRECT_URI=http://127.0.0.1:4325/auth/callback.
// No valid session, credential reads, auth bypass, record creation or redirect following.
const origin = 'http://127.0.0.1:4325';
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

function noLiveSession(response) {
  for (const cookie of response.headers.getSetCookie().filter(value => value.startsWith('wos-session='))) {
    const attributes = cookie.split(';').slice(1).map(value => value.trim());
    const maxAge = attributes.find(value => /^max-age=/i.test(value))?.slice('max-age='.length);
    const expires = attributes.find(value => /^expires=/i.test(value))?.slice('expires='.length);
    const expired = maxAge !== undefined
      ? /^-?\d+$/.test(maxAge) && Number(maxAge) <= 0
      : expires !== undefined && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= Date.now();
    assert.ok(expired, 'An unauthenticated request must never receive a live session');
  }
}

async function checked(label, run) {
  await run();
  results.push(label);
  console.log(`PASS ${label}`);
}

async function hidden(path, method = 'GET') {
  const response = await request(path, { method, headers: { Origin: origin, Cookie: forgedCookies } });
  assert.equal(response.status, 404, `${method} ${path}`);
  privateResponse(response, path);
  assert.equal(response.headers.has('location'), false);
  assert.equal(response.headers.has('set-cookie'), false, 'Hidden routes do not process authentication');
  assert.equal(await response.text(), method === 'HEAD' ? '' : 'Not found');
}

async function authenticationRequired(path, method, cookie) {
  const response = await request(path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  const navigation = ['GET', 'HEAD'].includes(method) && !path.startsWith('/api/');
  assert.equal(response.status, navigation ? 302 : 401, `${method} ${path}`);
  privateResponse(response, path);
  noLiveSession(response);
  if (navigation) assert.equal(response.headers.get('location'), '/auth/admin');
  else assert.equal(response.headers.has('location'), false, 'API/mutation denial does not redirect');
  const body = await response.text();
  if (method === 'HEAD') assert.equal(body, '');
  assert.doesNotMatch(body, /client_fixture|org_fixture|user_fixture|tampered-session|D1_ERROR|SQLITE|BREVO_API_KEY|WORKOS_API_KEY|stack trace/i);
}

async function originDenied(path, requestOrigin) {
  const response = await request(path, { method: 'POST', headers: {
    Cookie: forgedCookies, ...(requestOrigin === undefined ? {} : { Origin: requestOrigin }),
  } });
  assert.equal(response.status, 403, `${path}: Origin ${requestOrigin ?? '(missing)'}`);
  assert.equal(response.headers.has('location'), false);
  assert.equal(response.headers.has('set-cookie'), false, 'CSRF rejection must not change cookies');
  if (requestOrigin === undefined || response.headers.has('cache-control')) {
    privateResponse(response, path);
  } else {
    // Astro may reject form-like POSTs before our middleware adds private headers.
    // Accept only its exact generic response, never an arbitrary unprotected error.
    assert.notEqual(requestOrigin, origin);
    assert.match(response.headers.get('content-type') || '', /text\/plain/i);
    assert.equal(await response.text(), 'Cross-site POST form submissions are forbidden');
  }
}

function signIn(response) {
  assert.equal(response.status, 302);
  privateResponse(response, 'administrator sign-in');
  noLiveSession(response);
  const authorization = new URL(response.headers.get('location'));
  assert.equal(authorization.origin, 'https://api.workos.com');
  assert.equal(authorization.searchParams.get('client_id'), 'client_fixture');
  assert.equal(authorization.searchParams.get('organization_id'), 'org_fixture');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43,128}$/);
  assert.ok(authorization.searchParams.get('state'));
  assert.doesNotMatch(authorization.toString(), /attacker|client_evil|org_evil/);
  const verifier = response.headers.getSetCookie().find(value => value.startsWith('wos-auth-verifier-'));
  assert.ok(verifier);
  assert.match(verifier, /HttpOnly/i);
  assert.match(verifier, /SameSite=Lax/i);
  assert.match(verifier, /Max-Age=600/i);
  assert.doesNotMatch(verifier, /Domain=/i);
  return { state: authorization.searchParams.get('state'), verifierName: verifier.split('=')[0] };
}

await checked('public landing remains available while setup remains private and unauthenticated', async () => {
  for (const method of ['GET', 'HEAD']) {
    const landing = await request('/', { method });
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get('x-robots-tag') || '', /noindex/i);
    const setup = await request('/auth/setup', { method, headers: { Cookie: forgedCookies } });
    assert.equal(setup.status, 200);
    privateResponse(setup, '/auth/setup');
    noLiveSession(setup);
    const body = await setup.text();
    if (method === 'HEAD') assert.equal(body, '');
    else {
      assert.match(body, /Iniciar sesi[oó]n/);
      assert.match(body, /href=["']\/auth\/admin["']/);
      assert.doesNotMatch(body, /client_fixture|org_fixture|user_fixture|tampered-session|WORKOS_API_KEY/);
    }
  }
});

await checked('setup sign-in retains fixed organization, callback and PKCE despite caller overrides', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await request('/auth/admin?organization_id=org_evil&client_id=client_evil&redirect_uri=https%3A%2F%2Fattacker.invalid&returnPathname=%2Fportal', {
      method, headers: { Cookie: forgedCookies },
    });
    signIn(response);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
});

await checked('failed and tampered callbacks remain generic and never redirect into the portal', async () => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL']) {
    const response = await request(path);
    assert.equal(response.status, 400);
    privateResponse(response, path);
    noLiveSession(response);
    assert.equal(response.headers.has('location'), false);
    const body = await response.text();
    assert.match(body, /\/auth\/admin/);
    assert.doesNotMatch(body, /PRIVATE_PROVIDER_DETAIL|access_denied|client_fixture|org_fixture|stack|\/auth\/login/i);
  }
  const { state, verifierName } = signIn(await request('/auth/admin'));
  const response = await request(`/auth/callback?code=NEVER_EXCHANGED&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: `${verifierName}=tampered-verifier` },
  });
  assert.equal(response.status, 400);
  privateResponse(response, 'tampered callback');
  noLiveSession(response);
  assert.equal(response.headers.has('location'), false);
  assert.doesNotMatch(await response.text(), /NEVER_EXCHANGED|tampered-verifier|stack|PKCE/i);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`${verifierName}=`) && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(value)));
});

await checked('auth endpoints retain exact method allowlists', async () => {
  for (const path of ['/auth/admin', '/auth/callback', '/auth/setup', '/auth/logout']) {
    const methods = path === '/auth/logout' ? ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] : ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    for (const method of methods) {
      const response = await request(path, { method, headers: { Origin: origin } });
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('allow'), path === '/auth/logout' ? 'POST' : 'GET, HEAD');
      privateResponse(response, path);
      assert.equal(response.headers.has('location'), false);
      assert.equal(response.headers.has('set-cookie'), false);
    }
  }
});

await checked('business navigation requires owner authentication even with forged development cookies', async () => {
  for (const path of ['/admin', '/admin/familias', '/admin/mensualidades', '/admin/comprobantes', `/admin/pagos/${fixtureId}`,
    '/portal', '/portal/pagos/nuevo', `/portal/pagos/${fixtureId}`, `/portal/comprobantes/${fixtureId}`, '/portal/unknown/nested']) {
    for (const cookie of [undefined, forgedCookies]) {
      for (const method of ['GET', 'HEAD', 'POST']) await authenticationRequired(path, method, cookie);
    }
  }
});

await checked('all admitted business APIs reject unauthenticated reads and mutations before handlers', async () => {
  const paths = [
    '/api/admin', '/api/admin/charges', '/api/admin/links', '/api/admin/export?kind=payments',
    '/api/admin/athletes', `/api/admin/athletes/${fixtureId}`, `/api/admin/payments/${fixtureId}/review`,
    '/api/admin/slips/cleanup', '/api/admin/unknown/nested',
    '/api/portal', `/api/portal/files/${fixtureId}`, '/api/portal/payments',
    `/api/portal/payments/${fixtureId}/revise`, '/api/portal/slips', `/api/portal/slips/${fixtureId}/extract`,
    '/api/portal/unknown/nested',
  ];
  for (const path of paths) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      await authenticationRequired(path, method, forgedCookies);
    }
  }
});

await checked('family invitation, mail processing, prototype and alternate login routes remain hidden', async () => {
  const paths = [
    '/login', '/login/nested', '/auth', '/auth/', '/auth/login', '/auth/parent', '/auth/unknown',
    '/portal/acceso', '/portal/acceso/nested', '/portal/invitacion?token=synthetic', '/portal/invitacion/nested',
    '/api/admin/invitations', '/api/admin/invitations/nested', '/api/portal/invitations/redeem',
    '/api/portal/invitations/redeem/nested', '/api/admin/email', '/api/admin/email/nested',
    '/api/portal/demo', '/api/portal/demo/nested', '/prototype', '/prototype/nested', '/demo', '/demo/nested',
    '/api/prototype', '/api/prototype/run', '/api/prototype/email', '/api/prototype/sample',
    `/api/prototype/files/${fixtureId}`, `/api/prototype/receipts/${fixtureId}`, '/api', '/api/unknown',
  ];
  for (const path of paths) for (const method of ['GET', 'HEAD', 'POST']) await hidden(path, method);
});

await checked('encoded, repeated-slash and alternate-case paths cannot widen restricted access', async () => {
  for (const path of [
    '/auth/admin/', '/auth/callback/', '/auth/setup/', '/auth/logout/', '/auth/admin/nested',
    '/auth/%61dmin', '/auth//admin', '/Auth/admin', '/auth/Admin', '/Login', '/login%2F',
    '/%6Cogin', '/%61dmin', '/api%2Fportal/payments', '/auth%2Fadmin',
    '/portal//pagos', '/portal/%70agos/nuevo', '/portal/invitacion%2F', '/Portal',
    '/admin//familias', '/admin/%66amilias', '/Admin', '/api/admin/%65mail',
    '/api/admin//email', '/api/portal/invitations/redeem%2F', '/api/portal//payments', '/api/Portal/payments',
  ]) await hidden(path);
});

await checked('business mutations and logout reject missing, malformed and foreign origins', async () => {
  for (const path of ['/api/admin/charges', '/api/admin/links', `/api/admin/payments/${fixtureId}/review`,
    '/api/portal/payments', '/api/portal/slips', '/portal/pagos/nuevo', '/auth/logout']) {
    for (const value of [undefined, 'null', 'https://attacker.invalid', 'http://127.0.0.1:4326', `${origin}/path`, 'malformed']) {
      await originDenied(path, value);
    }
  }
});

await checked('unauthenticated logout clears only local session and ignores external return destinations', async () => {
  for (const cookie of [undefined, forgedCookies]) {
    const response = await request('/auth/logout?returnTo=https%3A%2F%2Fattacker.invalid', {
      method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    assert.equal(response.status, 303);
    privateResponse(response, 'logout');
    noLiveSession(response);
    assert.equal(response.headers.get('location'), '/');
    assert.ok(response.headers.getSetCookie().some(value => value.startsWith('wos-session=')));
  }
});

console.log(JSON.stringify({
  runtime: 'local compiled workerd', checks: results.length, requests,
  verified: 'Unauthenticated owner-only staging boundaries and local PKCE failure paths. No valid login, record creation, live mail, provider redirect or authenticated financial workflow exercised.',
}, null, 2));
