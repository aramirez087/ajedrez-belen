import { InputError } from "./http";
import { detectEventImageType, MAX_EVENT_IMAGE_BYTES, type EventImage, type EventInput } from "./events";

function text(form: FormData, key: string, max: number, required = false): string {
  const raw = form.get(key);
  if (raw === null || raw === "") {
    if (required) throw new InputError("invalid_fields");
    return "";
  }
  if (typeof raw !== "string" || raw.length > max) throw new InputError("invalid_fields");
  return raw.trim();
}

export interface ParsedEventForm {
  input: EventInput;
  imageBytes: { bytes: Uint8Array; type: string; size: number; sha256: string } | null;
  removeImage: boolean;
}

/** Parse the admin event form. Image bytes are returned, not yet stored. */
export async function parseEventForm(form: FormData, existingImage: EventImage | null): Promise<ParsedEventForm> {
  const freq = text(form, "recurrenceFreq", 20) || "none";
  const intervalRaw = text(form, "recurrenceInterval", 4);
  const countRaw = text(form, "recurrenceCount", 4);
  const file = form.get("image");
  let imageBytes: ParsedEventForm["imageBytes"] = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_EVENT_IMAGE_BYTES) throw new InputError("invalid_event_image");
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = detectEventImageType(buf);
    if (!type || (file.type && file.type !== type && file.type !== "image/webp")) throw new InputError("invalid_event_image");
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
    imageBytes = { bytes: buf, type, size: file.size, sha256 };
  }
  const removeImage = form.get("removeImage") === "on";
  // "Guardar borrador / Publicar" buttons override the status select when present.
  const statusIntent = text(form, "statusIntent", 20);
  // Termina: nunca | hasta | veces — only the chosen terminator is kept.
  const endsMode = text(form, "recurrenceEnds", 10) || (countRaw ? "veces" : text(form, "recurrenceUntil", 10) ? "hasta" : "nunca");
  const input: EventInput = {
    title: text(form, "title", 120, true),
    description: text(form, "description", 4000),
    date: text(form, "date", 10, true),
    startTime: text(form, "startTime", 5),
    endTime: text(form, "endTime", 5),
    allDay: form.get("allDay") === "on",
    locationType: (text(form, "locationType", 20, true) || "online") as EventInput["locationType"],
    locationLabel: text(form, "locationLabel", 120) || null,
    locationUrl: text(form, "locationUrl", 2048) || null,
    locationAddress: text(form, "locationAddress", 300) || null,
    status: ((statusIntent === "draft" || statusIntent === "published" ? statusIntent : text(form, "status", 20)) || "published") as EventInput["status"],
    recurrenceFreq: freq as EventInput["recurrenceFreq"],
    recurrenceInterval: intervalRaw ? Number(intervalRaw) : 1,
    recurrenceUntil: endsMode === "hasta" ? (text(form, "recurrenceUntil", 10) || null) : null,
    recurrenceCount: endsMode === "veces" && countRaw ? Number(countRaw) : null,
    image: removeImage ? null : existingImage,
    imageAlt: text(form, "imageAlt", 200) || null,
    submissionId: text(form, "submissionId", 64) || null,
  };
  return { input, imageBytes, removeImage };
}

export function eventImageKey(eventId: string, type: string): string {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `events/${eventId}/cover-${crypto.randomUUID()}.${ext}`;
}
