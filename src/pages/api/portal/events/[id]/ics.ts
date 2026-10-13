import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { authorizePortal } from "../../../../../lib/portal/access";
import { buildIcs, getEvent, resolveOccurrence } from "../../../../../lib/portal/events";
import { portalResponse } from "../../../../../lib/portal/http";

export const prerender = false;
/** ?serie=1 downloads the whole series (RRULE); otherwise the single occurrence. */
export const GET: APIRoute = async (context) => {
  const access = await authorizePortal(context, env);
  if (!access.ok) return access.response;
  const event = await getEvent(env.DB, context.params.id!, access.actor).catch(() => null);
  if (!event) return portalResponse("Not found", 404);
  const nowIso = new Date().toISOString();
  const { occurrence } = resolveOccurrence(event, context.url.searchParams.get("occurrence"), nowIso);
  const wholeSeries = context.url.searchParams.get("serie") === "1" && event.recurrenceFreq !== "none";
  const ics = wholeSeries ? buildIcs(event) : buildIcs(event, occurrence ?? undefined);
  return portalResponse(ics, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="ajedrez-belen-evento.ics"`,
  });
};
