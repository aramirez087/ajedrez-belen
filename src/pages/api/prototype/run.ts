import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePrototype, createPrototypeRun, privateResponse } from '../../../lib/prototype';
import { hasSameOrigin, MAX_SLIP_BYTES } from '../../../lib/prototype-policy';
export const prerender = false;
export const POST: APIRoute = async (context) => {
  const access = await authorizePrototype(context, env);
  if (!access.ok) return access.response;
  if (!hasSameOrigin(context.request, context.url)) return privateResponse('Invalid origin', 403);
  // Read with a bound even when a malicious caller omits Content-Length.
  const reader = context.request.body?.getReader();
  if (!reader) return privateResponse('Missing upload', 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SLIP_BYTES + 65536) { await reader.cancel(); return privateResponse('Upload too large', 413); }
    chunks.push(value);
  }
  try {
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(body, { headers: { 'Content-Type': context.request.headers.get('content-type') ?? '' } }).formData();
    await createPrototypeRun(env, access.actor, form);
    return privateResponse(null, 303, { Location: '/prototype?notice=created' });
  } catch {
    return privateResponse('No se pudo crear la prueba. Revisa el archivo, descuento y migración local.', 400);
  }
};
