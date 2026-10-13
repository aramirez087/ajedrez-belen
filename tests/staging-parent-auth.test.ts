import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { APIContext } from 'astro';
import type { getAuthService } from '../src/lib/workos-runtime.ts';
import { authorizePortal, getPortalIdentity } from '../src/lib/portal/access.ts';
import {
  stagingCallback, stagingParentSignIn, stagingSetup, stagingSignOut,
} from '../src/lib/staging-auth.ts';

type Service = NonNullable<ReturnType<typeof getAuthService>>;
const parent = {
  user: { id: 'user_parentfixture', email: 'parent@example.test', emailVerified: true },
  sessionId: 'session_parent_fixture', accessToken: 'synthetic-parent-sdk-token',
  organizationId: undefined, impersonator: null,
};
const owner = {
  user: { id: 'user_ownerfixture', email: 'owner@example.test', emailVerified: true },
  sessionId: 'session_owner_fixture', accessToken: 'synthetic-owner-sdk-token',
  organizationId: 'org_fixture', impersonator: null,
};
let networkCalls = 0;
let forbiddenReads = 0;
before(() => {
  mock.method(globalThis, 'fetch', async () => {
    networkCalls++;
    throw new Error('Network forbidden in synthetic parent authentication tests');
  });
});
after(() => {
  mock.restoreAll();
  assert.equal(networkCalls, 0, 'No SDK fake may make a real provider request');
  assert.equal(forbiddenReads, 0, 'Authentication and admin denial must precede business access');
});

function environment(overrides: Record<string, unknown> = {}): Cloudflare.Env {
  const value = {
    STAGING_AUTH_SETUP: 'true', STAGING_PORTAL_TEST: 'true', PORTAL_ENABLED: 'true',
    STAGING_PARENT_TEST: 'true', STAGING_PARENT_EMAIL: parent.user.email,
    PORTAL_DEMO: 'false', PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false',
    EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
    WORKOS_API_KEY: 'sk_SYNTHETIC_ONLY', WORKOS_CLIENT_ID: 'client_fixture',
    WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-password-never-used-with-a-provider',
    WORKOS_REDIRECT_URI: 'https://example.test/auth/callback',
    WORKOS_ORGANIZATION_ID: 'org_fixture', ADMIN_USER_IDS: owner.user.id,
    ...overrides,
  };
  for (const binding of ['DB', 'SLIPS', 'BREVO_API_KEY', 'GROQ_API_KEY']) {
    Object.defineProperty(value, binding, {
      enumerable: true,
      get() { forbiddenReads++; throw new Error(`Forbidden binding access: ${binding}`); },
    });
  }
  return value as unknown as Cloudflare.Env;
}
function pinnedEnvironment(overrides: Record<string, unknown> = {}) {
  return environment({ STAGING_PARENT_USER_ID: parent.user.id, ...overrides });
}
function context(path = '/auth/callback?code=synthetic_code&state=synthetic_state', auth: unknown = { user: null }, method = 'GET') {
  const url = new URL(path, 'https://example.test');
  return {
    cookies: {}, locals: { auth }, url,
    request: new Request(url, { method, headers: { Origin: url.origin } }),
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}
function fixture(options: {
  auth?: unknown;
  refreshedSessionData?: unknown;
  returnPathname?: string;
  failAt?: 'handleCallback' | 'withAuth';
} = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const method = (name: string, result: unknown) => async (...args: unknown[]) => {
    calls.push({ name, args });
    if (options.failAt === name) throw new Error('PRIVATE_PROVIDER_FAILURE synthetic_code user_parentfixture');
    return result;
  };
  const service = {
    clearSession: method('clearSession', {}),
    clearPendingVerifier: method('clearPendingVerifier', {}),
    createSignUp: method('createSignUp', { url: 'https://api.workos.com/user_management/authorize?screen_hint=sign-up' }),
    createSignIn: method('createSignIn', { url: 'https://api.workos.com/user_management/authorize?screen_hint=sign-in' }),
    handleCallback: method('handleCallback', { returnPathname: options.returnPathname ?? 'https://attacker.example/private' }),
    withAuth: method('withAuth', { auth: options.auth ?? parent, refreshedSessionData: options.refreshedSessionData }),
    saveSession: method('saveSession', {}),
    signOut: method('signOut', {
      logoutUrl: 'https://api.workos.com/user_management/sessions/logout',
      headers: { 'Set-Cookie': 'wos-session=; Max-Age=0; Path=/; HttpOnly; Secure' },
    }),
  } as unknown as Service;
  return { service, calls };
}
async function assertPrivateFailure(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.has('location'), false);
  const body = await response.text();
  for (const hidden of [parent.user.id, parent.user.email, parent.sessionId, parent.accessToken,
    owner.user.id, owner.user.email, owner.sessionId, owner.accessToken,
    'PRIVATE_PROVIDER_FAILURE', 'synthetic_code', 'synthetic_state', 'sk_SYNTHETIC_ONLY']) {
    assert.equal(body.includes(hidden), false, `Failure must not reflect ${hidden}`);
  }
  return body;
}

