import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { workosClient } from '../../../lib/auth-pages';
import {
  cancelAdminInvitation, createAdminInvitation, releaseStaffMembership, revokeAdminGrant,
} from '../../../lib/portal/admin-access';
import { PortalError } from '../../../lib/portal/types';
import { formText, InputError, successRedirect } from '../../../lib/portal/http';
import { hashInvitationToken, portalMutation } from '../../../lib/portal/routes';

export const prerender = false;

function protectedAdminIds(): string[] {
  return (env.ADMIN_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
}

function invitesClosed(): boolean {
  return env.STAGING_PORTAL_TEST === 'true' || env.STAGING_AUTH_SETUP === 'true';
}

function invitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export const POST: APIRoute = context => portalMutation(context, env, { admin: true, back: '/admin/administradores' }, async (actor, form) => {
  if (invitesClosed()) throw new PortalError(403, 'Las invitaciones de administración no están disponibles en esta prueba.', 'forbidden');
  const action = formText(form, 'action', 20);
  if (action === 'invite') {
    const token = invitationToken();
    await createAdminInvitation(env.DB, actor, {
      email: formText(form, 'email', 254).toLowerCase(),
      tokenHash: await hashInvitationToken(token),
      protectedUserIds: protectedAdminIds(),
    });
    context.cookies.set('portal-admin-invite-link', `${context.url.origin}/portal/admin-invitacion?token=${token}`, {
      path: '/admin/administradores', httpOnly: true, sameSite: 'strict', secure: context.url.protocol === 'https:', maxAge: 300,
    });
    return successRedirect('/admin/administradores', 'invitation_created');
  }
  if (action === 'cancel') {
    await cancelAdminInvitation(env.DB, actor, formText(form, 'invitationId', 36));
    return successRedirect('/admin/administradores', 'admin_invite_cancelled');
  }
  if (action === 'revoke') {
    const userId = formText(form, 'userId', 80);
    await revokeAdminGrant(env.DB, actor, userId, protectedAdminIds());
    const auth = workosClient();
    if (auth && !protectedAdminIds().includes(userId)) {
      try {
        await releaseStaffMembership(auth.client.userManagement, env.WORKOS_ORGANIZATION_ID!.trim(), userId);
      } catch {
        // The portal grant is already off, so a later sign-in is not administration.
      }
    }
    return successRedirect(userId === actor.id ? '/portal' : '/admin/administradores', 'admin_revoked');
  }
  throw new InputError('invalid_fields');
});
