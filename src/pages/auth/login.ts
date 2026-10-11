import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  const { url } = await service.createSignIn(context.cookies, {
    organizationId: env.WORKOS_ORGANIZATION_ID!.trim(),
    returnPathname: '/prototype',
  });
  return context.redirect(url, 302);
};
