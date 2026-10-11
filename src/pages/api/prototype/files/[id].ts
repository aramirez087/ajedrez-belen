import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePrototype, getPrototypeRun, privateResponse } from '../../../../lib/prototype';
export const prerender = false;
export const GET: APIRoute = async (context) => {
  const access = await authorizePrototype(context, env);
  if (!access.ok) return access.response;
  const run = await getPrototypeRun(env, access.actor, context.params.id ?? '');
  if (!run) return privateResponse('Not found', 404);
  const object = await env.SLIPS.get(run.file_key);
  if (!object) return privateResponse('Not found', 404);
  const extension = run.file_type === 'application/pdf' ? 'pdf' : run.file_type === 'image/png' ? 'png' : 'jpg';
  return privateResponse(object.body, 200, {
    'Content-Type': run.file_type,
    'Content-Disposition': `attachment; filename="archivo-de-prueba.${extension}"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
};
