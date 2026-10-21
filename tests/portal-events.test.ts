import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ensureUser } from "../src/lib/portal/domain";
import {
  buildIcs, cancelOccurrence, createEvent, deleteEvent, detectEventImageType, expandOccurrences, getEvent,
  getEventAnyStatus, listOccurrences, normalizeEventInput, occurrenceState, recurrenceLabel, resolveOccurrence,
  restoreOccurrence, setEventStatus, updateEvent, upcomingOccurrences,
  type EventInput,
} from "../src/lib/portal/events";
import type { Actor } from "../src/lib/portal/types";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../migrations/0002_portal.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0008_events.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0009_event_exceptions.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0011_athlete_approval.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() { return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } }; },
      async first(column?: string) {
        const row = database.sqlite.prepare(sql).get(...(values as never[])) as Record<string, unknown> | undefined;
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      async run() { return statement.execute(); },
      execute() {
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const r = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return r; }
    catch (e) { this.sqlite.exec("ROLLBACK"); throw e; }
  }
  db() { return this as unknown as D1Database; }
}
const admin: Actor = { id: "demo-admin", email: "admin@example.invalid", name: "Admin", isAdmin: true, mode: "demo" };
const parent: Actor = { id: "demo-parent-a", email: "ana@example.invalid", name: "Ana", isAdmin: false, mode: "demo" };
const stranger: Actor = { id: "demo-stranger", email: "extra@example.invalid", name: "Extra", isAdmin: false, mode: "demo" };
async function setup() {
  const adapter = new SQLiteD1(); const db = adapter.db();
  await ensureUser(db, admin); await ensureUser(db, parent); await ensureUser(db, stranger);
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO athletes(id,name,category,fee_minor,discount_minor,active,start_period,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?,?)",
  ).bind("ath-parent", "Hijo", "Cadetes", 1500000, "2026-10", now, now).run();
  await db.prepare(
    "INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,?,1,0,?,?,?)",
  ).bind(parent.id, "ath-parent", admin.id, now, now).run();
  return db;
}
const zoom = (over: Partial<EventInput> = {}): EventInput => ({
  title: "Llamada semanal por Zoom", description: "Clase y anuncios.",
  date: "2026-10-13", startTime: "19:00", endTime: "20:00",
  locationType: "online", locationLabel: "Zoom semanal", locationUrl: "https://zoom.us/j/123456789",
  recurrenceFreq: "weekly", recurrenceCount: 4, ...over,
});

test("CR wall time converts to UTC (UTC-6) and back", () => {
  const n = normalizeEventInput(zoom());
  assert.equal(n.startsAt, "2026-10-14T01:00:00.000Z");
  assert.equal(n.endsAt, "2026-10-14T02:00:00.000Z");
});

test("location rules: online needs URL, in_person needs address, hybrid needs both", () => {
  assert.throws(() => normalizeEventInput(zoom({ locationUrl: null })), { code: "invalid_location" });
  assert.throws(() => normalizeEventInput(zoom({ locationType: "in_person", locationUrl: null, locationAddress: null })), { code: "invalid_location" });
  assert.throws(() => normalizeEventInput(zoom({ locationType: "hybrid", locationAddress: null })), { code: "invalid_location" });
  assert.throws(() => normalizeEventInput(zoom({ locationUrl: "javascript:alert(1)" })), { code: "invalid_location" });
  assert.throws(() => normalizeEventInput(zoom({ locationUrl: "http://zoom.us/j/123" })), { code: "invalid_location" });
  const ok = normalizeEventInput(zoom({ locationType: "hybrid", locationAddress: "Belén, Heredia" }));
  assert.equal(ok.locationAddress, "Belén, Heredia");
  assert.match(ok.locationUrl!, /^https:/);
});

