import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';
import { restrictedModeRequested } from '../../lib/staging-auth-policy';
import { stagingParentSignIn } from '../../lib/staging-auth';
export const prerender = false;
export const GET: APIRoute = async context => {
  if (env.PORTAL_ENABLED !== 'true') return new Response('Not found', {status:404});
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  if (restrictedModeRequested(env)) return stagingParentSignIn(context, env, service);
  const {url} = await service.createSignIn(context.cookies, {returnPathname:'/portal'});
  return context.redirect(url,302);
};
