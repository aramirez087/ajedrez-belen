import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse, isSameOriginMutation } from '../../lib/auth';
import { appendAuthHeaders, getAuthService } from '../../lib/workos-runtime';
import { stagingSignOut } from '../../lib/staging-auth';
import { stagingAuthSetupRequested } from '../../lib/staging-auth-policy';

export const prerender = false;

// Use a normal <form method="post" action="/auth/logout"> for logout.
export const POST: APIRoute = async (context) => {
  if (!isSameOriginMutation(context.request)) return new Response('Forbidden', { status: 403 });
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  if (stagingAuthSetupRequested(env)) return stagingSignOut(context, env, service);
  // A shared phone must not hand the next person a saved invitation.
  context.cookies.delete('pending-invitation', { path: '/' });
  context.cookies.delete('wos-pending-auth', { path: '/auth' });
  const auth = context.locals.auth;
  if (!auth?.user) {
    await service.clearSession(context.cookies);
    return context.redirect('/portal/acceso?notice=logged_out', 303);
  }
  // Replace any refresh queued by middleware before Astro appends its cookies.
  await service.clearSession(context.cookies);
  const { logoutUrl, headers } = await service.signOut(auth.sessionId, {
    returnTo: new URL('/portal/acceso?notice=logged_out', env.WORKOS_REDIRECT_URI).toString(),
  });
  return appendAuthHeaders(context.redirect(logoutUrl, 303), headers);
};

export const GET: APIRoute = () => new Response('Use POST to sign out.', {
  status: 405,
  headers: { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' },
});
