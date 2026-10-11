import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse, isSameOriginMutation } from '../../lib/auth';
import { appendAuthHeaders, getAuthService } from '../../lib/workos-runtime';

export const prerender = false;

// Use a normal <form method="post" action="/auth/logout"> for logout.
export const POST: APIRoute = async (context) => {
  if (!isSameOriginMutation(context.request)) return new Response('Forbidden', { status: 403 });
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  const auth = context.locals.auth;
  if (!auth?.user) {
    await service.clearSession(context.cookies);
    return context.redirect('/', 303);
  }
  const { logoutUrl, headers } = await service.signOut(auth.sessionId, {
    returnTo: new URL('/', env.WORKOS_REDIRECT_URI).toString(),
  });
  return appendAuthHeaders(context.redirect(logoutUrl, 303), headers);
};

export const GET: APIRoute = () => new Response('Use POST to sign out.', {
  status: 405,
  headers: { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' },
});
