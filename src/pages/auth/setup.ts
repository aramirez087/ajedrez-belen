import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { stagingSetup } from '../../lib/staging-auth';
import { stagingAuthSetupRequested } from '../../lib/staging-auth-policy';
import { getAuthService } from '../../lib/workos-runtime';

export const prerender = false;

export const GET: APIRoute = async context => {
  if (!stagingAuthSetupRequested(env)) return new Response('Not found', { status: 404 });
  const service = getAuthService(env);
  if (!service) return authUnavailableResponse();
  return stagingSetup(context, env, service);
};
