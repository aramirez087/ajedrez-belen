import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getAuthConfigurationStatus, isSameOriginMutation } from './lib/auth';
import { getAuthService } from './lib/workos-runtime';
import { isStagingSetupOwner, isStagingPortalActor, stagingParentTestConfiguration, restrictedModeRequested, stagingAuthSetupGate } from './lib/staging-auth-policy';
import { INVITATION_TOKEN_PATTERN } from './lib/portal/invitation-entry';

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
  if (restrictedModeRequested(env)) {
    const root = context.url.pathname.split('/')[1].toLowerCase();
    let decodedRoot = root;
    try { decodedRoot = decodeURIComponent(context.url.pathname).split('/')[1].toLowerCase(); } catch { /* Malformed routes cannot match an application route. */ }
    const protectedRoots = ['auth', 'login', 'portal', 'admin', 'api', 'demo', 'prototype'];
    const protectedPath = protectedRoots.includes(root) || protectedRoots.includes(decodedRoot);
    if (!protectedPath) return next();
    const gate = stagingAuthSetupGate(context.request, env);
    if (gate.status !== 200) {
      const body = gate.status === 404 ? 'Not found' : gate.status === 403 ? 'Forbidden'
        : gate.status === 405 ? 'Method not allowed' : 'Authentication unavailable';
      return privateResponse(new Response(body, { status: gate.status,
        headers: gate.allow ? { Allow: gate.allow } : undefined }));
    }
    // Starting or completing PKCE does not inspect an unrelated existing session.
    if (['/auth/admin', '/auth/parent', '/auth/callback'].includes(context.url.pathname)) {
      return privateResponse(await next());
    }
    const service = getAuthService(env);
    if (!service) return privateResponse(new Response('Authentication unavailable', { status: 503 }));
    try {
      const { auth, refreshedSessionData } = await service.withAuth(context.cookies);
      context.locals.auth = auth;
      if (refreshedSessionData) await service.saveSession(context.cookies, refreshedSessionData);
    } catch {
      context.locals.auth = { user: null };
      await service.clearSession(context.cookies);
    }
    if (['portal', 'admin', 'api'].includes(root) && !isStagingPortalActor(context, env)) {
      // Deny before authorizePortal/ensureUser: even a page GET can otherwise write an account.
      const anonymous = !context.locals.auth?.user;
      await service.clearSession(context.cookies);
      if (anonymous && root !== 'api' && ['GET', 'HEAD'].includes(context.request.method)) {
        const login = root === 'portal' && stagingParentTestConfiguration(env) ? '/auth/parent' : '/auth/admin';
        return privateResponse(context.redirect(login, 302));
      }
      return privateResponse(new Response(anonymous ? 'Authentication required' : 'Forbidden', {
        status: anonymous ? 401 : 403,
      }));
    }
    // A pinned parent remains a parent even when requesting an administrator URL.
    // Deny before portal profile synchronization or any financial query.
    const adminPath = context.url.pathname === '/admin' || context.url.pathname.startsWith('/admin/') ||
      context.url.pathname === '/api/admin' || context.url.pathname.startsWith('/api/admin/');
    if (adminPath && !isStagingSetupOwner(context, env)) {
      return privateResponse(new Response('Forbidden', { status: 403 }));
    }
    return privateResponse(await next());
  }
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
    if (!INVITATION_TOKEN_PATTERN.test(token)) return privateResponse(context.redirect('/portal/acceso?error=invitation_invalid',302));
    // Invitations live seven days; the saved copy must live just as long, or
    // anyone who signs up slowly loses the link they arrived with.
    context.cookies.set('pending-invitation', token, {
      path:'/', httpOnly:true, sameSite:'lax', secure:context.url.protocol === 'https:', maxAge:7 * 86400,
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
