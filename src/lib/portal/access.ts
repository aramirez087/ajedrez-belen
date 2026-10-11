import type { APIContext } from 'astro';
import { getAuthConfigurationStatus } from '../auth';
import { allowPortalDemo, getDemoIdentity } from './demo-policy';
import { portalResponse } from './http';
import { ensureUser } from './domain';
import type { Actor } from './types';

declare global {
  namespace App { interface Locals { portalActor?: Actor } }
}

export function getPortalIdentity(context: Pick<APIContext,'locals'>, env: Cloudflare.Env): Actor | null {
  if (!getAuthConfigurationStatus(env).configured) return null;
  const auth = context.locals.auth;
  if (!auth?.user || !auth.sessionId || !auth.accessToken || auth.impersonator || !auth.user.emailVerified) return null;
  const allowlist = new Set(env.ADMIN_USER_IDS?.split(',').map(value=>value.trim()).filter(Boolean) ?? []);
  const admin = auth.organizationId === env.WORKOS_ORGANIZATION_ID?.trim() && allowlist.has(auth.user.id);
  return {
    id:auth.user.id, email:auth.user.email.trim().toLowerCase(),
    name:[auth.user.firstName,auth.user.lastName].filter(Boolean).join(' ') || auth.user.email,
    isAdmin:admin, mode:'workos',
  };
}

export async function authorizePortal(context: APIContext, env: Cloudflare.Env, options: {admin?:boolean} = {}): Promise<
  {ok:true;actor:Actor} | {ok:false;response:Response}
> {
  if (env.PORTAL_ENABLED !== 'true') return {ok:false,response:portalResponse('Not found',404)};
  let actor = context.locals.portalActor ?? getPortalIdentity(context,env);
  if (!actor && !context.locals.auth?.user && allowPortalDemo(context.url,import.meta.env.DEV,env)) {
    actor = getDemoIdentity(context.cookies.get('portal-demo-role')?.value);
  }
  if (!actor) {
    const html = context.request.method === 'GET' && !context.url.pathname.startsWith('/api/');
    return {ok:false,response:html ? portalResponse(null,302,{Location:'/portal/acceso'}) : portalResponse('Authentication required',401)};
  }
  if (options.admin && !actor.isAdmin) return {ok:false,response:portalResponse('Administrator access required',403)};
  try {
    const user=await ensureUser(env.DB,actor);
    if(!user.active)return {ok:false,response:portalResponse('La cuenta está desactivada. Contacta a la Asociación.',403)};
  } catch {
    return {ok:false,response:portalResponse('El acceso no está disponible. Revisa la inscripción y la configuración del portal.',403)};
  }
  context.locals.portalActor = actor;
  return {ok:true,actor};
}
