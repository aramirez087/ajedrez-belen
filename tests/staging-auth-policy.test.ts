import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
import {
  isStagingSetupOwner, stagingAuthSetupGate, stagingAuthSetupRequested,
  stagingPortalTestRequested, restrictedModeRequested,
  STAGING_AUTH_SETUP_PATH, type StagingAuthEnvironment,
} from '../src/lib/staging-auth-policy.ts';

const origin = 'https://staging.example.test';
const environment: StagingAuthEnvironment = {
  STAGING_AUTH_SETUP: 'true', PORTAL_ENABLED: 'false', PORTAL_DEMO: 'false',
  PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false', EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
  WORKOS_API_KEY: 'sk_test_fixture', WORKOS_CLIENT_ID: 'client_fixture',
  WORKOS_REDIRECT_URI: `${origin}/auth/callback`, WORKOS_COOKIE_PASSWORD: 'synthetic-setup-cookie-password-at-least-32',
  WORKOS_ORGANIZATION_ID: 'org_fixture', ADMIN_USER_IDS: 'user_owner',
};
const portalEnvironment: StagingAuthEnvironment = {
  ...environment, STAGING_PORTAL_TEST: 'true', PORTAL_ENABLED: 'true',
};
const request = (path = STAGING_AUTH_SETUP_PATH, method = 'GET', headers?: HeadersInit) =>
  new Request(`${origin}${path}`, { method, headers });
function context(overrides: Record<string, unknown> = {}): Pick<APIContext, 'locals'> {
  return { locals: { auth: {
    user: { id: 'user_owner', email: 'owner@example.test', emailVerified: true },
    sessionId: 'session_fixture', accessToken: 'validated-by-sdk',
    organizationId: 'org_fixture', impersonator: null, ...overrides,
  } } } as unknown as Pick<APIContext, 'locals'>;
}

test('any present staging flag activates the restriction while only exact true requests a mode', () => {
  for (const flag of [undefined, '', 'false', 'TRUE', ' true ', true]) {
    const env = { ...environment, STAGING_AUTH_SETUP: flag } as StagingAuthEnvironment;
    assert.equal(stagingAuthSetupRequested(env), false);
    assert.equal(restrictedModeRequested(env), flag !== undefined);
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: flag === undefined ? 404 : 503 });
    assert.equal(isStagingSetupOwner(context(), env), false);
  }
  for (const flag of [undefined, '', 'false', 'TRUE', ' true ', true, null, {}, 'true']) {
    const env = { STAGING_PORTAL_TEST: flag } as StagingAuthEnvironment;
    assert.equal(restrictedModeRequested(env), flag !== undefined);
    assert.equal(stagingPortalTestRequested(env), flag === 'true');
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: flag === undefined ? 404 : 503 });
    assert.equal(isStagingSetupOwner(context(), env), false);
  }
  assert.equal(restrictedModeRequested({}), false);
  assert.equal(stagingAuthSetupRequested(environment), true);
  assert.deepEqual(stagingAuthSetupGate(request('/admin'), { ...environment, PORTAL_ENABLED: 'true' }), { status: 404 });
});

test('only the two explicit mode combinations authorize even the accepted owner', () => {
  for (const setup of [undefined, 'false', 'true', 'TRUE', true]) {
    for (const portal of [undefined, 'false', 'true', 'TRUE', true]) {
      for (const flag of [undefined, 'false', 'true', '', 'TRUE', true]) {
        const env = { ...environment, STAGING_AUTH_SETUP: setup, PORTAL_ENABLED: portal, STAGING_PORTAL_TEST: flag } as StagingAuthEnvironment;
        const valid = setup === 'true' && ((portal === 'false' && (flag === undefined || flag === 'false')) || (portal === 'true' && flag === 'true'));
        assert.equal(isStagingSetupOwner(context(), env), valid, JSON.stringify({ setup, portal, flag }));
        assert.deepEqual(stagingAuthSetupGate(request(), env), {
          status: valid ? 200 : restrictedModeRequested(env) ? 503 : 404,
        });
        assert.deepEqual(stagingAuthSetupGate(request('/admin'), env), {
          status: flag === 'true' ? valid ? 200 : 503 : 404,
        });
      }
    }
  }
});

test('only the three exact read routes and same-origin POST logout pass', () => {
  for (const env of [environment, portalEnvironment]) {
    for (const path of ['/auth/admin', '/auth/callback', STAGING_AUTH_SETUP_PATH]) {
      for (const method of ['GET', 'HEAD']) assert.deepEqual(stagingAuthSetupGate(request(path, method), env), { status: 200 });
    }
    assert.deepEqual(stagingAuthSetupGate(request('/auth/logout', 'POST', { Origin: origin }), env), { status: 200 });
    assert.deepEqual(stagingAuthSetupGate(request('/auth/callback?state=synthetic&code=never-exchanged'), env), { status: 200 });
  }
});

