import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { APIContext } from 'astro';
import { AstroCookies, attachCookiesToResponse } from '../node_modules/astro/dist/core/cookies/index.js';
import { prepareResponse } from '../node_modules/astro/dist/core/app/prepare-response.js';
import { getAuthService } from '../src/lib/workos-runtime.ts';
import { stagingCallback, stagingParentSignIn, stagingSignIn } from '../src/lib/staging-auth.ts';

const origin = 'https://example.test';
const sessionName = 'wos-session';
const syntheticCode = 'PRIVATE_SYNTHETIC_CODE';
const syntheticFailure = 'PRIVATE_PROVIDER_FAILURE';
const oldSession = 'PRIVATE_OLD_SESSION';
const refreshedSession = 'PRIVATE_REFRESHED_SESSION';

function environment(parent = true, overrides: Record<string, unknown> = {}): Cloudflare.Env {
  const value = {
    STAGING_AUTH_SETUP: 'true', STAGING_PORTAL_TEST: 'true', PORTAL_ENABLED: 'true',
    PORTAL_DEMO: 'false', PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false',
    EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
    WORKOS_API_KEY: 'sk_SYNTHETIC_ONLY', WORKOS_CLIENT_ID: 'client_fixture',
    WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-password-of-sufficient-length',
    WORKOS_REDIRECT_URI: `${origin}/auth/callback`,
    WORKOS_ORGANIZATION_ID: 'org_fixture', ADMIN_USER_IDS: 'user_ownerfixture',
    ...(parent ? { STAGING_PARENT_TEST: 'true', STAGING_PARENT_EMAIL: 'parent@example.test',
      STAGING_PARENT_USER_ID: 'user_parentfixture' } : {}),
    ...overrides,
  };
  for (const binding of ['DB', 'SLIPS', 'BREVO_API_KEY', 'GROQ_API_KEY']) {
    Object.defineProperty(value, binding, { get() { assert.fail(`Forbidden binding: ${binding}`); } });
  }
  return value as unknown as Cloudflare.Env;
}
const service = getAuthService(environment())!;

