import assert from 'node:assert/strict';
import * as module from 'node:module';
import test from 'node:test';
import type { APIContext } from 'astro';
import { AstroCookies, attachCookiesToResponse } from '../node_modules/astro/dist/core/cookies/index.js';
import { prepareResponse } from '../node_modules/astro/dist/core/app/prepare-response.js';
import { getAuthService } from '../src/lib/workos-runtime.ts';

const environment = {
  PORTAL_ENABLED: 'true', STAGING_AUTH_SETUP: 'false', STAGING_PORTAL_TEST: 'false',
  WORKOS_API_KEY: 'sk_test_fixture', WORKOS_CLIENT_ID: 'client_fixture',
  WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-password-of-sufficient-length',
  WORKOS_REDIRECT_URI: 'https://example.test/auth/callback',
  WORKOS_ORGANIZATION_ID: 'org_fixture',
};

// Import the real route with only the unavailable Workers binding replaced.
// No application implementation is copied or rewritten for this regression.
const bindingsModule = `data:text/javascript,${encodeURIComponent(`export const env = ${JSON.stringify(environment)};`)}`;
const hooks = typeof module.registerHooks === 'function' ? module.registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'cloudflare:workers'
      ? { url: bindingsModule, shortCircuit: true }
      : nextResolve(specifier, context);
  },
}) : undefined;
// registerHooks arrived in Node 22.15; the project also supports Node 22.13.
const registerLegacyLoader = (module as { register(specifier: string, parentURL: string): void }).register;
if (!hooks) registerLegacyLoader(`data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'cloudflare:workers') return { url: ${JSON.stringify(bindingsModule)}, shortCircuit: true };
      return nextResolve(specifier, context);
    }
  `)}`, import.meta.url);
const { POST, GET } = await import('../src/pages/auth/logout.ts');
hooks?.deregister();
const service = getAuthService(environment)!;
const sessionCookie = 'wos-session';

function contextWithRefresh(authenticated = true, origin = 'https://example.test') {
  const request = new Request('https://example.test/auth/logout?returnTo=https://unrelated.example/', {
    method: 'POST', headers: { Origin: origin, Cookie: `${sessionCookie}=synthetic-old-session` },
  });
  const cookies = new AstroCookies(request, {
    warn() { assert.fail('Cookies must be updated before response serialization'); },
  });
  cookies.set(sessionCookie, 'synthetic-refreshed-session', {
    path: '/', maxAge: 28_800, httpOnly: true, secure: true, sameSite: 'lax',
  });
  const context = {
    request, cookies, url: new URL(request.url),
    locals: { auth: authenticated ? {
      user: { id: 'user_parent_fixture', email: 'parent@example.test', emailVerified: true },
      sessionId: 'session_fixture', accessToken: 'verified-sdk-fixture',
      organizationId: null, impersonator: null,
    } : { user: null } },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return { context, cookies };
}

function serializedSessionCookies(response: Response, cookies: AstroCookies) {
  attachCookiesToResponse(response, cookies);
  prepareResponse(response, { addCookieHeader: true });
  return response.headers.getSetCookie().filter(header => header.startsWith(`${sessionCookie}=`));
}

function assertOnlyExpired(headers: string[]) {
  assert.ok(headers.length > 0, 'Logout must delete its session cookie');
  for (const header of headers) {
    assert.doesNotMatch(header, /synthetic-old-session|synthetic-refreshed-session/);
    assert.match(header, /(?:^|;)\s*Path=\/(?:;|$)/i);
    assert.doesNotMatch(header, /(?:^|;)\s*Domain=/i);
    const expires = /(?:^|;)\s*Expires=([^;]+)/i.exec(header)?.[1];
    assert.ok(/(?:^|;)\s*Max-Age=0(?:;|$)/i.test(header)
      || (expires !== undefined && Date.parse(expires) <= 0));
  }
  assert.match(headers.at(-1)!, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
}

test('parent logout replaces a pending middleware refresh before Astro appends the SDK and adapter cookies', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in synthetic logout tests'); });
  const { context, cookies } = contextWithRefresh();
  const realSignOut = service.signOut.bind(service);
  const signOut = t.mock.method(service, 'signOut', async (...[sessionId, options]: Parameters<typeof service.signOut>) => {
    assert.equal(cookies.get(sessionCookie), undefined);
    assert.equal(sessionId, 'session_fixture');
    assert.deepEqual(options, { returnTo: 'https://example.test/' });
    return realSignOut(sessionId, options);
  });
  const response = await POST(context);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')!).origin, 'https://api.workos.com');
  const headers = serializedSessionCookies(response, cookies);
  assert.equal(headers.length, 2, 'Keep SDK deletion and append the Astro deletion');
  assertOnlyExpired(headers);
  assert.equal(signOut.mock.callCount(), 1);
  assert.equal(network.mock.callCount(), 0);
});

test('parent logout keeps its pending cookie expired if generating the provider logout URL fails', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in synthetic logout tests'); });
  const { context, cookies } = contextWithRefresh();
  const failure = new Error('Synthetic provider failure');
  t.mock.method(service, 'signOut', async () => { throw failure; });
  await assert.rejects(async () => POST(context), error => error === failure);
  assert.equal(cookies.get(sessionCookie), undefined);
  // Astro serializes these same pending cookies when preparing its error response.
  const headers = serializedSessionCookies(new Response(null, { status: 500 }), cookies);
  assert.equal(headers.length, 1);
  assertOnlyExpired(headers);
  assert.equal(network.mock.callCount(), 0);
});

test('parent logout without a verified session clears the local cookie without invoking provider logout', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in synthetic logout tests'); });
  const { context, cookies } = contextWithRefresh(false);
  const signOut = t.mock.method(service, 'signOut', async () => { throw new Error('No provider logout for an unverified session'); });
  const response = await POST(context);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assertOnlyExpired(serializedSessionCookies(response, cookies));
  assert.equal(signOut.mock.callCount(), 0);
  assert.equal(network.mock.callCount(), 0);
});

test('parent logout rejects cross-origin POST and GET without clearing the session', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in synthetic logout tests'); });
  const { context, cookies } = contextWithRefresh(true, 'https://unrelated.example');
  const clearSession = t.mock.method(service, 'clearSession', async () => { throw new Error('Forbidden logout must not mutate cookies'); });
  const signOut = t.mock.method(service, 'signOut', async () => { throw new Error('Forbidden logout must not contact WorkOS'); });
  assert.equal((await POST(context)).status, 403);
  const get = await GET(context);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal(cookies.get(sessionCookie)?.value, 'synthetic-refreshed-session');
  assert.equal(clearSession.mock.callCount(), 0);
  assert.equal(signOut.mock.callCount(), 0);
  assert.equal(network.mock.callCount(), 0);
});
