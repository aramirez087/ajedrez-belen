import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';
import { stagingSignIn } from '../../lib/staging-auth';
import { stagingAuthSetupRequested } from '../../lib/staging-auth-policy';
export const prerender = false;
export const GET: APIRoute = async context => {
  if (stagingAuthSetupRequested(env)) {
    const service = getAuthService(env);
    if (!service) return authUnavailableResponse();
    return stagingSignIn(context, env, service);
  }
  if (env.PORTAL_ENABLED !== 'true') return new Response('Not found', {status:404});
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  const {url} = await service.createSignIn(context.cookies, {
    organizationId:env.WORKOS_ORGANIZATION_ID!.trim(),returnPathname:'/admin',
  });
  return context.redirect(url,302);
};