test('parent bootstrap clears an old session and starts signup without exposing or accepting a mailbox hint', async () => {
  const { service, calls } = fixture();
  const ctx = context('/auth/parent?login_hint=attacker@example.test&organization_id=org_other&returnTo=/admin', owner);
  const response = await stagingParentSignIn(ctx, environment(), service);
  assert.equal(response.status, 302);
  assert.deepEqual(calls.map(call => call.name), ['clearSession', 'createSignUp']);
  assert.deepEqual(calls[1].args, [ctx.cookies, { returnPathname: '/portal' }]);
  assert.equal(response.headers.get('location'), 'https://api.workos.com/user_management/authorize?screen_hint=sign-up');
});

test('a pinned tester starts ordinary signin without a staff organization or caller-selected destination', async () => {
  const { service, calls } = fixture();
  const ctx = context('/auth/parent?returnTo=https://attacker.example&organizationId=org_fixture', owner);
  const response = await stagingParentSignIn(ctx, pinnedEnvironment(), service);
  assert.equal(response.status, 302);
  assert.deepEqual(calls.map(call => call.name), ['clearSession', 'createSignIn']);
  assert.deepEqual(calls[1].args, [ctx.cookies, { returnPathname: '/portal' }]);
});

test('disabled or invalid parent setup cannot initiate provider authentication', async () => {
  for (const overrides of [
    { STAGING_PARENT_TEST: undefined, STAGING_PARENT_EMAIL: undefined },
    { STAGING_PARENT_TEST: 'false' }, { STAGING_PARENT_EMAIL: 'not-an-address' },
    { STAGING_PARENT_USER_ID: owner.user.id },
  ]) {
    const { service, calls } = fixture();
    await assertPrivateFailure(await stagingParentSignIn(context('/auth/parent'), environment(overrides), service), 404);
    assert.deepEqual(calls, []);
  }
});

test('verified bootstrap enrollment clears the new session and remains pending without revealing the new identity', async () => {
  const { service, calls } = fixture({ refreshedSessionData: 'synthetic-refreshed-session' });
  const response = await stagingCallback(context(), environment(), service);
  const body = await assertPrivateFailure(response, 403);
  assert.match(body, /Registro de prueba recibido/);
  assert.match(body, /sigue cerrado/);
  assert.deepEqual(calls.map(call => call.name), ['handleCallback', 'withAuth', 'clearSession']);
});

test('bootstrap rejects a wrong address, unverified email, staff organization, impersonation or incomplete SDK session', async () => {
  for (const auth of [
    { ...parent, user: { ...parent.user, email: 'another@example.test' } },
    { ...parent, user: { ...parent.user, emailVerified: false } },
    { ...parent, organizationId: 'org_fixture' },
    { ...parent, impersonator: { email: 'operator@example.test' } },
    { ...parent, sessionId: '' }, { ...parent, accessToken: '' }, { user: null },
  ]) {
    const { service, calls } = fixture({ auth, refreshedSessionData: 'must-not-be-saved' });
    const body = await assertPrivateFailure(await stagingCallback(context(), environment(), service), 403);
    assert.doesNotMatch(body, /Registro de prueba recibido/);
    assert.equal(calls.at(-1)?.name, 'clearSession');
    assert.equal(calls.some(call => call.name === 'saveSession'), false);
  }
});

test('a pinned parent callback ignores arbitrary return paths and saves only its validated refreshed session', async () => {
  for (const returnPathname of ['https://attacker.example/private', '//attacker.example', '/admin', '/auth/setup']) {
    const refreshedSessionData = { synthetic: 'parent-refresh' };
    const { service, calls } = fixture({ refreshedSessionData, returnPathname });
    const ctx = context('/auth/callback?code=synthetic_code&state=synthetic_state&returnTo=/admin');
    const response = await stagingCallback(ctx, pinnedEnvironment(), service);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/portal');
    assert.deepEqual(calls.map(call => call.name), ['handleCallback', 'withAuth', 'saveSession']);
    assert.deepEqual(calls[2].args, [ctx.cookies, refreshedSessionData]);
  }
});

