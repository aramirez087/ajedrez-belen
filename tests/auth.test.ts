import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
import { getAuthConfigurationStatus, getIdentity, isSameOriginMutation } from '../src/lib/auth.ts';
import { appendAuthHeaders, getAuthService } from '../src/lib/workos-runtime.ts';

const environment = {
  WORKOS_API_KEY: 'sk_test_fixture',
  WORKOS_CLIENT_ID: 'client_fixture',
  WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-password-of-sufficient-length',
  WORKOS_REDIRECT_URI: 'https://example.test/auth/callback',
  WORKOS_ORGANIZATION_ID: 'org_association',
  ADMIN_USER_IDS: 'user_treasurer, user_other',
};

function context(overrides: Record<string, unknown> = {}): Pick<APIContext, 'locals'> {
  // Only model the verified SDK fields that the application policy consumes.
  return { locals: { auth: {
    user: { id: 'user_treasurer', email: 'treasurer@example.test' },
    sessionId: 'session_fixture',
    accessToken: 'verified-by-sdk-before-this-policy',
    organizationId: 'org_association',
    impersonator: null,
    ...overrides,
  } } } as unknown as Pick<APIContext, 'locals'>;
}

test('missing or invalid credentials fail closed and status never contains credential values', () => {
  const empty = getAuthConfigurationStatus({});
  assert.equal(empty.configured, false);
  assert.equal(empty.adminConfigured, false);
  assert.ok(empty.missing.includes('WORKOS_API_KEY'));
  assert.equal(getIdentity(context(), {}), null);
  const configured = getAuthConfigurationStatus(environment);
  assert.equal(configured.configured, true);
  assert.equal(configured.adminConfigured, true);
  for (const value of Object.values(environment)) {
    assert.equal(JSON.stringify(configured).includes(value), false);
  }
  assert.equal(getAuthConfigurationStatus({ ...environment, WORKOS_COOKIE_PASSWORD: 'short' }).configured, false);
});

test('callback settings require the exact callback path and HTTPS outside loopback', () => {
  for (const uri of [
    'http://example.test/auth/callback',
    'https://example.test/callback',
    'https://example.test/auth/callback?redirect=elsewhere',
    'https://example.test/auth/callback#fragment',
    'https://user:pass@example.test/auth/callback',
    'not-a-url',
  ]) {
    assert.equal(getAuthConfigurationStatus({ ...environment, WORKOS_REDIRECT_URI: uri }).configured, false, uri);
  }
  assert.equal(getAuthConfigurationStatus({ ...environment, WORKOS_REDIRECT_URI: 'http://localhost:4321/auth/callback' }).configured, true);
});

test('a user needs a verified session and the association organization', () => {
  assert.equal(getIdentity(context({ user: null }), environment), null);
  assert.equal(getIdentity(context({ accessToken: undefined }), environment), null);
  assert.equal(getIdentity(context({ sessionId: undefined }), environment), null);
  assert.equal(getIdentity(context({ organizationId: null }), environment), null);
  assert.equal(getIdentity(context({ organizationId: 'org_elsewhere' }), environment), null);
});

test('an exact allowlisted WorkOS user ID grants admin only in the association', () => {
  assert.deepEqual(getIdentity(context(), environment), {
    userId: 'user_treasurer',
    email: 'treasurer@example.test',
    organizationId: 'org_association',
    isAdmin: true,
  });
  assert.equal(getIdentity(context(), { ...environment, ADMIN_USER_IDS: 'user_treasurer_extra' })?.isAdmin, false);
  assert.equal(getIdentity(context(), { ...environment, ADMIN_USER_IDS: '' })?.isAdmin, false);
});

test('an email match or an admin role does not substitute for an allowed user ID', () => {
  const identity = getIdentity(context({
    user: { id: 'user_unlisted', email: 'treasurer@example.test' },
    role: 'admin',
    roles: ['admin'],
  }), environment);
  assert.equal(identity?.isAdmin, false);
});

test('an impersonated session cannot perform administrative work', () => {
  assert.equal(getIdentity(context({ impersonator: { email: 'support@example.test' } }), environment)?.isAdmin, false);
});

