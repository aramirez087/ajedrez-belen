import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { workosClient } from '../../../../lib/auth-pages';
import { settleAdminInvite } from '../../../../lib/portal/admin-invite-flow';
import { PortalError } from '../../../../lib/portal/types';
import { InputError } from '../../../../lib/portal/http';
import { extractInvitationToken, ADMIN_INVITATION_COOKIE } from '../../../../lib/portal/invitation-entry';
import { hashInvitationToken, portalMutation } from '../../../../lib/portal/routes';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(context, env, { back: '/portal/admin-invitacion' }, async (actor, form) => {
  if (env.STAGING_PORTAL_TEST === 'true' || env.STAGING_AUTH_SETUP === 'true') {
    throw new PortalError(403, 'Las invitaciones de administración no están disponibles en esta prueba.', 'forbidden');
  }
  const raw = form.get('token');
  const token = typeof raw === 'string' ? extractInvitationToken(raw.slice(0, 2000)) : null;
  if (!token) throw new InputError('invitation_invalid', 400);
  try {
    const auth = workosClient();
    return await settleAdminInvite(context, env, actor, await hashInvitationToken(token), auth?.client.userManagement ?? null);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'invitation_invalid') {
      context.cookies.delete(ADMIN_INVITATION_COOKIE, { path: '/' });
    }
    throw error;
  }
});
