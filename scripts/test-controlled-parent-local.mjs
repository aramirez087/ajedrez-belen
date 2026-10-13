import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

// Deliberately fixed loopback target. Never accepts a host, cookie, token or provider URL.
const origin = 'http://127.0.0.1:4328';
const results = [];
async function request(path, options = {}) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  const response = await fetch(origin + path, { ...options, redirect: 'manual' });
  const body = await response.text();
  const frameworkCsrfDenial = options.method === 'POST' && options.headers?.Origin === 'https://wrong.example.invalid' &&
    response.status === 403 && body === 'Cross-site POST form submissions are forbidden';
  if (!frameworkCsrfDenial) assert.match(response.headers.get('cache-control') || '', /private, no-store/, `Private headers missing: ${path.split('?')[0]} (${response.status})`);
  results.push({ path: path.split('?')[0], method: options.method || 'GET', status: response.status,
    ...(frameworkCsrfDenial ? { boundary: 'Astro origin check before application middleware' } : {}) });
  return { response, body };
}

const start = await request('/auth/parent?login_hint=wrong@example.invalid&organization_id=org_wrong&returnTo=https://wrong.example.invalid');
assert.equal(start.response.status, 302);
const authorization = new URL(start.response.headers.get('location'));
assert.equal(authorization.origin, 'https://api.workos.com');
assert.equal(authorization.searchParams.has('login_hint'), false);
assert.equal(authorization.searchParams.get('screen_hint'), 'sign-up');
assert.equal(authorization.searchParams.get('redirect_uri'), origin + '/auth/callback');
assert.equal(authorization.searchParams.has('organization_id'), false);
assert.ok(authorization.searchParams.get('code_challenge'));
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.match(start.response.headers.get('set-cookie') || '', /HttpOnly/i);
assert.match(start.response.headers.get('set-cookie') || '', /SameSite=Lax/i);
assert.equal((await request('/portal')).response.headers.get('location'), '/auth/parent');
assert.equal((await request('/admin')).response.headers.get('location'), '/auth/admin');

for (const [path, status] of [
  ['/portal', 302], ['/admin', 302], ['/api/admin/export?format=csv', 401],
  ['/api/portal/files/foreign_fixture', 401], ['/portal/acceso', 404],
  ['/portal/invitacion', 404], ['/api/admin/invitations', 404],
  ['/api/portal/invitations/redeem', 404], ['/api/admin/email', 404],
  ['/demo', 404], ['/prototype', 404], ['/auth/%70arent', 404],
  ['/auth//parent', 404], ['/auth/parent/nested', 404],
  ['/auth/callback?error=synthetic_cancelled&state=synthetic', 400],
]) assert.equal((await request(path)).response.status, status, path);
assert.equal((await request('/auth/parent', { method: 'POST', headers: { Origin: origin } })).response.status, 405);
assert.equal((await request('/auth/logout', { method: 'POST', headers: { Origin: 'https://wrong.example.invalid' } })).response.status, 403);

const evidence = { status: 'passed', checks: results.length, providerRedirectsFollowed: 0,
  hostedIdentityOrCookieUsed: false, target: origin, results };
writeFileSync(new URL('../output/controlled-parent-local-http.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
console.log(`Passed ${results.length} loopback HTTP checks; no provider redirect followed.`);
