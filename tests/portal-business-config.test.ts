import assert from 'node:assert/strict';
import test from 'node:test';
import * as module from 'node:module';
import type { APIContext } from 'astro';
import { resolveBusinessConfiguration, type BusinessEnvironment } from '../src/lib/portal/business-config';
import { portalMutation } from '../src/lib/portal/routes';

const origin = 'https://portal.example.test';
const approved: BusinessEnvironment = {
  PORTAL_ENABLED: 'true', PORTAL_DEMO: 'false', PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false',
  PORTAL_BUSINESS_CONFIG_APPROVED: 'true', PAYMENT_BANK_NAME: 'Banco ficticio',
  PAYMENT_ACCOUNT_ID: 'CUENTA-FICTICIA', PAYMENT_DESTINATION: 'Destino ficticio autorizado',
  ASSOCIATION_RECEIPT_NAME: 'Asociación de prueba',
};
const staging: BusinessEnvironment = {
  ...approved, PORTAL_BUSINESS_CONFIG_APPROVED: undefined,
  STAGING_AUTH_SETUP: 'true', STAGING_PORTAL_TEST: 'true', EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
  WORKOS_API_KEY: 'sk_test_fixture', WORKOS_CLIENT_ID: 'client_fixture',
  WORKOS_REDIRECT_URI: `${origin}/auth/callback`, WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-password-at-least-32',
  WORKOS_ORGANIZATION_ID: 'org_fixture', ADMIN_USER_IDS: 'user_owner',
  PAYMENT_BANK_NAME: 'PRUEBA — no transferir', PAYMENT_ACCOUNT_ID: 'staging-synthetic-only',
  PAYMENT_DESTINATION: 'ENTORNO DE PRUEBA — no realizar transferencias',
  ASSOCIATION_RECEIPT_NAME: 'PRUEBAS — Ajedrez Belén (datos ficticios)',
};
const request = (path = '/portal/pagos/nuevo', method = 'GET') => new Request(`${origin}${path}`, {
  method, ...(method === 'POST' ? { headers: { Origin: origin } } : {}),
});

test('normal collection is closed until explicit approval and all business details exist', () => {
  const result = resolveBusinessConfiguration(request(), approved);
  assert.deepEqual(result, { bankName: 'Banco ficticio', receivingAccount: 'CUENTA-FICTICIA',
    paymentDestination: 'Destino ficticio autorizado', associationName: 'Asociación de prueba' });
  assert.equal(resolveBusinessConfiguration(request(), {}), null);
  for (const flag of [undefined, '', 'false', 'TRUE', ' true ', true]) {
    assert.equal(resolveBusinessConfiguration(request(), { ...approved, PORTAL_BUSINESS_CONFIG_APPROVED: flag } as BusinessEnvironment), null);
  }
  for (const key of ['PORTAL_DEMO', 'PROTOTYPE_ENABLED', 'PROTOTYPE_LOCAL'] as const) {
    for (const value of [undefined, 'true', 'FALSE']) assert.equal(resolveBusinessConfiguration(request(), { ...approved, [key]: value }), null);
  }
  assert.equal(resolveBusinessConfiguration(request(), { ...approved, PORTAL_ENABLED: 'false' }), null);
});

test('an approved SINPE-only destination needs no IBAN or bank-account connection', () => {
  const result = resolveBusinessConfiguration(request(), { ...approved,
    PAYMENT_BANK_NAME: 'SINPE Móvil', PAYMENT_ACCOUNT_ID: '87686102',
    PAYMENT_DESTINATION: 'SINPE Móvil: 8768-6102 · Titular ficticio aprobado',
  });
  assert.equal(result?.receivingAccount, '87686102');
  assert.equal(result?.bankName, 'SINPE Móvil');
  assert.equal(resolveBusinessConfiguration(request(), { ...approved,
    PAYMENT_BANK_NAME: 'SINPE Móvil', PAYMENT_ACCOUNT_ID: '87686102',
    PAYMENT_DESTINATION: 'SINPE Móvil: 8768-6102', ASSOCIATION_RECEIPT_NAME: undefined,
  }), null, 'A confirmed number does not approve the missing receipt identity');
});

