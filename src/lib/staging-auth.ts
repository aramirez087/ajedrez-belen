import type { APIContext } from 'astro';
import { appendAuthHeaders, type getAuthService } from './workos-runtime';
import { isStagingSetupOwner, isStagingTestParent, isStagingPortalActor, isStagingParentEnrollment,
  stagingParentTestConfiguration, stagingPortalTestRequested, STAGING_AUTH_SETUP_PATH } from './staging-auth-policy';
import { stagingAuthDeniedPage, stagingAuthFailedPage, stagingAuthSetupPage, stagingParentEnrollmentPage } from './staging-auth-view';

type Service = NonNullable<ReturnType<typeof getAuthService>>;
type Context = Pick<APIContext, 'cookies' | 'locals' | 'url' | 'redirect'>;

// This module intentionally has no database, storage, email or portal-domain dependencies.
export async function stagingSignIn(context: Context, environment: Cloudflare.Env, service: Service) {
  await service.clearSession(context.cookies);
  const { url } = await service.createSignIn(context.cookies, {
    organizationId: environment.WORKOS_ORGANIZATION_ID!.trim(),
    returnPathname: STAGING_AUTH_SETUP_PATH,
  });
  return context.redirect(url, 302);
}

/** Provider registration may send verification mail; deployment requires the exact approved tester. */
export async function stagingParentSignIn(context: Context, environment: Cloudflare.Env, service: Service) {
  const parent = stagingParentTestConfiguration(environment);
  if (!parent) return new Response('Not found', { status: 404 });
  await service.clearSession(context.cookies);
  const options = { returnPathname: '/portal' };
  // The public start URL must not disclose the tester's mailbox. The owner
  // enters it privately; callback and protected requests enforce both pins.
  const { url } = parent.userId
    ? await service.createSignIn(context.cookies, options)
    : await service.createSignUp(context.cookies, options);
  return context.redirect(url, 302);
}

export async function stagingSetup(context: Context, environment: Cloudflare.Env, service: Service) {
  if (!context.locals.auth?.user) {
    await service.clearSession(context.cookies);
    return stagingAuthSetupPage(false, stagingPortalTestRequested(environment));
  }
  if (!isStagingSetupOwner(context, environment)) {
    await service.clearSession(context.cookies);
    return stagingAuthDeniedPage();
  }
  return stagingAuthSetupPage(true, stagingPortalTestRequested(environment));
}

export async function stagingCallback(context: Context, environment: Cloudflare.Env, service: Service) {
  const state = context.url.searchParams.get('state') ?? undefined;
  try {
    const code = context.url.searchParams.get('code');
    // A provider/account-switch restart can return without the original flow.
    // Never reconstruct state, exchange an unbound code, or reuse a callback.
    if (context.url.searchParams.has('error') || !code || !state) {
      if (state) await service.clearPendingVerifier(context.cookies, { state });
      throw new Error('Incomplete callback');
    }
    // AuthKit checks PKCE/state and sets the encrypted cookie. Validate that new
    // session through the SDK before accepting any identity or issuing a return redirect.
    await service.handleCallback(context.cookies, context.cookies, { code, state });
    const { auth, refreshedSessionData } = await service.withAuth(context.cookies);
    context.locals.auth = auth;
    if (!isStagingPortalActor(context, environment)) {
      const enrollment = isStagingParentEnrollment(context, environment);
      await service.clearSession(context.cookies);
      if (enrollment) return stagingParentEnrollmentPage();
      return stagingAuthDeniedPage();
    }
    if (refreshedSessionData) await service.saveSession(context.cookies, refreshedSessionData);
    // Ignore SDK/caller return paths in this restricted mode, including stale portal flows.
    return context.redirect(isStagingTestParent(context, environment) ? '/portal' : STAGING_AUTH_SETUP_PATH, 302);
  } catch {
    await service.clearSession(context.cookies);
    return stagingAuthFailedPage(Boolean(stagingParentTestConfiguration(environment)));
  }
}

export async function stagingSignOut(context: Context, environment: Cloudflare.Env, service: Service) {
  if (!context.locals.auth?.user) {
    await service.clearSession(context.cookies);
    return context.redirect('/', 303);
  }
  if (!isStagingPortalActor(context, environment)) {
    await service.clearSession(context.cookies);
    return stagingAuthDeniedPage();
  }
  // Replace any refreshed cookie queued by middleware before emitting SDK logout headers.
  await service.clearSession(context.cookies);
  const { logoutUrl, headers } = await service.signOut(context.locals.auth.sessionId, {
    returnTo: new URL('/', environment.WORKOS_REDIRECT_URI).toString(),
  });
  return appendAuthHeaders(context.redirect(logoutUrl, 303), headers);
}
