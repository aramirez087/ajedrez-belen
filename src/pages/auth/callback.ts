import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';
import { stagingCallback } from '../../lib/staging-auth';
import { stagingAuthSetupRequested } from '../../lib/staging-auth-policy';
import { safePortalReturnPath } from '../../lib/portal/invitation-entry';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  if (stagingAuthSetupRequested(env)) return stagingCallback(context, env, service);
  const state = context.url.searchParams.get('state') ?? undefined;
  try {
    const code = context.url.searchParams.get('code');
    if (context.url.searchParams.has('error') || !code) {
      if (state) await service.clearPendingVerifier(context.cookies, { state });
      throw new Error('Incomplete authentication callback');
    }
    const result = await service.handleCallback(context.cookies, context.cookies, { code, state });
    // A pending invitation wins over the generic landing page no matter which
    // sign-in button the person tapped; the invitation page explains the rest.
    if (result.returnPathname !== '/prototype' && context.cookies.has('pending-invitation')) {
      return context.redirect('/portal/invitacion', 302);
    }
    const safeNext = safePortalReturnPath(result.returnPathname);
    if (safeNext) return context.redirect(safeNext, 302);
    const allowed = new Set(['/prototype', '/portal', '/admin']);
    return context.redirect(allowed.has(result.returnPathname) ? result.returnPathname : '/portal', 302);
  } catch {
    // The SDK clears the verifier on failure; never expose raw provider errors.
    // Send people to a real page with a retry button, keeping their invitation.
    if (env.PORTAL_ENABLED === 'true') return context.redirect('/portal/acceso?error=login_failed', 302);
    return context.redirect('/auth/login', 302);
  }
};