test('every business field is bounded, canonical and control-free with no fallback', () => {
  const bounds = { PAYMENT_BANK_NAME: 80, PAYMENT_ACCOUNT_ID: 100, PAYMENT_DESTINATION: 200, ASSOCIATION_RECEIPT_NAME: 200 } as const;
  for (const [key, max] of Object.entries(bounds)) {
    for (const value of [undefined, null, 12, '', ' ', ' value', 'value ', '\nvalue', 'value\u0000', 'value\u0085', 'value\u2028', 'value\u2029', 'x'.repeat(max + 1)]) {
      assert.equal(resolveBusinessConfiguration(request(), { ...approved, [key]: value }), null, `${key} invalid`);
    }
    assert.ok(resolveBusinessConfiguration(request(), { ...approved, [key]: 'x'.repeat(max) }));
  }
});

test('only the existing fully guarded synthetic staging configuration bypasses production approval', () => {
  for (const path of ['/portal/pagos/nuevo', '/api/portal/payments', '/api/portal/slips', '/api/admin/payments/fixture/review']) {
    assert.ok(resolveBusinessConfiguration(request(path, path.startsWith('/api/') ? 'POST' : 'GET'), staging));
  }
  for (const field of ['PAYMENT_BANK_NAME', 'PAYMENT_ACCOUNT_ID', 'PAYMENT_DESTINATION', 'ASSOCIATION_RECEIPT_NAME'] as const) {
    assert.equal(resolveBusinessConfiguration(request(), { ...staging, [field]: 'A different value', PORTAL_BUSINESS_CONFIG_APPROVED: 'true' }), null);
  }
  for (const [key, value] of Object.entries({ STAGING_AUTH_SETUP: 'false', STAGING_PORTAL_TEST: 'false',
    EMAIL_MODE: 'brevo', OCR_MODE: 'groq', PORTAL_DEMO: 'true', PROTOTYPE_ENABLED: 'true',
    PROTOTYPE_LOCAL: 'true', WORKOS_COOKIE_PASSWORD: '', WORKOS_ORGANIZATION_ID: '', ADMIN_USER_IDS: 'user_owner,user_other' })) {
    assert.equal(resolveBusinessConfiguration(request(), { ...staging, [key]: value, PORTAL_BUSINESS_CONFIG_APPROVED: 'true' }), null, key);
  }
  assert.equal(resolveBusinessConfiguration(new Request('https://wrong.example.test/portal/pagos/nuevo'), staging), null);
  assert.equal(resolveBusinessConfiguration(new Request(`${origin}/api/portal/payments`, { method: 'POST', headers: { Origin: 'https://wrong.example.test' } }), staging), null);
  for (const key of ['STAGING_AUTH_SETUP', 'STAGING_PORTAL_TEST', 'STAGING_PARENT_TEST', 'STAGING_PARENT_EMAIL', 'STAGING_PARENT_USER_ID']) {
    assert.equal(resolveBusinessConfiguration(request(), { ...approved, [key]: '' }), null, key);
  }
  for (const key of ['STAGING_PARENT_TEST', 'STAGING_PARENT_EMAIL', 'STAGING_PARENT_USER_ID']) {
    assert.equal(resolveBusinessConfiguration(request(), { ...staging, [key]: 'true' }), null, key);
  }
});

