import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
import {
  isStagingParentEnrollment, isStagingPortalActor, isStagingSetupOwner, isStagingTestParent,
  restrictedModeRequested, stagingAuthSetupGate, stagingParentTestConfiguration,
  type StagingAuthEnvironment,
} from '../src/lib/staging-auth-policy.ts';

const origin = 'https://staging.example.test';
const parentEmail = 'parent@example.test';
const environment: StagingAuthEnvironment = {
  STAGING_AUTH_SETUP: 'true', STAGING_PORTAL_TEST: 'true', PORTAL_ENABLED: 'true',
  PORTAL_DEMO: 'false', PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false',
  EMAIL_MODE: 'dry_run', OCR_MODE: 'off', WORKOS_API_KEY: 'sk_test_fixture',
  WORKOS_CLIENT_ID: 'client_fixture', WORKOS_REDIRECT_URI: `${origin}/auth/callback`,
  WORKOS_COOKIE_PASSWORD: 'synthetic-parent-cookie-password-at-least-32',
  WORKOS_ORGANIZATION_ID: 'org_fixture', ADMIN_USER_IDS: 'user_owner',
};
const bootstrap: StagingAuthEnvironment = {
  ...environment, STAGING_PARENT_TEST: 'true', STAGING_PARENT_EMAIL: parentEmail,
};
const active: StagingAuthEnvironment = { ...bootstrap, STAGING_PARENT_USER_ID: 'user_parent' };
const request = (path = '/auth/parent', method = 'GET', headers?: HeadersInit) =>
  new Request(`${origin}${path}`, { method, headers });
function context(overrides: Record<string, unknown> = {}): Pick<APIContext, 'locals'> {
  return { locals: { auth: {
    user: { id: 'user_parent', email: parentEmail, emailVerified: true },
    sessionId: 'session_fixture', accessToken: 'validated-by-sdk',
    organizationId: undefined, impersonator: null, ...overrides,
  } } } as unknown as Pick<APIContext, 'locals'>;
}
const owner = () => context({
  user: { id: 'user_owner', email: 'owner@example.test', emailVerified: true },
  organizationId: 'org_fixture',
});

test('absent parent fields preserve the owner-only staging policy and normal production selection', () => {
  assert.equal(restrictedModeRequested({}), false);
  assert.equal(stagingParentTestConfiguration(environment), null);
  assert.deepEqual(stagingAuthSetupGate(request(), environment), { status: 404 });
  assert.equal(isStagingTestParent(context(), environment), false);
  assert.equal(isStagingParentEnrollment(context(), environment), false);
  assert.equal(isStagingPortalActor(context(), environment), false);
  assert.equal(isStagingPortalActor(owner(), environment), true);
  assert.equal(isStagingSetupOwner(owner(), environment), true);
});

test('any present parent binding fails closed without the required staging base', () => {
  for (const key of ['STAGING_PARENT_TEST', 'STAGING_PARENT_EMAIL', 'STAGING_PARENT_USER_ID']) {
    for (const value of ['', 'false', 'true', 'invalid', null, false, {}]) {
      const env = { [key]: value } as StagingAuthEnvironment;
      assert.equal(restrictedModeRequested(env), true, key);
      assert.equal(stagingParentTestConfiguration(env), null, key);
      assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 404 });
      assert.deepEqual(stagingAuthSetupGate(request('/auth/admin'), env), { status: 503 });
      assert.equal(isStagingPortalActor(context(), env), false);
    }
  }
});

test('bootstrap permits only the exact parent read entry and cannot authorize an enrolled session', () => {
  assert.deepEqual(stagingParentTestConfiguration(bootstrap), { email: parentEmail });
  for (const method of ['GET', 'HEAD']) {
    assert.deepEqual(stagingAuthSetupGate(request('/auth/parent', method), bootstrap), { status: 200 });
  }
  assert.equal(isStagingParentEnrollment(context(), bootstrap), true);
  assert.equal(isStagingTestParent(context(), bootstrap), false);
  assert.equal(isStagingPortalActor(context(), bootstrap), false);
  assert.equal(isStagingSetupOwner(context(), bootstrap), false);
  assert.equal(isStagingPortalActor(owner(), bootstrap), true);
  assert.equal(isStagingParentEnrollment(owner(), bootstrap), false);
});

