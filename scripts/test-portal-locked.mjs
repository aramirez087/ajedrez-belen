import assert from 'node:assert/strict';

// Run only against a local compiled Worker with synthetic WorkOS configuration.
// Every fetch uses manual redirects; authorization URLs are inspected, never followed.
const base = new URL(process.env.PORTAL_TEST_URL || 'http://127.0.0.1:4323');
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'Production guard checks only target a local compiled Worker');
assert.ok(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
  'PORTAL_TEST_URL must be an HTTP loopback origin');

const expectedClientId = process.env.PORTAL_TEST_WORKOS_CLIENT_ID || 'client_fixture';
const expectedOrganizationId = process.env.PORTAL_TEST_WORKOS_ORGANIZATION_ID || 'org_fixture';
const expectedCallback = process.env.PORTAL_TEST_WORKOS_REDIRECT_URI || new URL('/auth/callback', base).toString();
const forgedCookie = 'portal-demo-role=admin';
const fixtureId = '00000000-0000-4000-8000-000000000000';
const extractionPath = `/api/portal/slips/${fixtureId}/extract`;
const ocrMutationPaths = ['/api/portal/slips', extractionPath, '/api/admin/slips/cleanup'];
// A valid synthetic PNG avoids mistaking body-validation failure for authorization.
const syntheticPng = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=',
  'base64',
));
let checks = 0;
const request = (path, init = {}) => fetch(new URL(path, base), {
  ...init,
  headers: { cookie: forgedCookie, ...init.headers },
  redirect: 'manual',
});
function privateResponse(response, path) {
  assert.match(response.headers.get('cache-control') || '', /no-store/, `${path} is private`);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/, `${path} is not indexed`);
}
async function checked(label, run) {
  await run();
  checks++;
  console.log(`PASS ${label}`);
}

await checked('forged development administrator cookie cannot open private pages', async () => {
  for (const path of ['/portal', '/admin', `/portal/comprobantes/${fixtureId}`]) {
    const response = await request(path);
    assert.ok([401, 403].includes(response.status) ||
      (response.status === 302 && response.headers.get('location') === '/portal/acceso'),
    `${path}: expected authentication denial, received ${response.status}`);
    privateResponse(response, path);
  }
});

await checked('exports and raw private files reject the forged administrator cookie', async () => {
  for (const path of ['/api/admin/export?kind=payments', `/api/portal/files/${fixtureId}`]) {
    const response = await request(path);
    assert.equal(response.status, 401, `${path}: ${response.status}`);
    privateResponse(response, path);
  }
});

await checked('compiled Worker never enables demo routes, even with both portal flags true', async () => {
  const page = await request('/demo');
  assert.equal(page.status, 404);
  privateResponse(page, '/demo');
  const mutation = await request('/api/portal/demo', { method: 'POST',
    headers: { origin: base.origin }, body: new URLSearchParams({ role: 'admin' }) });
  assert.equal(mutation.status, 404);
  privateResponse(mutation, '/api/portal/demo');
});

await checked('same-origin payment and review mutations still require authenticated identity', async () => {
  for (const path of ['/api/portal/payments', `/api/admin/payments/${fixtureId}/review`, '/api/admin/email']) {
    const response = await request(path, { method: 'POST', headers: { origin: base.origin },
      body: new URLSearchParams({ action: 'approve', bankChecked: 'on', role: 'admin' }) });
    assert.equal(response.status, 401, `${path}: ${response.status}`);
    privateResponse(response, path);
  }
});

await checked('OCR original upload, extraction and cleanup require authenticated identity before work begins', async () => {
  const original = new FormData();
  original.set('slip', new Blob([syntheticPng], { type: 'image/png' }), 'synthetic-original.png');
  const extraction = new FormData();
  extraction.set('ocrImage', new Blob([syntheticPng], { type: 'image/png' }), 'synthetic-page.png');
  const bodies = [original, extraction, new URLSearchParams()];
  for (let index = 0; index < ocrMutationPaths.length; index++) {
    const path = ocrMutationPaths[index];
    const response = await request(path, { method: 'POST',
      headers: { origin: base.origin, accept: 'application/json' }, body: bodies[index] });
    assert.equal(response.status, 401, `${path}: expected authentication denial, received ${response.status}`);
    privateResponse(response, path);
    assert.ok(!response.headers.has('location'), `${path} does not redirect to a provider`);
    assert.equal(await response.text(), 'Authentication required');
  }
});