test('pinned parent staging composes with readiness while incomplete or unsafe pins remain held', () => {
  const pinned: BusinessEnvironment = { ...staging, STAGING_PARENT_TEST: 'true',
    STAGING_PARENT_EMAIL: 'parent@example.test', STAGING_PARENT_USER_ID: 'user_parent' };
  for (const path of ['/portal/pagos/nuevo', '/api/portal/payments', '/api/portal/slips', '/api/admin/payments/fixture/review']) {
    assert.ok(resolveBusinessConfiguration(request(path, path.startsWith('/api/') ? 'POST' : 'GET'), pinned), path);
  }
  for (const [key, values] of Object.entries({
    STAGING_PARENT_TEST: [undefined, '', 'false', 'TRUE'],
    STAGING_PARENT_EMAIL: [undefined, '', 'Parent@example.test', 'parent@example.test ', 'invalid'],
    STAGING_PARENT_USER_ID: [undefined, '', 'user_owner', 'not-a-user-id', 'user_parent '],
  })) {
    for (const value of values) assert.equal(resolveBusinessConfiguration(request(), { ...pinned, [key]: value }), null, `${key}: ${value}`);
  }
  for (const patch of [{ EMAIL_MODE: 'brevo' }, { OCR_MODE: 'groq' }, { STAGING_AUTH_SETUP: 'false' },
    { STAGING_PORTAL_TEST: 'false' }, { WORKOS_COOKIE_PASSWORD: '' }, { ADMIN_USER_IDS: 'user_owner,user_other' }]) {
    assert.equal(resolveBusinessConfiguration(request(), { ...pinned, ...patch }), null);
  }
  assert.equal(resolveBusinessConfiguration(new Request('https://wrong.example.test/portal/pagos/nuevo'), pinned), null);
  assert.equal(resolveBusinessConfiguration(new Request(`${origin}/api/portal/payments`, {
    method: 'POST', headers: { Origin: 'https://wrong.example.test' },
  }), pinned), null);
  // Production approval cannot convert copied restricted pins into a normal configuration.
  assert.equal(resolveBusinessConfiguration(request(), { ...approved,
    STAGING_PARENT_TEST: 'true', STAGING_PARENT_EMAIL: 'parent@example.test', STAGING_PARENT_USER_ID: 'user_parent',
  }), null);
});

test('local loopback demo resolves fictional business labels and never leaks to remote hosts', () => {
  const demo: BusinessEnvironment = { PORTAL_ENABLED: 'true', PORTAL_DEMO: 'true', PROTOTYPE_ENABLED: 'true', PROTOTYPE_LOCAL: 'true', PORTAL_BUSINESS_CONFIG_APPROVED: 'false' };
  const local = resolveBusinessConfiguration(new Request('http://127.0.0.1:4322/portal/pagos/nuevo'), demo);
  assert.equal(local?.receivingAccount, 'demo-synthetic-only');
  assert.ok(local?.paymentDestination.includes('no realizar transferencias'));
  assert.equal(resolveBusinessConfiguration(new Request('http://localhost:4322/portal/pagos/nuevo'), demo)?.receivingAccount, 'demo-synthetic-only');
  assert.equal(resolveBusinessConfiguration(request(), demo), null, 'demo must not resolve on the https test origin');
  assert.equal(resolveBusinessConfiguration(new Request('https://127.0.0.1:4322/portal/pagos/nuevo'), demo), null, 'demo requires http loopback');
  assert.equal(resolveBusinessConfiguration(new Request('http://127.0.0.1:4322/portal/pagos/nuevo'), { ...demo, PORTAL_ENABLED: 'false' }), null);
});

test('resolving setup never accesses stores, credentials outside staging, or external services', () => {
  const env = new Proxy({ ...approved }, { get(target, key, receiver) {
    if (['DB', 'SLIPS', 'BREVO_API_KEY', 'WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD'].includes(String(key))) throw new Error('forbidden binding access');
    return Reflect.get(target, key, receiver);
  } });
  assert.ok(resolveBusinessConfiguration(request(), env));
});

// Execute real API handlers with a synthetic Cloudflare module. Only profile sync is permitted;
// any financial/evidence/outbox query or bucket access immediately fails this fixture.
const runtimeEnvironment: Record<string, unknown> = {};
(globalThis as unknown as { __businessTestEnv: unknown }).__businessTestEnv = runtimeEnvironment;
const bindingsModule = `data:text/javascript,${encodeURIComponent('export const env=globalThis.__businessTestEnv')}`;
const hooks = typeof module.registerHooks === 'function' ? module.registerHooks({
  resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: bindingsModule, shortCircuit: true } : next(specifier, context); },
}) : undefined;
// registerHooks arrived in Node 22.15; retain support for the declared Node 22.13 minimum.
const registerLegacyLoader = (module as { register(specifier: string, parentURL: string): void }).register;
if (!hooks) registerLegacyLoader(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    return specifier === 'cloudflare:workers' ? { url: ${JSON.stringify(bindingsModule)}, shortCircuit: true } : next(specifier, context);
  }
