import type { APIContext } from 'astro';
import { getAuthConfigurationStatus } from '../auth';
import { allowPortalDemo, getDemoIdentity } from './demo-policy';
import { portalMessagePage, portalResponse } from './http';
import { ensureUser } from './domain';
import { safePortalReturnPath } from './invitation-entry';
import type { Actor } from './types';
import { isStagingPortalActor, restrictedModeRequested, stagingPortalTestRequested } from '../staging-auth-policy';

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
  if (restrictedModeRequested(env) && (!stagingPortalTestRequested(env) || !isStagingPortalActor(context,env))) {
    return {ok:false,response:portalResponse('Forbidden',403)};
  }
  let actor = context.locals.portalActor ?? getPortalIdentity(context,env);
  if (!actor && !context.locals.auth?.user && allowPortalDemo(context.url,import.meta.env.DEV,env)) {
    actor = getDemoIdentity(context.cookies.get('portal-demo-role')?.value);
  }
  if (!actor) {
    const browserNavigation = !context.url.pathname.startsWith('/api/') &&
      (context.request.method === 'GET' || (context.request.headers.get('accept') ?? '').includes('text/html'));
    // Signed in at WorkOS but the email is not verified yet: say so instead
    // of bouncing to the sign-in page, which looks like an endless loop.
    if (context.locals.auth?.user && context.locals.auth.user.emailVerified === false) {
      return {ok:false,response:browserNavigation
        ? portalMessagePage('Falta verificar tu correo.', 'Ya entraste, pero tu correo todavía no está verificado, así que aún no podemos mostrar tu cuenta. Revisa tu bandeja de entrada (y la carpeta de spam) y abre el mensaje de verificación. Después vuelve a intentarlo. Si el mensaje no llega, escríbenos por WhatsApp.', 401, '/portal/acceso', 'Volver a intentarlo')
        : portalResponse('Authentication required',401)};
    }
    if (!browserNavigation) return {ok:false,response:portalResponse('Authentication required',401)};
    if (context.request.method !== 'GET') {
      return {ok:false,response:portalMessagePage('Tu sesión venció.', 'Estuviste un rato sin actividad y tu sesión se cerró por seguridad, así que lo que ibas a enviar no se guardó. Inicia sesión de nuevo y repite el envío; toma menos de un minuto.', 401, '/portal/acceso', 'Iniciar sesión de nuevo')};
    }
    // Arriving from an invitation link: straight to the sign-in form, which
    // already knows their correo. No instructions page in between.
    if (context.cookies?.has('pending-invitation')) {
      return {ok:false,response:portalResponse(null,302,{Location:'/auth/entrar'})};
    }
    // Remember where the person was headed (e.g. a payment link from WhatsApp).
    const next = safePortalReturnPath(context.url.pathname);
    const location = next && next !== '/portal' ? `/portal/acceso?next=${encodeURIComponent(next)}` : '/portal/acceso';
    return {ok:false,response:portalResponse(null,302,{Location:location})};
  }
  const browserPage = context.request.method === 'GET' && !context.url.pathname.startsWith('/api/');
  if (options.admin && !actor.isAdmin) return {ok:false,response:browserPage
    ? portalMessagePage('Esta sección es de administración.', 'Tu cuenta familiar no tiene acceso a las herramientas de administración. Tu cuenta, tus mensualidades y tus comprobantes siguen disponibles en tu portal.', 403)
    : portalResponse('Administrator access required',403)};
  try {
    const user=await ensureUser(env.DB,actor);
    if(!user.active)return {ok:false,response:browserPage
      ? portalMessagePage('Tu cuenta está desactivada.', 'La cuenta está desactivada. Contacta a la Asociación para revisar tu acceso al portal.', 403, '/portal/acceso', 'Volver al acceso')
      : portalResponse('La cuenta está desactivada. Contacta a la Asociación.',403)};
  } catch {
    return {ok:false,response:browserPage
      ? portalMessagePage('El acceso no está disponible.', 'El acceso no está disponible. Revisa la inscripción y la configuración del portal, o contacta a la Asociación.', 403, '/portal/acceso', 'Volver al acceso')
      : portalResponse('El acceso no está disponible. Revisa la inscripción y la configuración del portal.',403)};
  }
  context.locals.portalActor = actor;
  return {ok:true,actor};
}
