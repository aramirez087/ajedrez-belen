import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
// Exercise the installed Astro adapter's actual outgoing-cookie serialization.
import { AstroCookies, attachCookiesToResponse } from '../node_modules/astro/dist/core/cookies/index.js';
import { prepareResponse } from '../node_modules/astro/dist/core/app/prepare-response.js';
import type { getAuthService } from '../src/lib/workos-runtime.ts';
import { stagingSignOut } from '../src/lib/staging-auth.ts';

type Service = NonNullable<ReturnType<typeof getAuthService>>;
const sessionCookie = 'wos-session';
const refreshedValue = 'synthetic-refreshed-session';
const sdkDeletion = `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
const env = {
  STAGING_AUTH_SETUP: 'true', PORTAL_ENABLED: 'false', PORTAL_DEMO: 'false',
  PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false', EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
  WORKOS_API_KEY: 'sk_fixture', WORKOS_CLIENT_ID: 'client_fixture',
  WORKOS_COOKIE_PASSWORD: 'synthetic-cookie-secret-not-for-live-use-123456',
  WORKOS_REDIRECT_URI: 'https://example.test/auth/callback', WORKOS_ORGANIZATION_ID: 'org_fixture',
  ADMIN_USER_IDS: 'user_fixture',
} as unknown as Cloudflare.Env;

function refreshedContext() {
  const request = new Request('https://example.test/auth/logout', {
    method: 'POST', headers: { Cookie: `${sessionCookie}=synthetic-old-session` },
  });
  const cookies = new AstroCookies(request, {
    warn() { assert.fail('Cookies must be updated before Astro serializes the response'); },
  });
  // The middleware can refresh the authenticated owner's session before the route runs.
  cookies.set(sessionCookie, refreshedValue, {
    path: '/', maxAge: 28_800, httpOnly: true, secure: true, sameSite: 'lax',
  });
  assert.equal(cookies.get(sessionCookie)?.value, refreshedValue);
  const context = {
    cookies, url: new URL(request.url),
    locals: { auth: {
      user: { id: 'user_fixture', email: 'synthetic@example.test', emailVerified: true },
      sessionId: 'session_fixture', accessToken: 'verified-sdk-fixture',
      organizationId: 'org_fixture', impersonator: null,
    } },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return { cookies, context };
}

function serialize(response: Response, cookies: AstroCookies) {
  attachCookiesToResponse(response, cookies);
  prepareResponse(response, { addCookieHeader: true });
  return response.headers.getSetCookie();
}

function assertOnlyExpiredSessionCookies(headers: string[]) {
  const sessionHeaders = headers.filter(header => header.startsWith(`${sessionCookie}=`));
  assert.ok(sessionHeaders.length > 0, 'Logout must emit a session deletion');
  for (const header of sessionHeaders) {
    assert.doesNotMatch(header, /synthetic-old-session|synthetic-refreshed-session/);
    assert.match(header, /(?:^|;)\s*Path=\/(?:;|$)/i);
    assert.doesNotMatch(header, /(?:^|;)\s*Domain=/i);
    const expires = /(?:^|;)\s*Expires=([^;]+)/i.exec(header)?.[1];
    const expired = /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(header)
      || (expires !== undefined && Date.parse(expires) <= 0);
    assert.ok(expired, `Session cookie must be expired: ${header}`);
  }
  // Astro appends its pending cookies after SDK headers; the last value wins in a browser.
  assert.match(sessionHeaders.at(-1)!, /(?:^|;)\s*Expires=Thu, 01 Jan 1970 00:00:00 GMT(?:;|$)/i);
}

test('logout cannot resurrect a middleware-refreshed session when Astro appends cookies after SDK deletion headers', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in cookie regression'); });
  const { cookies, context } = refreshedContext();
  const calls: string[] = [];
  const service = {
    async clearSession(target: APIContext['cookies']) {
      calls.push('clearSession');
      assert.equal(target, cookies);
      // Match AstroCookieStorage.clearCookie rather than merely returning a deletion header.
      target.delete(sessionCookie, { path: '/' });
    },
    async signOut() {
      calls.push('signOut');
      assert.equal(cookies.get(sessionCookie), undefined);
      return {
        logoutUrl: 'https://api.workos.com/user_management/sessions/logout',
        headers: { 'Set-Cookie': sdkDeletion },
      };
    },
  } as unknown as Service;

  const response = await stagingSignOut(context, env, service);
  assert.equal(response.status, 303);
  assert.deepEqual(calls, ['clearSession', 'signOut']);
  const headers = serialize(response, cookies);
  assert.equal(headers.length, 2, 'Preserve SDK deletion and append the Astro deletion');
  assert.equal(headers[0], sdkDeletion);
  assertOnlyExpiredSessionCookies(headers);
  assert.equal(network.mock.callCount(), 0);
});

test('provider logout failure still leaves an expired cookie queued for Astro error-response serialization', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in cookie regression'); });
  const { cookies, context } = refreshedContext();
  const providerFailure = new Error('Synthetic provider logout failure');
  const service = {
    async clearSession(target: APIContext['cookies']) {
      target.delete(sessionCookie, { path: '/' });
    },
    async signOut() { throw providerFailure; },
  } as unknown as Service;

  await assert.rejects(stagingSignOut(context, env, service), error => error === providerFailure);
  assert.equal(cookies.get(sessionCookie), undefined);
  // Astro uses the same preparation helper for an error response after a route throws.
  const headers = serialize(new Response(null, { status: 500 }), cookies);
  assert.equal(headers.length, 1);
  assertOnlyExpiredSessionCookies(headers);
  assert.equal(network.mock.callCount(), 0);
});