test('each allowed path rejects unsupported methods with an exact Allow header value', () => {
  for (const env of [environment, portalEnvironment]) {
    for (const path of ['/auth/admin', '/auth/callback', STAGING_AUTH_SETUP_PATH]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        assert.deepEqual(stagingAuthSetupGate(request(path, method, { Origin: origin }), env), { status: 405, allow: 'GET, HEAD' });
      }
    }
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.deepEqual(stagingAuthSetupGate(request('/auth/logout', method, { Origin: origin }), env), { status: 405, allow: 'POST' });
    }
  }
});

test('portal-test business routes reach their own handlers only with the matching mode and request origin', () => {
  for (const path of ['/admin', '/admin/pagos/fixture', '/admin/familias', '/portal', '/portal/pagos/nuevo',
    '/portal/comprobantes/fixture', '/api/admin', '/api/admin/payments/fixture/review', '/api/portal',
    '/api/portal/payments', '/api/portal/slips', '/api/portal/files/fixture']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      // Business methods remain the route handler's decision, after the middleware owner check.
      assert.deepEqual(stagingAuthSetupGate(request(path, method, { Origin: origin }), portalEnvironment), { status: 200 });
      assert.deepEqual(stagingAuthSetupGate(request(path, method, { Origin: origin }), environment), { status: 404 });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        for (const candidate of [undefined, 'null', 'https://attacker.test', `${origin}/`, `${origin}/path`]) {
          assert.deepEqual(stagingAuthSetupGate(request(path, method, candidate ? { Origin: candidate } : {}), portalEnvironment), { status: 403 });
        }
      }
    }
    assert.deepEqual(stagingAuthSetupGate(new Request(`https://wrong.example.test${path}`), portalEnvironment), { status: 403 });
  }
});

test('portal-test mode blocks signup, invitations, email, demo, prototype and ambiguous paths for every method', () => {
  for (const path of ['/', '/portal/acceso', '/portal/acceso/', '/portal/acceso/child', '/portal/ACCESO',
    '/portal/invitacion?token=synthetic', '/portal/invitacion/child', '/api/admin/invitations',
    '/api/admin/invitations/child', '/api/portal/invitations/redeem', '/api/portal/invitations/redeem/child',
    '/api/admin/email', '/api/admin/email/prepare', '/api/portal/demo', '/api/portal/demo/child',
    '/demo', '/demo/child', '/prototype', '/api/prototype/run', '/login', '/login/child',
    '/auth/parent', '/auth/login', '/auth/admin/child', '/auth/setup/', '/auth/%73etup',
    '/portal/%61cceso', '/portal//acceso', '/api/admin/%65mail', '/api/admin//email',
    '/admin-extra', '/portals', '/api/admin-extra', '/api/portals', '/api/other']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.deepEqual(stagingAuthSetupGate(request(path, method, { Origin: origin }), portalEnvironment), { status: 404 }, `${method} ${path}`);
    }
  }
});

test('business, family, legacy and lookalike routes remain denied for reads and writes', () => {
  for (const path of ['/', '/portal', '/portal/acceso', '/admin', '/admin/comprobantes', '/demo', '/prototype',
    '/api/admin/email', '/api/admin/payments/id/review', '/api/portal/slips', '/api/prototype/run',
    '/auth', '/auth/parent', '/auth/login', '/auth/setup/', '/auth/setup/child', '/auth/Setup',
    '/auth/%73etup', '/auth/admin/extra', '/auth/logout/']) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      assert.deepEqual(stagingAuthSetupGate(request(path, method, { Origin: origin }), environment), { status: 404 }, `${method} ${path}`);
    }
  }
});

test('an unsafe flag or provider mode disables setup even for the accepted owner', () => {
  const variants = {
    PORTAL_ENABLED: [undefined, 'true', 'FALSE'], PORTAL_DEMO: [undefined, 'true'],
    PROTOTYPE_ENABLED: [undefined, 'true'], PROTOTYPE_LOCAL: [undefined, 'true'],
    EMAIL_MODE: [undefined, 'live', 'dry-run'], OCR_MODE: [undefined, 'groq'],
  };
  for (const [key, values] of Object.entries(variants)) for (const value of values) {
    const env = { ...environment, [key]: value };
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 503 }, `${key}=${value}`);
    assert.equal(isStagingSetupOwner(context(), env), false);
  }
  for (const key of ['PORTAL_DEMO', 'PROTOTYPE_ENABLED', 'PROTOTYPE_LOCAL', 'EMAIL_MODE', 'OCR_MODE']) {
    for (const value of [undefined, 'true', 'live', '', false]) {
      const env = { ...portalEnvironment, [key]: value } as StagingAuthEnvironment;
      assert.deepEqual(stagingAuthSetupGate(request('/api/admin/payments/fixture/review', 'POST', { Origin: origin }), env), { status: 503 }, `${key}=${value}`);
      assert.equal(isStagingSetupOwner(context(), env), false);
    }
  }
});

