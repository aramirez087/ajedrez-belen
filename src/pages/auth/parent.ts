import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authUnavailableResponse } from '../../lib/auth';
import { getAuthService } from '../../lib/workos-runtime';
import { restrictedModeRequested } from '../../lib/staging-auth-policy';
import { stagingParentSignIn } from '../../lib/staging-auth';
import { safePortalReturnPath } from '../../lib/portal/invitation-entry';
export const prerender = false;
export const GET: APIRoute = async context => {
  if (env.PORTAL_ENABLED !== 'true') return new Response('Not found', {status:404});
  // Restricted staging keeps its pinned, hosted test flow untouched.
  if (restrictedModeRequested(env)) {
    const service = getAuthService(env);
    if (!service) return authUnavailableResponse();
    return stagingParentSignIn(context, env, service);
  }
  const next = safePortalReturnPath(context.url.searchParams.get('next'));
  const target = next ? `/auth/entrar?next=${encodeURIComponent(next)}` : '/auth/entrar';
  return context.redirect(target, 302);
};
