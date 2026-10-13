import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createEvent } from "../../../../lib/portal/events";
import { eventImageKey, parseEventForm } from "../../../../lib/portal/event-form";
import { successRedirect } from "../../../../lib/portal/http";
import { portalMutation } from "../../../../lib/portal/routes";

export const prerender = false;
export const POST: APIRoute = (context) =>
  portalMutation(context, env, { admin: true, upload: true, back: "/admin/eventos/nuevo" }, async (actor, form) => {
    const parsed = await parseEventForm(form, null);
    const eventId = crypto.randomUUID();
    let uploadedKey: string | null = null;
    try {
      if (parsed.imageBytes) {
        uploadedKey = eventImageKey(eventId, parsed.imageBytes.type);
        await env.SLIPS.put(uploadedKey, parsed.imageBytes.bytes, {
          httpMetadata: { contentType: parsed.imageBytes.type },
          customMetadata: { sha256: parsed.imageBytes.sha256 },
        });
        parsed.input.image = { key: uploadedKey, type: parsed.imageBytes.type, size: parsed.imageBytes.size, sha256: parsed.imageBytes.sha256 };
      }
      await createEvent(env.DB, actor, parsed.input, eventId);
    } catch (error) {
      if (uploadedKey) await env.SLIPS.delete(uploadedKey).catch(() => {});
      throw error;
    }
    return successRedirect("/admin/eventos", "event_created");
  });