test("weekly Zoom series expands by count, monthly clamps to month end", async () => {
  const db = await setup();
  const event = await createEvent(db, admin, zoom());
  const occ = expandOccurrences(event, "2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z");
  assert.equal(occ.length, 4);
  assert.deepEqual(occ.map((o) => o.startsAt.slice(0, 10)), ["2026-10-14", "2026-10-21", "2026-10-28", "2026-11-04"]);
  const monthly = await createEvent(db, admin, zoom({ title: "Pago y anuncios", date: "2026-01-31", recurrenceFreq: "monthly", recurrenceCount: 3, recurrenceUntil: null }));
  const m = expandOccurrences(monthly, "2026-01-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
  // 31 Jan CR -> 28 Feb CR -> 31 Mar CR (UTC dates shift by +6h)
  assert.equal(m.length, 3);
  assert.match(m[1].startsAt, /^2026-03-01T0[01]:/);
});

test("families see only published; drafts/cancelled hidden, no RSVP surface", async () => {
  const db = await setup();
  const published = await createEvent(db, admin, zoom({ recurrenceFreq: "none", recurrenceCount: null }));
  await createEvent(db, admin, zoom({ title: "Borrador interno", status: "draft", recurrenceFreq: "none", recurrenceCount: null }));
  const forParent = await listOccurrences(db, parent, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  assert.deepEqual(forParent.map((o) => o.event.id), [published.id]);
  assert.equal(await getEvent(db, published.id, parent) !== null, true);
  await setEventStatus(db, admin, published.id, "cancelled");
  assert.equal((await listOccurrences(db, parent, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).length, 0);
  assert.equal(await getEvent(db, published.id, parent), null);
  assert.notEqual(await getEvent(db, published.id, admin), null);
});

test("an account with no active guardian link cannot see published events or cancelled tombstones", async () => {
  const db = await setup();
  const published = await createEvent(db, admin, zoom({ recurrenceFreq: "none", recurrenceCount: null }));
  assert.equal(await getEvent(db, published.id, stranger), null);
  assert.equal((await listOccurrences(db, stranger, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).length, 0);
  assert.equal((await upcomingOccurrences(db, stranger, 5, "2026-10-01T00:00:00.000Z")).length, 0);
  await setEventStatus(db, admin, published.id, "cancelled");
  assert.equal(await getEventAnyStatus(db, published.id, stranger), null);
  assert.equal((await getEventAnyStatus(db, published.id, parent))?.status, "cancelled");
  await db.prepare("UPDATE guardian_links SET active=0 WHERE user_id=?").bind(parent.id).run();
  assert.equal(await getEventAnyStatus(db, published.id, parent), null);
  assert.equal((await getEvent(db, published.id, admin))?.status, "cancelled");
});

test("only admins mutate; update edits whole series; delete returns image", async () => {
  const db = await setup();
  await assert.rejects(createEvent(db, parent, zoom()), { code: "forbidden" });
  const event = await createEvent(db, admin, zoom());
  const updated = await updateEvent(db, admin, event.id, zoom({ title: "Zoom — nuevo horario", startTime: "18:30", endTime: "19:30" }));
  assert.equal(updated.title, "Zoom — nuevo horario");
  assert.equal(updated.startsAt, "2026-10-14T00:30:00.000Z");
  const upcoming = await upcomingOccurrences(db, parent, 2, "2026-10-14T01:30:00.000Z");
  assert.equal(upcoming[0].event.id, event.id);
  assert.equal(await deleteEvent(db, admin, event.id), null);
  assert.equal(await getEvent(db, event.id, admin), null);
});

test("recurrence until is inclusive in Costa Rica dates; image type sniffing", async () => {
  const n = normalizeEventInput(zoom({ recurrenceCount: null, recurrenceUntil: "2026-10-27" }));
  assert.equal(n.recurrenceUntil, "2026-10-27");
  assert.equal(detectEventImageType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])), "image/png");
  assert.equal(detectEventImageType(new TextEncoder().encode("RIFFxxxxWEBP")), "image/webp");
  assert.equal(detectEventImageType(new Uint8Array([1, 2, 3])), null);
  await assert.rejects((async () => { const db = await setup(); await createEvent(db, admin, zoom({ recurrenceUntil: "2026-10-01" })); })(), { code: "invalid_recurrence" });
});

test("resolveOccurrence never throws: invalid or missing params substitute the next date", async () => {
  const db = await setup();
  const event = await createEvent(db, admin, zoom()); // starts 2026-10-14T01:00Z, weekly x4
  const now = "2026-10-20T12:00:00.000Z";
  for (const param of ["basura", "", null, "2026-01-01T00:00:00Z"]) {
    const r = resolveOccurrence(event, param as string, now);
    assert.equal(r.occurrence?.startsAt, "2026-10-21T01:00:00.000Z", String(param));
  }
  const exact = resolveOccurrence(event, "2026-10-28T01:00:00.000Z", now);
  assert.equal(exact.substituted, false);
  assert.equal(exact.occurrence?.startsAt, "2026-10-28T01:00:00.000Z");
});

test("cancelling one occurrence skips only that week; restoring brings it back", async () => {
  const db = await setup();
  const event = await createEvent(db, admin, zoom());
  await cancelOccurrence(db, admin, event.id, "2026-10-21T01:00:00.000Z");
  const after = await getEvent(db, event.id, admin);
  const visible = expandOccurrences(after!, "2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z");
  assert.deepEqual(visible.map((o) => o.startsAt.slice(0, 10)), ["2026-10-14", "2026-10-28", "2026-11-04"]);
  const withCancelled = expandOccurrences(after!, "2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", { includeCancelled: true });
  assert.equal(withCancelled.find((o) => o.startsAt.includes("10-21"))?.cancelled, true);
  const parentList = await listOccurrences(db, parent, "2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z");
  assert.equal(parentList.length, 3);
  await assert.rejects(cancelOccurrence(db, admin, event.id, "2026-10-22T01:00:00.000Z"), { code: "invalid_recurrence" });
  await restoreOccurrence(db, admin, event.id, "2026-10-21T01:00:00.000Z");
  const restored = await getEvent(db, event.id, admin);
  assert.equal(expandOccurrences(restored!, "2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z").length, 4);
});

test("same submissionId does not duplicate; equal start/end rejected; labels localized", async () => {
  const db = await setup();
  const a = await createEvent(db, admin, zoom({ submissionId: "sub-1" }));
  const b = await createEvent(db, admin, zoom({ submissionId: "sub-1" }));
  assert.equal(a.id, b.id);
  assert.throws(() => normalizeEventInput(zoom({ startTime: "19:00", endTime: "19:00" })), { code: "invalid_event" });
  const label = recurrenceLabel(await createEvent(db, admin, zoom({ submissionId: "sub-2", recurrenceCount: null, recurrenceUntil: "2026-12-29" })));
  assert.match(label, /Cada martes/);
  assert.match(label, /29 de diciembre de 2026/);
  assert.doesNotMatch(label, /2026-12-29/);
});

test("occurrence states and ICS export (series RRULE + EXDATE)", async () => {
  const db = await setup();
  const event = await createEvent(db, admin, zoom());
  await cancelOccurrence(db, admin, event.id, "2026-10-21T01:00:00.000Z");
  const withEx = (await getEvent(db, event.id, admin))!;
  assert.equal(occurrenceState({ startsAt: "2026-10-14T01:00:00.000Z", endsAt: "2026-10-14T02:00:00.000Z" }, "2026-10-14T01:30:00.000Z"), "live");
  assert.equal(occurrenceState({ startsAt: "2026-10-14T01:00:00.000Z", endsAt: "2026-10-14T02:00:00.000Z" }, "2026-10-13T20:00:00.000Z"), "today");
  const ics = buildIcs(withEx);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4/);
  assert.match(ics, /EXDATE:20261021T010000Z/);
  assert.match(ics, /BEGIN:VCALENDAR/);
});
