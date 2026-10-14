import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { afterLoginPath } from '../../lib/auth-flow';
import { pendingInvitationEmail, setGoogleOAuthFlow, workosClient } from '../../lib/auth-pages';
import { getPortalIdentity, sessionGrantsAdmin, sessionOrganizationId } from '../../lib/portal/access';
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
  const next = safePortalReturnPath(context.url.searchParams.get('next'));
  const identity = getPortalIdentity(context, env);
  if (identity) {
    const isAdmin = await sessionGrantsAdmin(env, identity.id, sessionOrganizationId(context.locals.auth));
    return context.redirect(afterLoginPath(next, context.cookies.has('pending-invitation'), context.cookies.has('pending-admin-invitation'), isAdmin), 302);
  }
  const auth = workosClient();
  if (!auth) return authUnavailableResponse();
  try {
    const invitedEmail = await pendingInvitationEmail(context.cookies);
    const { url, state, codeVerifier } = await auth.client.userManagement.getAuthorizationUrlWithPKCE({
      provider: 'GoogleOAuth',
      clientId: env.WORKOS_CLIENT_ID!.trim(),
      redirectUri: env.WORKOS_REDIRECT_URI!.trim(),
      ...(invitedEmail ? { loginHint: invitedEmail } : {}),
    });
    // The organization is attached after we know the account. Asking for it
    // here would force every family through the staff organization.
    await setGoogleOAuthFlow(context.cookies, context.url, { state, codeVerifier, destino: 'familia', next });
    return context.redirect(url, 302);
  } catch {
    return context.redirect('/auth/entrar?error=login_failed', 302);
  }
};
