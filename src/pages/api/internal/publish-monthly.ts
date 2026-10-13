import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publishCurrentMonth } from '../../../lib/portal/domain';
import { portalResponse } from '../../../lib/portal/http';

export const prerender = false;

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i];
  return diff === 0;
}

// Machine-to-machine only: called by the monthly-publish cron Worker through a
// service binding. Never reachable with a browser session or WorkOS identity.
export const POST: APIRoute = async (context) => {
  if (env.PORTAL_ENABLED !== 'true') return portalResponse('Not found', 404);
  const secret = env.CRON_SECRET;
  if (!secret) return portalResponse('Not configured', 503);
  const authorization = context.request.headers.get('Authorization') ?? '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!provided || !(await secretMatches(provided, secret))) return portalResponse('Unauthorized', 401);
  try {
    const result = await publishCurrentMonth(env.DB, new Date().toISOString());
    console.log(JSON.stringify({ event: 'monthly_publish', ...result }));
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'monthly_publish_failed', message: error instanceof Error ? error.message : 'unknown' }));
    return portalResponse('Publish failed', 500);
  }
};

export const GET: APIRoute = () => portalResponse('Method not allowed', 405, { Allow: 'POST' });
