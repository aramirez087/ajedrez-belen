import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:4323';
const read = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual' });
const results = [];

for (const path of ['/prototype', '/api/prototype/sample', '/api/prototype/files/anything', '/api/prototype/receipts/anything']) {
  const response = await read(path);
  assert.equal(response.status, 401, path);
  assert.match(response.headers.get('cache-control'), /no-store/);
  results.push({ path, status: response.status });
}

const deniedMutation = await read('/api/prototype/run', { method: 'POST', headers: { Origin: origin } });
assert.equal(deniedMutation.status, 401);
results.push({ check: 'production build rejects local bypass for writes', status: deniedMutation.status });

const forgedSession = await read('/prototype', { headers: { Cookie: 'wos-session=tampered-session' } });
assert.equal(forgedSession.status, 401);
results.push({ check: 'malformed session rejected', status: forgedSession.status });

const login = await read('/auth/login?returnTo=https://attacker.invalid&organizationId=org_evil');
assert.equal(login.status, 302);
const authorization = new URL(login.headers.get('location'));
assert.equal(authorization.origin, 'https://api.workos.com');
assert.equal(authorization.searchParams.get('client_id'), 'client_compatibility');
assert.equal(authorization.searchParams.get('organization_id'), 'org_compatibility');
assert.equal(authorization.searchParams.get('redirect_uri'), origin + '/auth/callback');
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.ok(authorization.searchParams.get('code_challenge'));
const state = authorization.searchParams.get('state');
assert.ok(state);
const cookie = login.headers.getSetCookie()[0];
assert.match(cookie, /^wos-auth-verifier-/);
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /SameSite=Lax/i);
assert.match(cookie, /Path=\//i);
assert.match(cookie, /Max-Age=600/i);
assert.doesNotMatch(cookie, /Domain=/i);
const name = cookie.split('=')[0];
results.push({ check: 'PKCE generated in compiled workerd', status: login.status, externalRedirectFollowed: false, httpOnly: true, sameSite: 'Lax', ttlSeconds: 600, organizationFixed: true, callbackFixed: true });

const callback = await read('/auth/callback?code=NEVER_EXCHANGED&state=' + encodeURIComponent(state), {
  headers: { Cookie: name + '=tampered-verifier' },
});
assert.equal(callback.status, 400);
const callbackBody = await callback.text();
assert.match(callbackBody, /No fue posible iniciar sesión/);
assert.doesNotMatch(callbackBody, /NEVER_EXCHANGED|tampered-verifier|sk_test|client_compatibility|stack|PKCE/i);
assert.ok(callback.headers.getSetCookie().some(value => value.startsWith(name + '=') && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(value)));
results.push({ check: 'tampered callback fails safely and clears verifier', status: callback.status });

const logoutGet = await read('/auth/logout');
assert.equal(logoutGet.status, 405);
const logoutCrossOrigin = await read('/auth/logout', { method: 'POST', headers: { Origin: 'https://attacker.invalid' } });
assert.equal(logoutCrossOrigin.status, 403);
const logout = await read('/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: 'wos-session=tampered-session' } });
assert.equal(logout.status, 303);
assert.equal(logout.headers.get('location'), '/');
assert.ok(logout.headers.getSetCookie().some(value => value.startsWith('wos-session=') && /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(value)));
results.push({ check: 'logout GET denied; cross-origin denied; local session cleared', get: logoutGet.status, crossOrigin: logoutCrossOrigin.status, sameOrigin: logout.status });

console.log(JSON.stringify({ compiledWorkerChecks: 'passed', results }, null, 2));
