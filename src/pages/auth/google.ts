import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { afterLoginPath, parseDestino } from '../../lib/auth-flow';
import { pendingInvitationEmail, setGoogleOAuthFlow, workosClient } from '../../lib/auth-pages';
import { getPortalIdentity } from '../../lib/portal/access';
import { safePortalReturnPath } from '../../lib/portal/invitation-entry';
import { portalResponse } from '../../lib/portal/http';
export const prerender = false;

/**
 * "Continuar con Google": hand the person to Google through WorkOS and let
 * the existing /auth/callback finish the sign-in. The invited correo rides
 * along as a login hint so the right Google account is preselected.
 */
export const GET: APIRoute = async (context) => {
  if (env.PORTAL_ENABLED !== 'true') return portalResponse('No encontrado.', 404);
  const destino = parseDestino(context.url.searchParams.get('destino'));
  const next = safePortalReturnPath(context.url.searchParams.get('next'));
  const identity = getPortalIdentity(context, env);
  if (identity) return context.redirect(afterLoginPath(destino, next, context.cookies.has('pending-invitation')), 302);
  const auth = workosClient();
  if (!auth) return authUnavailableResponse();
  try {
    const invitedEmail = destino === 'familia' ? await pendingInvitationEmail(context.cookies) : null;
    const { url, state, codeVerifier } = await auth.client.userManagement.getAuthorizationUrlWithPKCE({
      provider: 'GoogleOAuth',
      clientId: env.WORKOS_CLIENT_ID!.trim(),
      redirectUri: env.WORKOS_REDIRECT_URI!.trim(),
      ...(destino === 'admin' ? { organizationId: env.WORKOS_ORGANIZATION_ID!.trim() } : {}),
      ...(invitedEmail ? { loginHint: invitedEmail } : {}),
    });
    await setGoogleOAuthFlow(context.cookies, context.url, { state, codeVerifier, destino, next });
    return context.redirect(url, 302);
  } catch {
    return context.redirect('/auth/entrar?error=login_failed', 302);
  }
};