`)}`, import.meta.url);
const paymentRoute = await import('../src/pages/api/portal/payments/index');
const slipRoute = await import('../src/pages/api/portal/slips/index');
const reviewRoute = await import('../src/pages/api/admin/payments/[id]/review');
hooks?.deregister();

function fixture(path: string, options: { admin?: boolean; origin?: string; approvalForm?: boolean } = {}) {
  const touched: string[] = [];
  for (const key of Object.keys(runtimeEnvironment)) delete runtimeEnvironment[key];
  Object.assign(runtimeEnvironment, approved, { PORTAL_BUSINESS_CONFIG_APPROVED: 'false',
    DB: { prepare(sql: string) {
      assert.ok(sql.startsWith('INSERT INTO users(') || sql === 'SELECT id,active FROM users WHERE id=?', 'No business query allowed');
      return { bind() { return this; }, async run() { touched.push('profile'); return { success: true }; },
        async first() { return { id: 'user_fixture', active: 1 }; } };
    } },
  });
  Object.defineProperty(runtimeEnvironment, 'SLIPS', { configurable: true, get() { assert.fail('No evidence store access allowed'); } });
  const body = options.approvalForm ? new URLSearchParams({ action: 'approve', expectedRevision: '1', expectedStatus: 'pending', expectedReviewNote: '', bankChecked: 'on' }) : 'body must remain unread';
  const req = new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: options.origin ?? origin,
    Accept: 'application/json', 'Content-Type': options.approvalForm ? 'application/x-www-form-urlencoded' : 'application/octet-stream' }, body });
  const ctx = { request: req, url: new URL(req.url), params: { id: 'payment_fixture' }, locals: {
    portalActor: { id: 'user_fixture', email: 'fixture@example.test', name: 'Synthetic', isAdmin: options.admin === true, mode: 'workos' },
  } } as unknown as APIContext;
  return { ctx, touched };
}

test('new submission and eager upload reject before form parsing or financial/evidence operations', async () => {
  for (const [path, handler] of [['/api/portal/payments', paymentRoute.POST], ['/api/portal/slips', slipRoute.POST]] as const) {
    const { ctx, touched } = fixture(path);
    const response = await handler(ctx);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'business_setup_required' });
    assert.equal(ctx.request.bodyUsed, false);
    assert.deepEqual(touched, ['profile']);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  }
});

test('approval cannot issue a receipt or run email while business setup is held', async () => {
  const { ctx, touched } = fixture('/api/admin/payments/payment_fixture/review', { admin: true, approvalForm: true });
  const response = await reviewRoute.POST(ctx);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'business_setup_required' });
  assert.deepEqual(touched, ['profile']);
});

test('authorization and origin denial precede revealing a business setup hold', async () => {
  const parent = fixture('/api/admin/payments/payment_fixture/review', { approvalForm: true });
  assert.equal((await reviewRoute.POST(parent.ctx)).status, 403);
  assert.deepEqual(parent.touched, []);
  const foreign = fixture('/api/portal/payments', { origin: 'https://foreign.example.test' });
  assert.equal((await paymentRoute.POST(foreign.ctx)).status, 403);
  assert.equal(foreign.ctx.request.bodyUsed, false);
});

test('unrelated historical/corrective mutations are not globally disabled by readiness', async () => {
  const { ctx } = fixture('/api/portal/payments/payment_fixture/revise', { approvalForm: true });
  let called = false;
  const response = await portalMutation(ctx, runtimeEnvironment as unknown as Cloudflare.Env, { back: '/portal' }, async () => {
    called = true; return new Response('correction reached');
  });
  assert.equal(response.status, 200);
  assert.equal(called, true);
});
