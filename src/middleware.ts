import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getAuthConfigurationStatus, isSameOriginMutation } from './lib/auth';
import { getAuthService } from './lib/workos-runtime';

function isPrototypeRoute(pathname: string): boolean {
  return pathname === '/prototype' || pathname.startsWith('/prototype/') ||
    pathname === '/api/prototype' || pathname.startsWith('/api/prototype/') ||
    pathname === '/auth' || pathname.startsWith('/auth/');
}

function isPortalRoute(pathname: string): boolean {
  return pathname === '/portal' || pathname.startsWith('/portal/') ||
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/demo' || pathname === '/api/portal' || pathname.startsWith('/api/portal/') ||
    pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Native form POSTs need their Origin; no-referrer can replace it with null.
  // same-origin still withholds referrers from other sites.
  headers.set('Referrer-Policy', 'same-origin');
  headers.append('Vary', 'Cookie');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const portalRoute = isPortalRoute(context.url.pathname);
  const authRoute = context.url.pathname === '/auth' || context.url.pathname.startsWith('/auth/');
  if (context.isPrerendered || (!portalRoute && !isPrototypeRoute(context.url.pathname))) return next();
  const enabled = portalRoute ? env.PORTAL_ENABLED === 'true' : authRoute
    ? env.PORTAL_ENABLED === 'true' || env.PROTOTYPE_ENABLED === 'true'
    : env.PROTOTYPE_ENABLED === 'true';
  if (!enabled) return privateResponse(new Response('Not found', { status: 404 }));
  if (!isSameOriginMutation(context.request)) {
    return privateResponse(Response.json({ error: 'same_origin_required' }, { status: 403 }));
  }

  if (context.request.method === 'GET' && context.url.pathname === '/portal/invitacion' && context.url.searchParams.has('token')) {
    const token = context.url.searchParams.get('token') ?? '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return privateResponse(new Response('Invitación inválida', {status:400}));
    context.cookies.set('pending-invitation', token, {
      path:'/', httpOnly:true, sameSite:'lax', secure:context.url.protocol === 'https:', maxAge:3600,
    });
    return privateResponse(context.redirect('/portal/invitacion',302));
  }

  // The account-free local lab has its own DEV + loopback guard in its routes.
  // Missing WorkOS credentials never produce an authenticated identity here.
  if (!getAuthConfigurationStatus(env).configured) return privateResponse(await next());

  // The runtime-only SDK excludes the Astro integration's build-time imports.
  // Public prerendering and the synthetic lab still require no credentials.
  const service = getAuthService(env);
  if (!service) return privateResponse(new Response('Authentication unavailable', { status: 503 }));
  try {
    const { auth, refreshedSessionData } = await service.withAuth(context.cookies);
    context.locals.auth = auth;
    if (refreshedSessionData) await service.saveSession(context.cookies, refreshedSessionData);
  } catch {
    context.locals.auth = { user: null };
  }

  // Route guards decide whether a verified identity may access D1/R2. Keeping
  // that decision in the routes also separates the synthetic local lab.
  return privateResponse(await next());
});
