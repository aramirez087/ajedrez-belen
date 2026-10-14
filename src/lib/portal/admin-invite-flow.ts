import type { APIContext } from 'astro';
import { getAuthService } from '../workos-runtime';
import { completeAdminInvite, type StaffDirectory } from './admin-access';
import { successRedirect } from './http';
import { ADMIN_INVITATION_COOKIE } from './invitation-entry';
import type { Actor } from './types';

/** Consume an administrator invitation and send the person to the right next step. */
export async function settleAdminInvite(
  context: Pick<APIContext, 'cookies'>,
  env: Cloudflare.Env,
  actor: Actor,
  tokenHash: string,
  directory: StaffDirectory | null,
): Promise<Response> {
  const outcome = await completeAdminInvite(env.DB, actor, tokenHash, directory, env.WORKOS_ORGANIZATION_ID ?? '');
  context.cookies.delete(ADMIN_INVITATION_COOKIE, { path: '/' });
  if (outcome === 'ready') return successRedirect('/admin', 'admin_joined');
  const service = getAuthService(env);
  if (service) await service.clearSession(context.cookies);
  return successRedirect('/auth/entrar', 'admin_ready');
}