test('active parent mode authorizes only its pinned family identity and never changes owner authorization', () => {
  assert.deepEqual(stagingParentTestConfiguration(active), { email: parentEmail, userId: 'user_parent' });
  assert.equal(isStagingTestParent(context(), active), true);
  assert.equal(isStagingPortalActor(context(), active), true);
  assert.equal(isStagingParentEnrollment(context(), active), false);
  assert.equal(isStagingSetupOwner(context(), active), false);
  assert.equal(isStagingTestParent(owner(), active), false);
  assert.equal(isStagingSetupOwner(owner(), active), true);
  assert.equal(isStagingPortalActor(owner(), active), true);
  assert.equal(isStagingTestParent(context({ organizationId: null }), active), true);
});

test('only canonical bounded mailbox configuration and exact distinct immutable user IDs are accepted', () => {
  const variants: Record<string, unknown[]> = {
    STAGING_PARENT_TEST: [undefined, '', 'false', 'TRUE', ' true ', true, null, {}],
    STAGING_PARENT_EMAIL: [undefined, '', ' ', 'Parent@example.test', ' parent@example.test',
      'parent@example.test ', 'parent@example.test\n', 'parent\u0085@example.test', 'parent\u2028@example.test',
      'parent', 'parent@localhost', 'parent@@example.test', 'parent..alias@example.test',
      'parent@-example.test', 'parent@example-.test', 'parent@example..test', '<parent@example.test>',
      `${'a'.repeat(65)}@example.test`, `${'a'.repeat(64)}@${'b'.repeat(64)}.test`,
      `${'a'.repeat(64)}@${Array(4).fill('b'.repeat(62)).join('.')}`, null, true, {}],
    STAGING_PARENT_USER_ID: ['', ' user_parent', 'user_parent ', 'user_', 'parent@example.test',
      'user_parent,user_other', 'user_parent/user_other', 'user_parent_extra', 'user_owner', null, true, {}],
  };
  for (const [key, values] of Object.entries(variants)) for (const value of values) {
    const env = { ...active, [key]: value } as StagingAuthEnvironment;
    assert.equal(stagingParentTestConfiguration(env), null, `${key} malformed`);
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 404 });
    assert.equal(isStagingTestParent(context(), env), false);
    assert.equal(isStagingParentEnrollment(context(), env), false);
    // Optional parent mistakes cannot weaken or disable the existing valid owner policy.
    assert.equal(isStagingSetupOwner(owner(), env), true);
    assert.equal(isStagingPortalActor(owner(), env), true);
    assert.deepEqual(stagingAuthSetupGate(request('/auth/admin'), env), { status: 200 });
  }
  assert.equal(stagingParentTestConfiguration({ ...active, ADMIN_USER_IDS: ' user_owner ', STAGING_PARENT_USER_ID: 'user_owner' }), null);
  assert.deepEqual(stagingParentTestConfiguration({ ...active, STAGING_PARENT_EMAIL: 'parent+fixture@example.test' }), {
    email: 'parent+fixture@example.test', userId: 'user_parent',
  });
});

test('unsafe or incomplete base configuration blocks both parent states before any identity acceptance', () => {
  const variants: Record<string, unknown[]> = {
    STAGING_AUTH_SETUP: [undefined, 'false', 'TRUE'], STAGING_PORTAL_TEST: [undefined, 'false', 'TRUE'],
    PORTAL_ENABLED: [undefined, 'false', 'TRUE'], PORTAL_DEMO: [undefined, 'true'],
    PROTOTYPE_ENABLED: [undefined, 'true'], PROTOTYPE_LOCAL: [undefined, 'true'],
    EMAIL_MODE: [undefined, 'live'], OCR_MODE: [undefined, 'groq'],
    WORKOS_API_KEY: [undefined, ''], WORKOS_CLIENT_ID: [undefined, 'bad-client'],
    WORKOS_REDIRECT_URI: [undefined, `${origin}/different`, 'https://other.test/auth/callback?x=1'],
    WORKOS_COOKIE_PASSWORD: [undefined, 'short'], WORKOS_ORGANIZATION_ID: [undefined, 'bad-org'],
    ADMIN_USER_IDS: [undefined, 'user_owner,user_other'],
  };
  for (const base of [bootstrap, active]) for (const [key, values] of Object.entries(variants)) for (const value of values) {
    const env = { ...base, [key]: value } as StagingAuthEnvironment;
    assert.equal(stagingParentTestConfiguration(env), null, key);
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 404 });
    assert.equal(isStagingTestParent(context(), env), false);
    assert.equal(isStagingParentEnrollment(context(), env), false);
    assert.equal(isStagingPortalActor(context(), env), false);
  }
  const authOnly = { ...bootstrap, PORTAL_ENABLED: 'false', STAGING_PORTAL_TEST: 'false' };
  assert.equal(stagingParentTestConfiguration(authOnly), null);
  assert.equal(isStagingSetupOwner(owner(), authOnly), true);
});