test('every credential and public auth binding must be present and valid before a route is allowed', () => {
  for (const base of [environment, portalEnvironment]) {
    for (const key of ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_REDIRECT_URI', 'WORKOS_COOKIE_PASSWORD',
      'WORKOS_ORGANIZATION_ID', 'ADMIN_USER_IDS']) {
      for (const value of [undefined, '', ' ', 123, {}]) {
        const env = { ...base, [key]: value } as StagingAuthEnvironment;
        assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 503 }, key);
        assert.equal(isStagingSetupOwner(context(), env), false);
      }
    }
    for (const changes of [
      { WORKOS_COOKIE_PASSWORD: 'short' }, { WORKOS_CLIENT_ID: 'not-a-client' }, { WORKOS_ORGANIZATION_ID: 'not-an-org' },
      { WORKOS_REDIRECT_URI: `${origin}/different` }, { WORKOS_REDIRECT_URI: 'http://staging.example.test/auth/callback' },
      { WORKOS_REDIRECT_URI: `${origin}/auth/callback?returnTo=elsewhere` },
      { WORKOS_REDIRECT_URI: `${origin}/auth/callback#fragment` },
    ]) assert.deepEqual(stagingAuthSetupGate(request(), { ...base, ...changes }), { status: 503 });
  }
});

test('setup accepts exactly one user ID and rejects emails, lists and partial identifiers', () => {
  for (const id of ['owner@example.test', 'user_', 'user_owner,user_second', 'user_owner,', ',user_owner', 'user_owner user_second', '*', 'user_owner/extra']) {
    const env = { ...environment, ADMIN_USER_IDS: id };
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 503 }, id);
    assert.equal(isStagingSetupOwner(context(), env), false);
  }
  assert.equal(isStagingSetupOwner(context(), { ...environment, ADMIN_USER_IDS: ' user_owner ' }), true);
});

test('requests must use the configured callback origin; loopback fixtures remain supported', () => {
  for (const badOrigin of ['https://different.example.test', 'http://staging.example.test', 'https://staging.example.test:8443']) {
    assert.deepEqual(stagingAuthSetupGate(new Request(`${badOrigin}/auth/admin`), environment), { status: 403 });
  }
  const local = 'http://127.0.0.1:4325';
  const env = { ...environment, WORKOS_REDIRECT_URI: `${local}/auth/callback` };
  assert.deepEqual(stagingAuthSetupGate(new Request(`${local}/auth/admin`), env), { status: 200 });
  assert.deepEqual(stagingAuthSetupGate(new Request('http://127.0.0.1:4326/auth/admin'), env), { status: 403 });
});

test('logout requires the exact same-origin Origin header rather than same-site or absent origin', () => {
  for (const candidate of [undefined, 'null', 'https://www.staging.example.test', 'http://staging.example.test',
    `${origin}:8443`, `${origin}/`, `${origin}/path`, 'malformed']) {
    assert.deepEqual(stagingAuthSetupGate(request('/auth/logout', 'POST', candidate ? { Origin: candidate } : {}), environment), { status: 403 }, candidate);
  }
});

test('only the SDK-verified sole owner in the exact organization passes identity checks', () => {
  for (const env of [environment, portalEnvironment]) {
    assert.equal(isStagingSetupOwner(context(), env), true);
    for (const changes of [
      { user: null }, { sessionId: undefined }, { sessionId: '' }, { accessToken: undefined }, { accessToken: '' },
      { organizationId: undefined }, { organizationId: 'org_different' },
      { impersonator: { email: 'support@example.test' } },
      { user: { id: 'user_other', email: 'owner@example.test', emailVerified: true }, role: 'admin' },
      { user: { id: 'user_owner_extra', email: 'owner@example.test', emailVerified: true } },
      { user: { id: 'user_owner', emailVerified: false } },
      { user: { id: 'user_owner', emailVerified: 'true' } },
      { user: { id: 'user_owner' } },
    ]) assert.equal(isStagingSetupOwner(context(changes), env), false);
  }
});

test('route and owner policies never read data stores or email/OCR bindings and never contact providers', (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  for (const base of [environment, portalEnvironment]) {
    const env = new Proxy(base, {
      get(target, key, receiver) {
        if (['DB', 'SLIPS', 'BREVO_API_KEY', 'GROQ_API_KEY'].includes(String(key))) throw new Error(`Unexpected binding access: ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      ownKeys() { throw new Error('Bindings must not be enumerated'); },
    });
    assert.equal(restrictedModeRequested(env), true);
    assert.deepEqual(stagingAuthSetupGate(request(), env), { status: 200 });
    assert.equal(isStagingSetupOwner(context(), env), true);
    assert.deepEqual(stagingAuthSetupGate(request('/api/admin/email', 'POST', { Origin: origin }), env), { status: 404 });
    assert.deepEqual(stagingAuthSetupGate(request('/admin'), env), { status: base === portalEnvironment ? 200 : 404 });
    assert.equal(isStagingSetupOwner(context({ organizationId: 'org_wrong' }), env), false);
  }
  assert.equal(network.mock.callCount(), 0);
});
