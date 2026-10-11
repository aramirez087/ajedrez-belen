import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePrototype, privateResponse } from '../../../lib/prototype';
export const prerender = false;
export const GET: APIRoute = async (context) => {
  const access = await authorizePrototype(context, env);
  if (!access.ok) return access.response;
  // Tiny synthetic PNG for a storage round-trip. Contains no bank or family data.
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII='), char => char.charCodeAt(0));
  return privateResponse(bytes, 200, { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="muestra-sintetica.png"' });
};