test('cookie-authenticated mutations require an exact same-origin header', () => {
  const request = (origin?: string, method = 'POST') => new Request('https://example.test/api/prototype/verify', {
    method,
    headers: origin ? { Origin: origin } : {},
  });
  assert.equal(isSameOriginMutation(request('https://example.test')), true);
  for (const origin of [undefined, 'null', 'https://attacker.test', 'http://example.test', 'https://example.test:8080', 'https://example.test/path', 'malformed']) {
    assert.equal(isSameOriginMutation(request(origin)), false, origin);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(isSameOriginMutation(request(undefined, method)), false);
  }
  assert.equal(isSameOriginMutation(request(undefined, 'GET')), true);
  assert.equal(isSameOriginMutation(request(undefined, 'HEAD')), true);
});

test('the installed SDK builds a PKCE login and private verifier cookie without an account or network', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('The compatibility test must not contact a live service.');
  });
  assert.equal(getAuthService({}), null);
  const service = getAuthService(environment)!;

  const writes: { name: string; options: Record<string, unknown> }[] = [];
  const cookies = {
    get: () => undefined,
    set: (name: string, _value: string, options: Record<string, unknown>) => { writes.push({ name, options }); },
    delete: () => undefined,
  };
  const { url: loginUrl } = await service.createSignIn(
    cookies as unknown as APIContext['cookies'],
    { organizationId: environment.WORKOS_ORGANIZATION_ID, returnPathname: '/prototype' },
  );
  const url = new URL(loginUrl);

  assert.equal(url.origin, 'https://api.workos.com');
  assert.equal(url.searchParams.get('client_id'), environment.WORKOS_CLIENT_ID);
  assert.equal(url.searchParams.get('organization_id'), environment.WORKOS_ORGANIZATION_ID);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(writes.length, 1);
  assert.ok(writes[0].name.startsWith('wos-auth-verifier-'));
  assert.equal(writes[0].options.httpOnly, true);
  assert.equal(writes[0].options.secure, true);
  assert.equal(writes[0].options.sameSite, 'lax');
  assert.equal(network.mock.callCount(), 0);
});

test('runtime adapter rejects tampered PKCE and session cookies without calling WorkOS', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Tampered cookies must not contact a live service.');
  });
  const service = getAuthService(environment)!;
  const values = new Map<string, string>();
  const cookies = {
    get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined,
    set: (name: string, value: string) => values.set(name, value),
    delete: (name: string) => values.delete(name),
  } as unknown as APIContext['cookies'];
  const { url, cookieName } = await service.createSignIn(cookies, { returnPathname: '/prototype' });
  values.set(cookieName, 'tampered-verifier');
  await assert.rejects(service.handleCallback(cookies, cookies, {
    code: 'never-exchanged', state: new URL(url).searchParams.get('state')!,
  }));
  assert.equal(values.has(cookieName), false);
  values.set('wos-session', 'tampered-session');
  assert.deepEqual((await service.withAuth(cookies)).auth, { user: null });
  assert.equal(network.mock.callCount(), 0);
});

test('runtime adapter persists refreshed cookies and preserves separate logout cookie headers', async () => {
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const cookies = {
    get: () => undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => writes.push({ name, value, options }),
    delete: () => undefined,
  } as unknown as APIContext['cookies'];
  const service = getAuthService(environment)!;
  await service.saveSession(cookies, 'synthetic-refreshed-session');
  assert.equal(writes[0].name, 'wos-session');
  assert.equal(writes[0].value, 'synthetic-refreshed-session');
  assert.equal(writes[0].options.httpOnly, true);
  assert.equal(writes[0].options.maxAge, 8 * 60 * 60);

  const signedOut = await service.signOut('session_fixture', { returnTo: 'https://example.test/' });
  const response = appendAuthHeaders(new Response(null, { status: 303 }), signedOut.headers);
  assert.match(response.headers.getSetCookie()[0], /wos-session=/);
  assert.match(response.headers.getSetCookie()[0], /Max-Age=0/i);
  const multiple = appendAuthHeaders(new Response(), { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] });
  assert.equal(multiple.headers.getSetCookie().length, 2);
});