function context(path: string, jar: Map<string, string> = new Map()) {
  const request = new Request(new URL(path, origin), {
    headers: { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
  });
  const cookies = new AstroCookies(request, {
    warn() { assert.fail('Cookies must be changed before response serialization'); },
  });
  // A stale cookie or pending refresh must not survive callback failure.
  cookies.set(sessionName, refreshedSession, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
  return {
    request, cookies, url: new URL(request.url), locals: { auth: { user: null } },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

function applyCookies(response: Response, ctx: APIContext, previous = new Map<string, string>()) {
  attachCookiesToResponse(response, ctx.cookies);
  prepareResponse(response, { addCookieHeader: true });
  const jar = new Map(previous);
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0];
    const delimiter = pair.indexOf('=');
    const name = pair.slice(0, delimiter);
    const value = pair.slice(delimiter + 1);
    const expires = /(?:^|;)\s*Expires=([^;]+)/i.exec(header)?.[1];
    if (/Max-Age=0(?:;|$)/i.test(header) || (expires !== undefined && Date.parse(expires) <= 0)) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

async function flow() {
  const ctx = context('/auth/admin');
  const result = await service.createSignIn(ctx.cookies, { returnPathname: '/auth/setup', organizationId: 'org_fixture' });
  const state = new URL(result.url).searchParams.get('state')!;
  assert.ok(state, 'Use an actual locally sealed SDK state');
  const jar = applyCookies(new Response(null, { status: 302 }), ctx);
  assert.equal(jar.get(result.cookieName), state);
  jar.set(sessionName, oldSession);
  return { state, cookieName: result.cookieName, jar };
}

function isolate(t: TestContext) {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden'); });
  const withAuth = t.mock.method(service, 'withAuth', async () => { throw new Error('Failed callbacks must not authenticate'); });
  const exchange = t.mock.method(service.getWorkOS().userManagement, 'authenticateWithCode', async () => {
    throw new Error(syntheticFailure);
  });
  const realCallback = service.handleCallback.bind(service);
  const callback = t.mock.method(service, 'handleCallback', (...args: Parameters<typeof service.handleCallback>) => realCallback(...args));
  t.after(() => {
    assert.equal(network.mock.callCount(), 0, 'No real transport request');
    assert.equal(withAuth.mock.callCount(), 0, 'No session lookup after rejected callback');
  });
  return { exchange, callback };
}

async function assertFailure(response: Response, ctx: APIContext, parent: boolean, hidden: string[] = []) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.has('location'), false);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  const body = await response.text();
  const hrefs = [...body.matchAll(/href=["']([^"']+)["']/g)].map(match => match[1]);
  assert.deepEqual(hrefs.sort(), (parent ? ['/auth/admin', '/auth/parent'] : ['/auth/admin']).sort());
  const recoveryAnchors = [...body.matchAll(/<a\b[^>]*\bhref=["']\/auth\/(?:admin|parent)["'][^>]*>/gi)];
  assert.equal(recoveryAnchors.length, hrefs.length);
  for (const [anchor] of recoveryAnchors) {
    assert.ok(/\breferrerpolicy=["']no-referrer["']/i.test(anchor)
      || /\brel=["'][^"']*\bnoreferrer\b[^"']*["']/i.test(anchor),
    'Recovery must not forward the failed callback query in Referer');
  }
  assert.match(body, /(?:iniciar|intentar|volver|reintentar|acceso|sesión)/i, 'Offer a Spanish recovery action');
  for (const secret of [syntheticCode, syntheticFailure, oldSession, refreshedSession,
    'parent@example.test', 'user_parentfixture', 'sk_SYNTHETIC_ONLY', 'attacker.example', ...hidden]) {
    assert.equal(body.includes(secret), false, 'Never reflect callback, provider or identity details');
  }
  assert.equal(ctx.cookies.get(sessionName), undefined);
  const jar = applyCookies(response, ctx);
  assert.equal(jar.has(sessionName), false);
  const sessionHeaders = response.headers.getSetCookie().filter(header => header.startsWith(`${sessionName}=`));
  assert.ok(sessionHeaders.length > 0);
  for (const header of sessionHeaders) {
    assert.doesNotMatch(header, /PRIVATE_OLD_SESSION|PRIVATE_REFRESHED_SESSION/);
    assert.match(header, /(?:Max-Age=0|Expires=Thu, 01 Jan 1970 00:00:00 GMT)/i);
  }
  return jar;
}

test('missing or empty callback state with a real verifier never reaches exchange or session lookup', async t => {
  const { exchange, callback } = isolate(t);
  for (const suffix of ['', '&state=']) {
    const generated = await flow();
    const ctx = context(`/auth/callback?code=${syntheticCode}${suffix}`, generated.jar);
    const response = await stagingCallback(ctx, environment(), service);
    assert.equal(response.status, 400);
    assert.equal(exchange.mock.callCount(), 0);
    assert.equal(callback.mock.callCount(), 0, 'Missing state must be rejected before SDK callback handling');
    await assertFailure(response, ctx, true, [generated.state]);
  }
});

test('recovery always links to owner sign-in and links to parent sign-in only for valid parent configuration', async t => {
  isolate(t);
  for (const env of [environment(false), environment(true, { STAGING_PARENT_EMAIL: 'invalid' }),
    environment(true, { STAGING_PARENT_USER_ID: 'user_ownerfixture' })]) {
    const ctx = context('/auth/callback?returnTo=https://attacker.example&login_hint=parent@example.test');
    await assertFailure(await stagingCallback(ctx, env, service), ctx, false);
  }
  const ctx = context('/auth/callback?returnTo=https://attacker.example');
  await assertFailure(await stagingCallback(ctx, environment(), service), ctx, true);
});

test('provider error clears its actual verifier without exchanging a code or reflecting provider details', async t => {
  const { exchange, callback } = isolate(t);
  const generated = await flow();
  const query = new URLSearchParams({ code: syntheticCode, state: generated.state,
    error: syntheticFailure, error_description: '<script>PRIVATE_PROVIDER_FAILURE</script>' });
  const ctx = context(`/auth/callback?${query}`, generated.jar);
  const response = await stagingCallback(ctx, environment(), service);
  assert.equal(exchange.mock.callCount(), 0);
  assert.equal(callback.mock.callCount(), 0);
  assert.equal(ctx.cookies.get(generated.cookieName), undefined);
  await assertFailure(response, ctx, true, [generated.state]);
});

test('missing, stale or mismatched real verifier cookies reject before code exchange', async t => {
  const { exchange } = isolate(t);
  const old = await flow();
  const current = await flow();
  const cases = [new Map<string, string>(), current.jar,
    new Map([[old.cookieName, current.state], [sessionName, oldSession]])];
  for (const jar of cases) {
    const ctx = context(`/auth/callback?${new URLSearchParams({ code: syntheticCode, state: old.state })}`, jar);
    const response = await stagingCallback(ctx, environment(), service);
    assert.equal(exchange.mock.callCount(), 0);
    assert.equal(ctx.cookies.get(old.cookieName), undefined);
    await assertFailure(response, ctx, true, [old.state, current.state]);
  }
});

test('a failed synthetic exchange expires the real verifier and replay cannot exchange again', async t => {
  const { exchange } = isolate(t);
  const generated = await flow();
  const path = `/auth/callback?${new URLSearchParams({ code: syntheticCode, state: generated.state })}`;
  const first = context(path, generated.jar);
  const firstResponse = await stagingCallback(first, environment(), service);
  assert.equal(exchange.mock.callCount(), 1, 'Exercise the real SDK state validation before a synthetic rejection');
  assert.equal(first.cookies.get(generated.cookieName), undefined);
  const browserJar = await assertFailure(firstResponse, first, true, [generated.state]);
  const repeated = context(path, browserJar);
  await assertFailure(await stagingCallback(repeated, environment(), service), repeated, true, [generated.state]);
  assert.equal(exchange.mock.callCount(), 1, 'Replayed callback cannot reuse a consumed verifier');
});

test('recovery can start a fresh parent or owner flow without retaining a stale app session', async t => {
  const { exchange } = isolate(t);
  for (const isParent of [true, false]) {
    const failed = context(`/auth/callback?code=${syntheticCode}`, new Map([[sessionName, oldSession]]));
    const response = await stagingCallback(failed, environment(), service);
    const jar = await assertFailure(response, failed, true);
    const start = context(`${isParent ? '/auth/parent' : '/auth/admin'}?returnTo=https://attacker.example`, jar);
    const next = await (isParent ? stagingParentSignIn : stagingSignIn)(start, environment(), service);
    assert.equal(next.status, 302);
    const target = new URL(next.headers.get('location')!);
    assert.equal(target.origin, 'https://api.workos.com');
    assert.equal(target.searchParams.get('screen_hint'), 'sign-in');
    assert.equal(target.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
    assert.equal(target.searchParams.get('organization_id'), isParent ? null : 'org_fixture');
    assert.equal(target.searchParams.has('login_hint'), false);
    assert.ok(target.searchParams.get('state'));
    assert.equal(start.cookies.get(sessionName), undefined);
  }
  assert.equal(exchange.mock.callCount(), 0);
});