test('parent entry has exact methods and origin; invitations, email, demo and lookalikes remain denied', () => {
  for (const env of [bootstrap, active]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.deepEqual(stagingAuthSetupGate(request('/auth/parent', method, { Origin: origin }), env), { status: 405, allow: 'GET, HEAD' });
    }
    for (const badOrigin of ['https://other.example.test', 'http://staging.example.test', `${origin}:8443`]) {
      assert.deepEqual(stagingAuthSetupGate(new Request(`${badOrigin}/auth/parent`), env), { status: 403 });
    }
    for (const path of ['/auth/parent/', '/auth/parent/extra', '/auth/Parent', '/auth/%70arent', '/auth//parent',
      '/auth/parents', '/login', '/portal/acceso', '/portal/invitacion', '/portal/admin-invitacion',
      '/api/admin/invitations', '/api/admin/administradores',
      '/api/portal/invitations/redeem', '/api/portal/admin-invitations/redeem', '/api/admin/email', '/api/portal/demo', '/prototype']) {
      assert.deepEqual(stagingAuthSetupGate(request(path), env), { status: 404 }, path);
    }
    assert.deepEqual(stagingAuthSetupGate(request('/api/portal/payments', 'POST'), env), { status: 403 });
    assert.deepEqual(stagingAuthSetupGate(request('/api/portal/payments', 'POST', { Origin: 'https://attacker.test' }), env), { status: 403 });
    const local = 'http://127.0.0.1:4325';
    assert.deepEqual(stagingAuthSetupGate(new Request(`${local}/auth/parent`), {
      ...env, WORKOS_REDIRECT_URI: `${local}/auth/callback`,
    }), { status: 200 });
  }
});

test('missing, unverified, impersonated, organizational and invalid sessions fail both parent predicates', () => {
  const invalid = [
    { user: null }, { sessionId: undefined }, { sessionId: '' }, { sessionId: 123 },
    { accessToken: undefined }, { accessToken: '' }, { accessToken: 123 },
    { organizationId: '' }, { organizationId: 'org_fixture' }, { organizationId: 'org_other' },
    { impersonator: { email: 'support@example.test' } }, { impersonator: '' },
    ...[false, 'true', undefined].map(emailVerified => ({ user: { id: 'user_parent', email: parentEmail, emailVerified } })),
    ...['other@example.test', 'Parent@example.test', 'parent@example.test ', undefined].map(email => ({ user: { id: 'user_parent', email, emailVerified: true } })),
    ...[undefined, '', 'user_', 'user_parent_extra', 'user_parent,user_other', 'user_owner'].map(id => ({ user: { id, email: parentEmail, emailVerified: true } })),
  ];
  for (const changes of invalid) {
    assert.equal(isStagingTestParent(context(changes), active), false);
    assert.equal(isStagingParentEnrollment(context(changes), bootstrap), false);
    assert.equal(isStagingPortalActor(context(changes), active), false);
  }
  assert.equal(isStagingTestParent({ locals: {} } as Pick<APIContext, 'locals'>, active), false);
  assert.equal(isStagingParentEnrollment({ locals: {} } as Pick<APIContext, 'locals'>, bootstrap), false);
});

test('bootstrap may recognize a newly verified ID but active mode never substitutes an email match for its pin', () => {
  const differentId = context({ user: { id: 'user_second', email: parentEmail, emailVerified: true } });
  assert.equal(isStagingParentEnrollment(differentId, bootstrap), true);
  assert.equal(isStagingPortalActor(differentId, bootstrap), false);
  assert.equal(isStagingTestParent(differentId, active), false);
  assert.equal(isStagingPortalActor(differentId, active), false);
  assert.equal(isStagingParentEnrollment(differentId, active), false);
});

test('parent policy does not inspect data bindings or call providers in either state', (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  for (const base of [bootstrap, active]) {
    const env = new Proxy(base, {
      get(target, key, receiver) {
        if (['DB', 'SLIPS', 'BREVO_API_KEY', 'GROQ_API_KEY'].includes(String(key))) throw new Error('Unexpected data binding access');
        return Reflect.get(target, key, receiver);
      },
      ownKeys() { throw new Error('Bindings must not be enumerated'); },
    });
    assert.equal(restrictedModeRequested(env), true);
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 200 });
    assert.equal(stagingParentTestConfiguration(env)?.email, parentEmail);
    assert.equal(isStagingTestParent(context(), env), base === active);
    assert.equal(isStagingParentEnrollment(context(), env), base === bootstrap);
    assert.equal(isStagingPortalActor(context(), env), base === active);
    assert.equal(isStagingPortalActor(owner(), env), true);
  }
  assert.equal(network.mock.callCount(), 0);
});
