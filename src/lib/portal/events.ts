import { hasApprovedAthlete } from "./membership";
import { PortalError, type Actor } from "./types";

export const EVENT_TIME_ZONE = "America/Costa_Rica";
export const MAX_EVENT_IMAGE_BYTES = 3 * 1024 * 1024;
export const EVENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type EventLocationType = "online" | "in_person" | "hybrid";
export type EventStatus = "draft" | "published" | "cancelled";
export type RecurrenceFreq = "none" | "weekly" | "monthly" | "yearly";

export interface EventImage { key: string; type: string; size: number; sha256: string; }
export interface PortalEvent {
  id: string; title: string; description: string;
  startsAt: string; endsAt: string; allDay: boolean;
  locationType: EventLocationType; locationLabel: string | null;
  locationUrl: string | null; locationAddress: string | null;
  image: EventImage | null; imageAlt: string | null; status: EventStatus;
  recurrenceFreq: RecurrenceFreq; recurrenceInterval: number;
  recurrenceUntil: string | null; recurrenceCount: number | null;
  /** occurrence_start instants an admin cancelled within a series. */
  cancelledOccurrences: string[];
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface EventOccurrence {
  event: PortalEvent; startsAt: string; endsAt: string; isRecurring: boolean;
  cancelled?: boolean;
}
export interface EventInput {
  title: string; description?: string;
  /** CR wall-clock date/time from the admin form. */
  date: string; startTime: string; endTime: string; allDay?: boolean;
  locationType: EventLocationType; locationLabel?: string | null;
  locationUrl?: string | null; locationAddress?: string | null;
  image?: EventImage | null; imageAlt?: string | null; status?: EventStatus;
  recurrenceFreq?: RecurrenceFreq; recurrenceInterval?: number;
  recurrenceUntil?: string | null; recurrenceCount?: number | null;
  submissionId?: string | null;
}

function fail(message: string, code = "invalid_event"): never {
  throw new PortalError(400, message, code);
}
const iso = () => new Date().toISOString();
const id = () => crypto.randomUUID();

/* ---------- Costa Rica wall-clock <-> UTC instant ---------- */
/* CR observes no DST (UTC-6 year-round); the conversion below still derives
   the offset from Intl so it stays correct if that ever changes. */
const crParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export function crWallParts(instant: string | Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = Object.fromEntries(crParts.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: EVENT_TIME_ZONE, weekday: "short" }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
    weekday: map[weekday] ?? 0,
  };
}
export function crDateKey(instant: string | Date): string {
  const p = crWallParts(instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function crWallToUtcIso(year: number, month: number, day: number, hour: number, minute: number): string {
  // Guess UTC-6, format back in CR, correct by the difference (one pass is
  // enough without DST transitions; loop guards the general case).
  let guess = Date.UTC(year, month - 1, day, hour + 6, minute, 0);
  for (let i = 0; i < 3; i++) {
    const p = crWallParts(new Date(guess).toISOString());
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess).toISOString();
}
export function crTimeLabel(instant: string): string {
  return new Intl.DateTimeFormat("es-CR", { timeZone: EVENT_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}
export function crDateTimeLabel(instant: string): string {
  return new Intl.DateTimeFormat("es-CR", { timeZone: EVENT_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}
export function crDateLabel(instant: string): string {
  return new Intl.DateTimeFormat("es-CR", { timeZone: EVENT_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(instant));
}
export function crShortDateLabel(instant: string): string {
  return new Intl.DateTimeFormat("es-CR", { timeZone: EVENT_TIME_ZONE, weekday: "short", day: "numeric", month: "short" }).format(new Date(instant));
}
const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export function crWeekdayName(instant: string): string { return WEEKDAYS_ES[crWallParts(instant).weekday]; }

export type OccurrenceState = "live" | "today" | "tomorrow" | "upcoming" | "past";
export function occurrenceState(occ: { startsAt: string; endsAt: string }, nowIso: string): OccurrenceState {
  if (occ.endsAt <= nowIso) return "past";
  if (occ.startsAt <= nowIso) return "live";
  const today = crDateKey(nowIso), startDay = crDateKey(occ.startsAt);
  if (startDay === today) return "today";
  const tomorrow = crDateKey(new Date(new Date(nowIso).getTime() + 86_400_000).toISOString());
  return startDay === tomorrow ? "tomorrow" : "upcoming";
}
export function relativeBadge(state: OccurrenceState): string {
  return { live: "En vivo ahora", today: "Hoy", tomorrow: "Mañana", upcoming: "", past: "Ya pasó" }[state];
}
/** "7:00 p. m. – 8:00 p. m." on one CR day; includes the end date when it spills past midnight. */
export function crRangeLabel(startsAt: string, endsAt: string, allDay: boolean): string {
  if (allDay) return crDateKey(startsAt) === crDateKey(endsAt) ? "Todo el día" : `Hasta el ${crShortDateLabel(endsAt)}`;
  const sameDay = crDateKey(startsAt) === crDateKey(endsAt);
  return sameDay ? `${crTimeLabel(startsAt)} – ${crTimeLabel(endsAt)}` : `${crTimeLabel(startsAt)} – ${crShortDateLabel(endsAt)}, ${crTimeLabel(endsAt)}`;
}

/* ---------- Validation ---------- */
function cleanText(value: unknown, max: number, label: string, required = false): string | null {
  if (value === null || value === undefined || value === "") return required ? fail(`Falta ${label}.`) : null;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${label} inválido.`);
  const trimmed = (value as string).trim();
  if (required && !trimmed) fail(`Falta ${label}.`);
  return trimmed || null;
}
export function detectEventImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export interface NormalizedEvent {
  title: string; description: string; startsAt: string; endsAt: string; allDay: boolean;
  locationType: EventLocationType; locationLabel: string | null; locationUrl: string | null; locationAddress: string | null;
  image: EventImage | null; imageAlt: string | null; status: EventStatus;
  recurrenceFreq: RecurrenceFreq; recurrenceInterval: number; recurrenceUntil: string | null; recurrenceCount: number | null;
}
export function normalizeEventInput(input: EventInput): NormalizedEvent {
  const title = cleanText(input.title, 120, "el título", true)!;
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 4000) fail("La descripción es demasiado larga.");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(input.date ?? "")) fail("Fecha inválida.", "invalid_event");
  const [y, m, d] = input.date.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) fail("Fecha inválida.");
  const allDay = !!input.allDay;
  const timeOk = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const startTime = allDay ? "00:00" : input.startTime;
  const endTime = allDay ? "23:59" : input.endTime;
  if (!timeOk(startTime ?? "") || !timeOk(endTime ?? "")) fail("Hora inválida.");
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (!allDay && startTime === endTime) fail("La hora de fin no puede ser igual a la de inicio. Revisa si querías p. m. en vez de a. m.");
  const startsAt = crWallToUtcIso(y, m, d, sh, sm);
  let endsAt = crWallToUtcIso(y, m, d, eh, em);
  if (endsAt <= startsAt) {
    // An end at/before the start means it finishes after midnight.
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    endsAt = crWallToUtcIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), eh, em);
    if (endsAt <= startsAt) fail("La hora de fin debe ser después de la de inicio.");
  }
  if (!["online", "in_person", "hybrid"].includes(input.locationType)) fail("Tipo de ubicación inválido.", "invalid_location");
  const locationLabel = cleanText(input.locationLabel, 120, "el nombre del lugar");
  const locationUrlRaw = cleanText(input.locationUrl, 2048, "el enlace");
  const locationAddress = cleanText(input.locationAddress, 300, "la dirección");
  let locationUrl: string | null = null;
  if (locationUrlRaw) {
    let parsed: URL;
    try { parsed = new URL(locationUrlRaw); } catch { fail("El enlace del evento no es una URL válida.", "invalid_location"); }
    if (parsed.protocol !== "https:") fail("El enlace debe empezar con https://.", "invalid_location");
    locationUrl = parsed.toString();
  }
  if ((input.locationType === "online" || input.locationType === "hybrid") && !locationUrl) fail("Los eventos en línea necesitan el enlace (Zoom, Meet…).", "invalid_location");
  if ((input.locationType === "in_person" || input.locationType === "hybrid") && !locationAddress) fail("Los eventos presenciales necesitan la dirección.", "invalid_location");
  const status = input.status ?? "published";
  if (!["draft", "published", "cancelled"].includes(status)) fail("Estado inválido.");
  const freq = input.recurrenceFreq ?? "none";
  if (!["none", "weekly", "monthly", "yearly"].includes(freq)) fail("Recurrencia inválida.", "invalid_recurrence");
  const interval = input.recurrenceInterval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) fail("Intervalo de recurrencia inválido.", "invalid_recurrence");
  let until: string | null = null;
  if (input.recurrenceUntil) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(input.recurrenceUntil)) fail("Fecha de fin de recurrencia inválida.", "invalid_recurrence");
    if (input.recurrenceUntil < input.date) fail("La recurrencia no puede terminar antes de empezar.", "invalid_recurrence");
    until = input.recurrenceUntil;
  }
  let count: number | null = null;
  if (input.recurrenceCount !== null && input.recurrenceCount !== undefined) {
    if (!Number.isInteger(input.recurrenceCount) || input.recurrenceCount < 1 || input.recurrenceCount > 104) fail("Cantidad de repeticiones inválida (1–104).", "invalid_recurrence");
    count = input.recurrenceCount;
  }
  if (freq === "none") { until = null; count = null; }
  if (input.image) {
    if (!EVENT_IMAGE_TYPES.includes(input.image.type as never) || !(input.image.size > 0) || input.image.size > MAX_EVENT_IMAGE_BYTES || !input.image.key.startsWith("events/")) fail("Imagen inválida.", "invalid_event_image");
  }
  const imageAlt = cleanText(input.imageAlt, 200, "la descripción de la imagen");
  return {
    title, description, startsAt, endsAt, allDay,
    locationType: input.locationType, locationLabel,
    locationUrl: input.locationType === "in_person" ? null : locationUrl,
    locationAddress: input.locationType === "online" ? null : locationAddress,
    image: input.image ?? null, imageAlt: input.image ? imageAlt : null, status,
    recurrenceFreq: freq, recurrenceInterval: freq === "none" ? 1 : interval,
    recurrenceUntil: until, recurrenceCount: count,
  };
}

/* ---------- Recurrence expansion ---------- */
function addMonthsCr(p: { year: number; month: number; day: number }, months: number) {
  const total = (p.year * 12 + (p.month - 1)) + months;
  const year = Math.floor(total / 12), month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(p.day, lastDay) };
}
/** Expand a series into occurrences overlapping [fromIso, toIso). Capped for safety.
    Cancelled occurrences are skipped unless includeCancelled (admin views). */
export function expandOccurrences(event: PortalEvent, fromIso: string, toIso: string, options: { includeCancelled?: boolean } = {}): EventOccurrence[] {
  const from = new Date(fromIso).getTime(), to = new Date(toIso).getTime();
  const duration = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
  const start = crWallParts(event.startsAt);
  const out: EventOccurrence[] = [];
  // Steps are monotonic in every freq, so stopping at the window end is safe.
  // The iteration cap bounds an unbounded series started long ago.
  for (let i = 0; i < 1000; i++) {
    let occStartIso: string;
    if (event.recurrenceFreq === "none") {
      if (i > 0) break;
      occStartIso = event.startsAt;
    } else if (event.recurrenceFreq === "weekly") {
      occStartIso = new Date(new Date(event.startsAt).getTime() + i * event.recurrenceInterval * 7 * 86_400_000).toISOString();
    } else if (event.recurrenceFreq === "monthly") {
      const p = addMonthsCr(start, i * event.recurrenceInterval);
      occStartIso = crWallToUtcIso(p.year, p.month, p.day, start.hour, start.minute);
    } else {
      const p = addMonthsCr(start, i * event.recurrenceInterval * 12);
      occStartIso = crWallToUtcIso(p.year, p.month, p.day, start.hour, start.minute);
    }
    if (event.recurrenceCount !== null && i >= event.recurrenceCount) break;
    if (event.recurrenceUntil && crDateKey(occStartIso) > event.recurrenceUntil) break;
    const occStart = new Date(occStartIso).getTime();
    if (occStart >= to) break;
    if (occStart + duration > from) {
      const cancelled = event.cancelledOccurrences?.includes(occStartIso) ?? false;
      if (!cancelled || options.includeCancelled) {
        out.push({ event, startsAt: occStartIso, endsAt: new Date(occStart + duration).toISOString(), isRecurring: event.recurrenceFreq !== "none", cancelled });
      }
    }
    if (event.recurrenceFreq === "none") break;
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export function nextOccurrence(event: PortalEvent, afterIso: string): EventOccurrence | null {
  const horizon = new Date(new Date(afterIso).getTime() + 370 * 86_400_000).toISOString();
  const upcoming = expandOccurrences(event, afterIso, horizon).filter((o) => o.endsAt > afterIso);
  return upcoming[0] ?? null;
}

/** Resolve a (possibly shared/stale/invalid) ?occurrence= link to a real occurrence.
    Invalid or unmatched params substitute the next/current occurrence — never throw. */
export interface ResolvedOccurrence { occurrence: EventOccurrence | null; substituted: boolean; requestedCancelled: boolean; }
export function resolveOccurrence(event: PortalEvent, param: string | null, nowIso: string): ResolvedOccurrence {
  const fallback = (): ResolvedOccurrence => {
    const next = nextOccurrence(event, nowIso);
    if (next) return { occurrence: next, substituted: true, requestedCancelled: false };
    return { occurrence: { event, startsAt: event.startsAt, endsAt: event.endsAt, isRecurring: event.recurrenceFreq !== "none" }, substituted: true, requestedCancelled: false };
  };
  if (!param) {
    // Plain event link: show the live/next date of a series, the date itself otherwise.
    if (event.recurrenceFreq === "none") return { occurrence: { event, startsAt: event.startsAt, endsAt: event.endsAt, isRecurring: false }, substituted: false, requestedCancelled: false };
    const next = nextOccurrence(event, nowIso);
    return next ? { occurrence: next, substituted: false, requestedCancelled: false } : fallback();
  }
  const t = new Date(param).getTime();
  if (!Number.isFinite(t)) return fallback();
  const from = new Date(t - 7 * 86_400_000).toISOString(), to = new Date(t + 8 * 86_400_000).toISOString();
  const match = expandOccurrences(event, from, to, { includeCancelled: true })
    .find((o) => Math.abs(new Date(o.startsAt).getTime() - t) < 60_000);
  if (!match) return fallback();
  return { occurrence: match, substituted: false, requestedCancelled: !!match.cancelled };
}
export function mapsUrl(event: PortalEvent): string | null {
  if (!event.locationAddress) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress)}`;
}
export function recurrenceLabel(event: PortalEvent): string {
  if (event.recurrenceFreq === "none") return "";
  const p = crWallParts(event.startsAt);
  let every: string;
  if (event.recurrenceFreq === "weekly") {
    every = event.recurrenceInterval === 1 ? `Cada ${crWeekdayName(event.startsAt)}` : `Cada ${event.recurrenceInterval} semanas, los ${crWeekdayName(event.startsAt)}`;
  } else if (event.recurrenceFreq === "monthly") {
    every = event.recurrenceInterval === 1 ? `Cada mes, el día ${p.day}` : `Cada ${event.recurrenceInterval} meses, el día ${p.day}`;
  } else {
    every = event.recurrenceInterval === 1 ? "Cada año" : `Cada ${event.recurrenceInterval} años`;
  }
  if (event.recurrenceUntil) {
    const until = new Intl.DateTimeFormat("es-CR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${event.recurrenceUntil}T12:00:00Z`));
    return `${every}, hasta el ${until}`;
  }
  if (event.recurrenceCount) return `${every}, ${event.recurrenceCount} veces`;
  return every;
}

/* ---------- Add-to-calendar / share ---------- */
function icsStamp(isoInstant: string): string { return isoInstant.replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsEscape(text: string): string { return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
export function buildIcs(event: PortalEvent, occurrence?: EventOccurrence): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ajedrez Belen//Portal//ES", "BEGIN:VEVENT",
    `UID:${event.id}@ajedrezbelen`, `DTSTAMP:${icsStamp(new Date().toISOString())}`];
  const location = [event.locationLabel, event.locationAddress, event.locationUrl].filter(Boolean).join(" · ");
  if (!occurrence && event.recurrenceFreq !== "none") {
    lines.push(`DTSTART:${icsStamp(event.startsAt)}`, `DTEND:${icsStamp(event.endsAt)}`);
    const freq = { weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" }[event.recurrenceFreq];
    let rrule = `RRULE:FREQ=${freq};INTERVAL=${event.recurrenceInterval}`;
    if (event.recurrenceCount) rrule += `;COUNT=${event.recurrenceCount}`;
    else if (event.recurrenceUntil) rrule += `;UNTIL=${event.recurrenceUntil.replace(/-/g, "")}T235959Z`;
    lines.push(rrule);
    for (const cancelled of event.cancelledOccurrences) lines.push(`EXDATE:${icsStamp(cancelled)}`);
  } else {
    const occ = occurrence ?? { startsAt: event.startsAt, endsAt: event.endsAt };
    lines.push(`DTSTART:${icsStamp(occ.startsAt)}`, `DTEND:${icsStamp(occ.endsAt)}`);
  }
  lines.push(`SUMMARY:${icsEscape(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (event.locationUrl) lines.push(`URL:${event.locationUrl}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
export function googleCalendarUrl(event: PortalEvent, occurrence: EventOccurrence): string {
  const params = new URLSearchParams({
    action: "TEMPLATE", text: event.title,
    dates: `${icsStamp(occurrence.startsAt)}/${icsStamp(occurrence.endsAt)}`,
    details: event.description,
    location: [event.locationLabel, event.locationAddress, event.locationUrl].filter(Boolean).join(" · "),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
export function whatsAppShareUrl(event: PortalEvent, occurrence: EventOccurrence, pageUrl: string): string {
  const place = event.locationUrl ? `Enlace: ${event.locationUrl}` : event.locationAddress ? `Lugar: ${event.locationAddress}` : "";
  const text = `${event.title} — ${crDateTimeLabel(occurrence.startsAt)} (hora de Costa Rica). ${place} Detalles: ${pageUrl}`.trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/* ---------- Persistence (D1) ---------- */
interface EventRow {
  id: string; title: string; description: string; starts_at: string; ends_at: string; all_day: number;
  location_type: EventLocationType; location_label: string | null; location_url: string | null; location_address: string | null;
  image_key: string | null; image_type: string | null; image_size: number | null; image_sha256: string | null; image_alt: string | null;
  status: EventStatus; recurrence_freq: RecurrenceFreq; recurrence_interval: number;
  recurrence_until: string | null; recurrence_count: number | null;
  created_by: string; updated_by: string; created_at: string; updated_at: string;
}
const COLS = "id,title,description,starts_at,ends_at,all_day,location_type,location_label,location_url,location_address,image_key,image_type,image_size,image_sha256,status,recurrence_freq,recurrence_interval,recurrence_until,recurrence_count,created_by,updated_by,created_at,updated_at";
export function rowToEvent(r: EventRow, cancelledOccurrences: string[] = [], imageAlt: string | null = null): PortalEvent {
  return {
    id: r.id, title: r.title, description: r.description, startsAt: r.starts_at, endsAt: r.ends_at, allDay: !!r.all_day,
    locationType: r.location_type, locationLabel: r.location_label, locationUrl: r.location_url, locationAddress: r.location_address,
    image: r.image_key ? { key: r.image_key, type: r.image_type!, size: r.image_size!, sha256: r.image_sha256 ?? "" } : null,
    imageAlt: r.image_alt ?? imageAlt,
    status: r.status, recurrenceFreq: r.recurrence_freq, recurrenceInterval: r.recurrence_interval,
    recurrenceUntil: r.recurrence_until, recurrenceCount: r.recurrence_count,
    cancelledOccurrences,
    createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
async function loadCancelled(db: D1Database, eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!eventIds.length) return map;
  try {
    const found = await rows<{ event_id: string; occurrence_start: string }>(db,
      `SELECT event_id, occurrence_start FROM event_exceptions WHERE event_id IN (${eventIds.map(() => "?").join(",")})`, eventIds);
    for (const row of found) map.set(row.event_id, [...(map.get(row.event_id) ?? []), row.occurrence_start]);
  } catch { /* pre-0009 database: no exceptions yet */ }
  return map;
}
async function loadImageAlts(db: D1Database, eventIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!eventIds.length) return map;
  try {
    const found = await rows<{ id: string; image_alt: string | null }>(db,
      `SELECT id, image_alt FROM events WHERE id IN (${eventIds.map(() => "?").join(",")})`, eventIds);
    for (const row of found) map.set(row.id, row.image_alt);
  } catch { /* pre-0009 database */ }
  return map;
}
async function hydrate(db: D1Database, list: EventRow[]): Promise<PortalEvent[]> {
  const ids = list.map((r) => r.id);
  const [cancelled, alts] = await Promise.all([loadCancelled(db, ids), loadImageAlts(db, ids)]);
  return list.map((r) => rowToEvent(r, cancelled.get(r.id) ?? [], alts.get(r.id) ?? null));
}
async function rows<T>(db: D1Database, sql: string, args: unknown[] = []): Promise<T[]> {
  return (await db.prepare(sql).bind(...args).all<T>()).results;
}
function requireAdmin(actor: Actor) { if (!actor.isAdmin) throw new PortalError(403, "Se requiere una cuenta administrativa.", "forbidden"); }

export async function createEvent(db: D1Database, actor: Actor, input: EventInput, explicitId?: string): Promise<PortalEvent> {
  requireAdmin(actor);
  const n = normalizeEventInput(input);
  // Idempotent retry: the same form submission must not duplicate a series.
  if (input.submissionId) {
    try {
      const existing = await db.prepare("SELECT id FROM events WHERE submission_id=?").bind(input.submissionId).first<{ id: string }>();
      if (existing) { const found = await getEvent(db, existing.id, actor); if (found) return found; }
    } catch { /* pre-0009 database */ }
  }
  const now = iso(), eventId = explicitId ?? id();
  await db.prepare(`INSERT INTO events(${COLS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    eventId, n.title, n.description, n.startsAt, n.endsAt, n.allDay ? 1 : 0, n.locationType, n.locationLabel, n.locationUrl, n.locationAddress,
    n.image?.key ?? null, n.image?.type ?? null, n.image?.size ?? null, n.image?.sha256 ?? null,
    n.status, n.recurrenceFreq, n.recurrenceInterval, n.recurrenceUntil, n.recurrenceCount, actor.id, actor.id, now, now,
  ).run();
  try {
    await db.prepare("UPDATE events SET image_alt=?, submission_id=? WHERE id=?").bind(n.imageAlt, input.submissionId ?? null, eventId).run();
  } catch { /* pre-0009 database */ }
  const created = await getEvent(db, eventId, actor);
  if (!created) throw new PortalError(500, "No se pudo guardar el evento.", "operation_failed");
  return created;
}
export async function updateEvent(db: D1Database, actor: Actor, eventId: string, input: EventInput): Promise<PortalEvent> {
  requireAdmin(actor);
  const existing = await getEvent(db, eventId, actor);
  if (!existing) throw new PortalError(404, "Evento no encontrado.", "not_found");
  const n = normalizeEventInput(input);
  const now = iso();
  await db.prepare(`UPDATE events SET title=?,description=?,starts_at=?,ends_at=?,all_day=?,location_type=?,location_label=?,location_url=?,location_address=?,image_key=?,image_type=?,image_size=?,image_sha256=?,status=?,recurrence_freq=?,recurrence_interval=?,recurrence_until=?,recurrence_count=?,updated_by=?,updated_at=? WHERE id=?`).bind(
    n.title, n.description, n.startsAt, n.endsAt, n.allDay ? 1 : 0, n.locationType, n.locationLabel, n.locationUrl, n.locationAddress,
    n.image?.key ?? null, n.image?.type ?? null, n.image?.size ?? null, n.image?.sha256 ?? null,
    n.status, n.recurrenceFreq, n.recurrenceInterval, n.recurrenceUntil, n.recurrenceCount, actor.id, now, eventId,
  ).run();
  try { await db.prepare("UPDATE events SET image_alt=? WHERE id=?").bind(n.imageAlt, eventId).run(); } catch { /* pre-0009 */ }
  return (await getEvent(db, eventId, actor))!;
}
export async function cancelOccurrence(db: D1Database, actor: Actor, eventId: string, occurrenceStart: string): Promise<void> {
  requireAdmin(actor);
  const event = await getEvent(db, eventId, actor);
  if (!event) throw new PortalError(404, "Evento no encontrado.", "not_found");
  const t = new Date(occurrenceStart).getTime();
  if (!Number.isFinite(t)) fail("Fecha de la serie inválida.", "invalid_recurrence");
  // Only a real occurrence of this series can be cancelled.
  const match = expandOccurrences(event, new Date(t - 1000).toISOString(), new Date(t + 86_400_000).toISOString(), { includeCancelled: true })
    .find((o) => Math.abs(new Date(o.startsAt).getTime() - t) < 60_000);
  if (!match) fail("Esa fecha no pertenece a esta serie.", "invalid_recurrence");
  await db.prepare("INSERT OR IGNORE INTO event_exceptions(event_id,occurrence_start,kind,created_by,created_at) VALUES(?,?,?,?,?)")
    .bind(eventId, match.startsAt, "cancelled", actor.id, iso()).run();
}
export async function restoreOccurrence(db: D1Database, actor: Actor, eventId: string, occurrenceStart: string): Promise<void> {
  requireAdmin(actor);
  await db.prepare("DELETE FROM event_exceptions WHERE event_id=? AND occurrence_start=?").bind(eventId, occurrenceStart).run();
}
export async function setEventStatus(db: D1Database, actor: Actor, eventId: string, status: EventStatus): Promise<void> {
  requireAdmin(actor);
  const result = await db.prepare("UPDATE events SET status=?, updated_by=?, updated_at=? WHERE id=?").bind(status, actor.id, iso(), eventId).run();
  if (!result.meta?.changes) throw new PortalError(404, "Evento no encontrado.", "not_found");
}
export async function deleteEvent(db: D1Database, actor: Actor, eventId: string): Promise<EventImage | null> {
  requireAdmin(actor);
  const existing = await getEvent(db, eventId, actor);
  if (!existing) throw new PortalError(404, "Evento no encontrado.", "not_found");
  await db.prepare("DELETE FROM events WHERE id=?").bind(eventId).run();
  return existing.image;
}
/** Published meeting links and addresses are for staff and enrolled families. */
export async function canViewFamilyEvents(db: D1Database, actor: Actor): Promise<boolean> {
  if (actor.isAdmin) return true;
  return hasApprovedAthlete(db, actor.id);
}
export async function getEvent(db: D1Database, eventId: string, actor?: Actor): Promise<PortalEvent | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM events WHERE id=?`).bind(eventId).first<EventRow>();
  if (!row) return null;
  const [event] = await hydrate(db, [row]);
  if (!actor?.isAdmin && event.status !== "published") return null;
  if (actor && !actor.isAdmin && !(await canViewFamilyEvents(db, actor))) return null;
  return event;
}
/** Lookup for tombstones. Drafts stay unrendered by the caller. Unenrolled accounts see neither. */
export async function getEventAnyStatus(db: D1Database, eventId: string, actor?: Actor): Promise<PortalEvent | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM events WHERE id=?`).bind(eventId).first<EventRow>();
  if (!row) return null;
  const [event] = await hydrate(db, [row]);
  if (actor && !actor.isAdmin && !(await canViewFamilyEvents(db, actor))) return null;
  return event;
}
export async function listEvents(db: D1Database, actor: Actor): Promise<PortalEvent[]> {
  if (!actor.isAdmin && !(await canViewFamilyEvents(db, actor))) return [];
  const all = actor.isAdmin
    ? await rows<EventRow>(db, `SELECT ${COLS} FROM events ORDER BY starts_at DESC LIMIT 200`)
    : await rows<EventRow>(db, `SELECT ${COLS} FROM events WHERE status='published' ORDER BY starts_at ASC LIMIT 200`);
  return hydrate(db, all);
}
/** Occurrences overlapping a window; families only ever see published events. */
export async function listOccurrences(db: D1Database, actor: Actor, fromIso: string, toIso: string, options: { includeCancelled?: boolean } = {}): Promise<EventOccurrence[]> {
  const events = await listEvents(db, actor);
  const visible = actor.isAdmin ? events : events.filter((e) => e.status === "published");
  return visible.flatMap((e) => expandOccurrences(e, fromIso, toIso, options)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export async function upcomingOccurrences(db: D1Database, actor: Actor, limit = 3, nowIso = iso()): Promise<EventOccurrence[]> {
  const horizon = new Date(new Date(nowIso).getTime() + 180 * 86_400_000).toISOString();
  const all = await listOccurrences(db, actor, nowIso, horizon);
  return all.filter((o) => o.endsAt > nowIso).slice(0, limit);
}
export { fail as eventFail };
