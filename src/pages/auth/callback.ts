import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';
import { stagingCallback } from '../../lib/staging-auth';
import { stagingAuthSetupRequested } from '../../lib/staging-auth-policy';
import { safePortalReturnPath } from '../../lib/portal/invitation-entry';
import { signInWithGoogleCode } from '../../lib/auth-actions';
import { clientMeta } from '../../lib/auth-flow';
import { applyAuthOutcome, clearGoogleOAuthFlow, readGoogleOAuthFlow, workosClient } from '../../lib/auth-pages';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  if (stagingAuthSetupRequested(env)) return stagingCallback(context, env, service);
  // "Continuar con Google" lands here too (same registered redirect URI):
  // its signed flow cookie, not the AuthKit verifier, marks the exchange.
  const googleFlow = await readGoogleOAuthFlow(context.cookies);
  if (googleFlow) {
    clearGoogleOAuthFlow(context.cookies);
    const code = context.url.searchParams.get('code');
    const auth = workosClient();
    if (!auth || !code || context.url.searchParams.has('error') ||
        context.url.searchParams.get('state') !== googleFlow.state) {
      return context.redirect('/auth/entrar?error=login_failed', 302);
    }
    const outcome = await signInWithGoogleCode(auth.client, env, {
      code, codeVerifier: googleFlow.codeVerifier,
      destino: googleFlow.destino, next: googleFlow.next, email: '',
      meta: clientMeta(context.request),
    });
    const applied = await applyAuthOutcome(context, outcome, { next: googleFlow.next });
    if ('response' in applied) return applied.response;
    return context.redirect('/auth/entrar?error=login_failed', 302);
  }
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
    if (result.returnPathname !== '/prototype' && context.cookies.has('pending-admin-invitation')) {
      return context.redirect('/portal/admin-invitacion', 302);
    }
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
