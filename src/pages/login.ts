import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../lib/auth';
import { getAuthService } from '../lib/workos-runtime';

export const prerender = false;

/**
 * Initiate login URI for WorkOS AuthKit.
 * Sends people to the app's own Spanish sign-in page; the hosted flow
 * remains only as the prototype fallback below.
 */
export const GET: APIRoute = async (context) => {
  if (env.PORTAL_ENABLED === 'true') return context.redirect('/auth/entrar', 302);
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  const { url } = await service.createSignIn(context.cookies, { returnPathname: '/prototype' });
  return context.redirect(url, 302);
};