await checked('compiled OCR does not trust demo cookies or caller-supplied identity and mode overrides', async () => {
  for (const role of ['admin', 'parent-a', 'parent-b']) {
    const form = new URLSearchParams({
      role, mode: 'demo', OCR_MODE: 'demo', demoAllowed: 'true',
      userId: `demo-${role}`, isAdmin: 'true',
    });
    const response = await request(`${extractionPath}?mode=demo&demoAllowed=true`, {
      method: 'POST', headers: { origin: base.origin, accept: 'application/json',
        cookie: `portal-demo-role=${role}` }, body: form,
    });
    assert.equal(response.status, 401, `Forged ${role} must not obtain a demo extraction`);
    privateResponse(response, extractionPath);
    assert.equal(await response.text(), 'Authentication required');
  }
});

await checked('compiled mutation guard rejects missing and unrelated origins', async () => {
  for (const path of ['/api/portal/payments', ...ocrMutationPaths]) {
    for (const headers of [{}, { origin: 'https://unrelated.example' }]) {
      const response = await request(path, { method: 'POST', headers,
        body: new URLSearchParams({ role: 'admin', mode: 'demo' }) });
      assert.equal(response.status, 403, `${path} rejects missing or unrelated origin`);
      if (response.headers.has('cache-control')) {
        privateResponse(response, path);
      } else {
        // Astro rejects cross-site form posts before application middleware runs.
        // Its generic response contains no private record or authentication data.
        assert.equal(headers.origin, 'https://unrelated.example');
        assert.equal(await response.text(), 'Cross-site POST form submissions are forbidden');
      }
    }
  }
});

function authorizationUrl(response, path) {
  assert.equal(response.status, 302, `${path}: synthetic configuration enables the local PKCE start`);
  privateResponse(response, path);
  const location = response.headers.get('location');
  assert.ok(location, 'Authorization redirect exists');
  const url = new URL(location);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'api.workos.com');
  assert.equal(url.searchParams.get('client_id'), expectedClientId);
  assert.equal(url.searchParams.get('redirect_uri'), expectedCallback);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(url.searchParams.get('state'));
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
  return url;
}

await checked('parent login uses the fixed callback without requesting administrator organization', async () => {
  const path = '/auth/parent?organization_id=org_attacker&redirect_uri=https%3A%2F%2Funrelated.example%2Fcallback';
  const url = authorizationUrl(await request(path), path);
  assert.equal(url.searchParams.has('organization_id'), false);
});

await checked('administrator login fixes its organization and ignores caller overrides', async () => {
  const path = '/auth/admin?organization_id=org_attacker&client_id=client_attacker&returnTo=https%3A%2F%2Funrelated.example';
  const url = authorizationUrl(await request(path), path);
  assert.equal(url.searchParams.get('organization_id'), expectedOrganizationId);
  assert.ok(!url.toString().includes('org_attacker') && !url.toString().includes('client_attacker'));
});

await checked('failed portal callbacks return to the portal login choice without exposing provider details', async () => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL']) {
    const response = await request(path);
    assert.equal(response.status, 400);
    privateResponse(response, path);
    const body = await response.text();
    assert.match(body, /Vuelva a \/portal\/acceso/);
    assert.doesNotMatch(body, /\/auth\/login|PRIVATE_PROVIDER_DETAIL|access_denied|stack/i);
    assert.equal(response.headers.has('location'), false);
  }
});

console.log(JSON.stringify({ runtime: 'local compiled workerd', checks,
  verified: 'Production authorization and OCR guards plus local PKCE start only; no login exchange, extraction provider request, delivery, or cloud performance check.' }, null, 2));
