import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  const state = context.url.searchParams.get('state') ?? undefined;
  try {
    const code = context.url.searchParams.get('code');
    if (context.url.searchParams.has('error') || !code) {
      if (state) await service.clearPendingVerifier(context.cookies, { state });
      throw new Error('Incomplete authentication callback');
    }
    const result = await service.handleCallback(context.cookies, context.cookies, { code, state });
    if (result.returnPathname === '/portal' && context.cookies.has('pending-invitation')) {
      return context.redirect('/portal/invitacion',302);
    }
    const allowed = new Set(['/prototype', '/portal', '/admin']);
    return context.redirect(allowed.has(result.returnPathname) ? result.returnPathname : '/portal', 302);
  } catch {
    // The SDK clears the verifier on failure; never expose raw provider errors.
    const retryPath = env.PORTAL_ENABLED === 'true' ? '/portal/acceso' : '/auth/login';
    return new Response(
      `No fue posible iniciar sesión. Vuelva a ${retryPath} para intentarlo de nuevo.`,
      { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
};
