import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePrototype, getPrototypeRun, privateResponse, receiptFromRun } from '../../../../lib/prototype';
import { renderReceiptHtml } from '../../../../lib/receipt';
export const prerender = false;
export const GET: APIRoute = async (context) => {
  const access = await authorizePrototype(context, env);
  if (!access.ok) return access.response;
  const run = await getPrototypeRun(env, access.actor, context.params.id ?? '');
  if (!run) return privateResponse('Not found', 404);
  return privateResponse(renderReceiptHtml(receiptFromRun(run)), 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
};