test('pinned parent callback requires both the exact immutable ID and verified address without an organization', async () => {
  for (const auth of [
    { ...parent, user: { ...parent.user, id: 'user_otherfixture' } },
    { ...parent, user: { ...parent.user, email: 'changed@example.test' } },
    { ...parent, user: { ...parent.user, emailVerified: false } },
    { ...parent, organizationId: 'org_fixture' }, { ...parent, organizationId: 'org_other' },
    { ...parent, impersonator: { email: 'operator@example.test' } },
    { ...parent, sessionId: '' }, { ...parent, accessToken: '' }, { user: null },
  ]) {
    const { service, calls } = fixture({ auth, refreshedSessionData: 'must-not-be-saved' });
    await assertPrivateFailure(await stagingCallback(context(), pinnedEnvironment(), service), 403);
    assert.equal(calls.at(-1)?.name, 'clearSession');
    assert.equal(calls.some(call => call.name === 'saveSession'), false);
  }
});

test('missing or provider-error callback codes are never exchanged and produce a generic cleared-session failure', async () => {
  for (const path of ['/auth/callback', '/auth/callback?state=synthetic_state',
    '/auth/callback?error=PRIVATE_PROVIDER_FAILURE&code=synthetic_code&state=synthetic_state']) {
    const { service, calls } = fixture();
    await assertPrivateFailure(await stagingCallback(context(path), pinnedEnvironment(), service), 400);
    assert.equal(calls.some(call => call.name === 'handleCallback' || call.name === 'withAuth'), false);
    assert.equal(calls.at(-1)?.name, 'clearSession');
    assert.equal(calls.some(call => call.name === 'clearPendingVerifier'), path.includes('state='));
  }
  for (const failAt of ['handleCallback', 'withAuth'] as const) {
    const { service, calls } = fixture({ failAt });
    await assertPrivateFailure(await stagingCallback(context(), pinnedEnvironment(), service), 400);
    assert.equal(calls.at(-1)?.name, 'clearSession');
    assert.equal(calls.some(call => call.name === 'saveSession'), false);
  }
});

test('the owner callback still returns to setup and parent identity cannot display owner setup confirmation', async () => {
  const ownerFixture = fixture({ auth: owner, returnPathname: '/portal' });
  const response = await stagingCallback(context(), pinnedEnvironment(), ownerFixture.service);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/auth/setup');
  const parentFixture = fixture();
  await assertPrivateFailure(await stagingSetup(context('/auth/setup', parent), pinnedEnvironment(), parentFixture.service), 403);
  assert.deepEqual(parentFixture.calls.map(call => call.name), ['clearSession']);
});

test('pinned parent logout clears the pending session before SDK logout and preserves deletion headers', async () => {
  const { service, calls } = fixture();
  const ctx = context('/auth/logout?returnTo=https://attacker.example', parent, 'POST');
  const response = await stagingSignOut(ctx, pinnedEnvironment(), service);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://api.workos.com/user_management/sessions/logout');
  assert.deepEqual(calls.map(call => call.name), ['clearSession', 'signOut']);
  assert.deepEqual(calls[1].args, [parent.sessionId, { returnTo: 'https://example.test/' }]);
  assert.match(response.headers.get('set-cookie') ?? '', /wos-session=; Max-Age=0/);
});

test('bootstrap and mismatched parent logout cannot call provider logout, while anonymous logout only clears locally', async () => {
  for (const [auth, env] of [
    [parent, environment()],
    [{ ...parent, user: { ...parent.user, id: 'user_otherfixture' } }, pinnedEnvironment()],
    [{ ...parent, organizationId: 'org_fixture' }, pinnedEnvironment()],
  ] as const) {
    const { service, calls } = fixture({ auth });
    await assertPrivateFailure(await stagingSignOut(context('/auth/logout', auth, 'POST'), env, service), 403);
    assert.deepEqual(calls.map(call => call.name), ['clearSession']);
  }
  const { service, calls } = fixture();
  const response = await stagingSignOut(context('/auth/logout', { user: null }, 'POST'), pinnedEnvironment(), service);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assert.deepEqual(calls.map(call => call.name), ['clearSession']);
});

test('bootstrap cannot enter the portal and a pinned parent cannot authorize any administrator route before DB access', async () => {
  const bootstrap = await authorizePortal(context('/portal', parent), environment());
  assert.equal(bootstrap.ok, false);
  if (!bootstrap.ok) assert.equal(bootstrap.response.status, 403);
  const env = pinnedEnvironment();
  assert.equal(getPortalIdentity(context('/portal', parent), env)?.isAdmin, false);
  for (const [path, method] of [['/admin', 'GET'], ['/api/admin/invitations', 'POST'],
    ['/api/admin/payments/export', 'GET'], ['/api/admin/payments/fixture/review', 'POST']]) {
    const access = await authorizePortal(context(path, parent, method), env, { admin: true });
    assert.equal(access.ok, false);
    if (!access.ok) {
      assert.equal(access.response.status, 403);
      assert.equal(access.response.headers.has('location'), false);
      assert.equal(access.response.headers.get('cache-control'), 'private, no-store');
    }
  }
  assert.equal(forbiddenReads, 0);
});
