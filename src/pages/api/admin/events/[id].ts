import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { cancelOccurrence, deleteEvent, getEvent, restoreOccurrence, setEventStatus, updateEvent, type EventStatus } from "../../../../lib/portal/events";
import { eventImageKey, parseEventForm } from "../../../../lib/portal/event-form";
import { formText, InputError, successRedirect } from "../../../../lib/portal/http";
import { portalMutation } from "../../../../lib/portal/routes";

export const prerender = false;
export const POST: APIRoute = (context) => {
  const eventId = context.params.id!;
  return portalMutation(context, env, { admin: true, upload: true, back: `/admin/eventos/${eventId}` }, async (actor, form) => {
    const action = formText(form, "action", 24);
    const back = `/admin/eventos/${eventId}`;
    if (action === "delete") {
      const image = await deleteEvent(env.DB, actor, eventId);
      if (image) await env.SLIPS.delete(image.key).catch(() => {});
      return successRedirect("/admin/eventos", "event_deleted");
    }
    if (action === "status") {
      const status = formText(form, "status", 20) as EventStatus;
      if (!["draft", "published", "cancelled"].includes(status)) throw new InputError("invalid_fields");
      await setEventStatus(env.DB, actor, eventId, status);
      return successRedirect("/admin/eventos", status === "cancelled" ? "event_cancelled" : "event_updated");
    }
    if (action === "cancel_occurrence") {
      await cancelOccurrence(env.DB, actor, eventId, formText(form, "occurrenceStart", 40));
      return successRedirect(back, "event_occurrence_cancelled");
    }
    if (action === "restore_occurrence") {
      await restoreOccurrence(env.DB, actor, eventId, formText(form, "occurrenceStart", 40));
      return successRedirect(back, "event_updated");
    }
    if (action === "update") {
      const existing = await getEvent(env.DB, eventId, actor);
      if (!existing) throw new InputError("not_found", 404);
      const parsed = await parseEventForm(form, existing.image);
      let newKey: string | null = null;
      try {
        if (parsed.imageBytes) {
          newKey = eventImageKey(eventId, parsed.imageBytes.type);
          await env.SLIPS.put(newKey, parsed.imageBytes.bytes, {
            httpMetadata: { contentType: parsed.imageBytes.type },
            customMetadata: { sha256: parsed.imageBytes.sha256 },
          });
          parsed.input.image = { key: newKey, type: parsed.imageBytes.type, size: parsed.imageBytes.size, sha256: parsed.imageBytes.sha256 };
        }
        await updateEvent(env.DB, actor, eventId, parsed.input);
      } catch (error) {
        if (newKey) await env.SLIPS.delete(newKey).catch(() => {});
        throw error;
      }
      const oldKey = existing.image?.key;
      if (oldKey && oldKey !== parsed.input.image?.key) await env.SLIPS.delete(oldKey).catch(() => {});
      return successRedirect(back, "event_updated");
    }
    throw new InputError("invalid_fields");
  });
};
