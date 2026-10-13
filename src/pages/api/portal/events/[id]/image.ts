import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { authorizePortal } from "../../../../../lib/portal/access";
import { getEvent } from "../../../../../lib/portal/events";
import { portalResponse } from "../../../../../lib/portal/http";

export const prerender = false;
export const GET: APIRoute = async (context) => {
  const access = await authorizePortal(context, env);
  if (!access.ok) return access.response;
  try {
    const event = await getEvent(env.DB, context.params.id!, access.actor);
    if (!event?.image) return portalResponse("Not found", 404);
    const object = await env.SLIPS.get(event.image.key);
    if (!object) return portalResponse("Not found", 404);
    const ext = event.image.type === "image/png" ? "png" : event.image.type === "image/webp" ? "webp" : "jpg";
    return portalResponse(object.body, 200, {
      "Content-Type": event.image.type,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="evento.${ext}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
      "Cache-Control": "private, max-age=3600",
    });
  } catch {
    return portalResponse("Not found", 404);
  }
};
