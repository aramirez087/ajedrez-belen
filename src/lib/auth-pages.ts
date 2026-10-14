import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getAuthConfigurationStatus } from './auth';
import { getAuthService } from './workos-runtime';
import type { AuthOutcome } from './auth-actions';
import {
  GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_MAX_AGE_SECONDS, PENDING_AUTH_COOKIE, PENDING_AUTH_MAX_AGE_SECONDS,
  afterLoginPath, decodeGoogleOAuthFlow, decodePendingAuth, encodeGoogleOAuthFlow, encodePendingAuth,
  type GoogleOAuthFlow, type PendingAuth,
} from './auth-flow';
import { sessionGrantsAdmin } from './portal/access';

import { getAdminInvitationPreview } from './portal/admin-access';
import { getInvitationPreview, type InvitationPreview } from './portal/domain';
import { ADMIN_INVITATION_COOKIE, INVITATION_TOKEN_PATTERN } from './portal/invitation-entry';
import { hashInvitationToken } from './portal/routes';

type Cookies = APIContext['cookies'];

/**
 * The invitation a person arrived with, resolved from the cookie the shared
 * link left behind. Lets the sign-in screens greet them by their invited
 * correo (prefilled, nothing to type or remember) instead of a blank form.
 */
export async function pendingInvitation(cookies: Cookies): Promise<InvitationPreview | null> {
  const token = cookies.get('pending-invitation')?.value;
  if (!token || !INVITATION_TOKEN_PATTERN.test(token) || !env.DB) return null;
  return getInvitationPreview(env.DB, await hashInvitationToken(token)).catch(() => null);
}

/** The correo of a still-usable pending invitation, or null when there is none. */
export async function pendingInvitationEmail(cookies: Cookies): Promise<string | null> {
  const preview = await pendingInvitation(cookies);
  if (preview?.status === 'ready' && preview.email) return preview.email;
  const token = cookies.get(ADMIN_INVITATION_COOKIE)?.value;
  if (!token || !INVITATION_TOKEN_PATTERN.test(token) || !env.DB) return null;
  const adminInvite = await getAdminInvitationPreview(env.DB, await hashInvitationToken(token)).catch(() => null);
  return adminInvite?.status === 'ready' ? adminInvite.email : null;
}

/** The WorkOS client behind the auth service, or null when unconfigured. */
export function workosClient() {
  if (!getAuthConfigurationStatus(env).configured) return null;
  const service = getAuthService(env);
  return service ? { service, client: service.getWorkOS() } : null;
}

export async function setPendingAuth(cookies: Cookies, url: URL, pending: PendingAuth): Promise<void> {
  cookies.set(PENDING_AUTH_COOKIE, await encodePendingAuth(pending, env.WORKOS_COOKIE_PASSWORD!), {
    path: '/auth', httpOnly: true, sameSite: 'lax',
    secure: url.protocol === 'https:', maxAge: PENDING_AUTH_MAX_AGE_SECONDS,
  });
}

export async function readPendingAuth(cookies: Cookies): Promise<PendingAuth | null> {
  if (!env.WORKOS_COOKIE_PASSWORD) return null;
  return decodePendingAuth(cookies.get(PENDING_AUTH_COOKIE)?.value, env.WORKOS_COOKIE_PASSWORD);
}

export function clearPendingAuth(cookies: Cookies): void {
  cookies.delete(PENDING_AUTH_COOKIE, { path: '/auth' });
}

export async function setGoogleOAuthFlow(cookies: Cookies, url: URL, flow: GoogleOAuthFlow): Promise<void> {
  cookies.set(GOOGLE_OAUTH_COOKIE, await encodeGoogleOAuthFlow(flow, env.WORKOS_COOKIE_PASSWORD!), {
    path: '/auth', httpOnly: true, sameSite: 'lax',
    secure: url.protocol === 'https:', maxAge: GOOGLE_OAUTH_MAX_AGE_SECONDS,
  });
}

export async function readGoogleOAuthFlow(cookies: Cookies): Promise<GoogleOAuthFlow | null> {
  if (!env.WORKOS_COOKIE_PASSWORD) return null;
  return decodeGoogleOAuthFlow(cookies.get(GOOGLE_OAUTH_COOKIE)?.value, env.WORKOS_COOKIE_PASSWORD);
}

export function clearGoogleOAuthFlow(cookies: Cookies): void {
  cookies.delete(GOOGLE_OAUTH_COOKIE, { path: '/auth' });
}

/**
 * Turn an authentication outcome into a redirect, or return the Spanish
 * error to render inline. Sessions go through the SDK's saveSession so
 * the cookie is identical to the one the hosted flow used to set.
 */
export async function applyAuthOutcome(
  context: Pick<APIContext, 'cookies' | 'url' | 'redirect'>,
  outcome: AuthOutcome,
  flow: { next: string | null },
): Promise<{ response: Response } | { error: string }> {
  if (outcome.kind === 'error') return { error: outcome.message };
  if (outcome.kind === 'pending') {
    await setPendingAuth(context.cookies, context.url, outcome.pending);
    const target = outcome.pending.kind === 'organization' ? '/auth/organizacion' : '/auth/codigo';
    return { response: context.redirect(target, 303) };
  }
  const service = getAuthService(env);
  if (!service) return { error: 'El acceso no está disponible en este momento. Vuelve a intentarlo más tarde.' };
  clearPendingAuth(context.cookies);
  await service.saveSession(context.cookies, outcome.sealedSession);
  const isAdmin = await sessionGrantsAdmin(env, outcome.userId, outcome.organizationId);
  const destination = afterLoginPath(
    flow.next,
    context.cookies.has('pending-invitation'),
    context.cookies.has(ADMIN_INVITATION_COOKIE),
    isAdmin,
  );
  return { response: context.redirect(destination, 303) };
}
