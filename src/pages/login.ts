import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../lib/auth';
import { getAuthService } from '../lib/workos-runtime';

export const prerender = false;

/**
 * Initiate login URI for WorkOS AuthKit.
 * AuthKit sends users here when sign-in starts outside the app (password reset,
 * invitation links). Immediately redirects to WorkOS sign-in flow.
 */
export const GET: APIRoute = async (context) => {
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();

  // Determine best return path based on enabled features
  const returnPathname = env.PORTAL_ENABLED === 'true' ? '/portal' : '/prototype';

  const { url } = await service.createSignIn(context.cookies, { returnPathname });
  return context.redirect(url, 302);
};
