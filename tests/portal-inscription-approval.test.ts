import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canViewFamilyEvents } from "../src/lib/portal/events";
import { assertCanUploadSlip } from "../src/lib/portal/ocr";
import { parseRegistrationReview, InputError } from "../src/lib/portal/http";
import {
  approveRegistration,
  billingStartPeriod,
  countPendingRegistrations,
  dismissRejection,
  listPendingRegistrations,
  rejectRegistration,
  withdrawRegistration,
  createGuardianInvitation,
  createInvitation,
  enrollAthlete,
  ensureUser,
  getAdminDashboard,
  getMonthlyPreview,
  getParentDashboard,
  getRegistrationWindow,
  linkGuardian,
  listFamilies,
  needsAthleteRegistration,
  publishCurrentMonth,
  redeemInvitation,
  registerAthletes,
  setOwnAthleteActive,
  submitPayment,
} from "../src/lib/portal/domain";
import type { SelfAthleteInput } from "../src/lib/portal/domain";
import type { Actor, SubmitPaymentInput } from "../src/lib/portal/types";

/** The adapter executes real SQLite constraints and the same atomic batch as D1. */
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  beforeBatch?: () => unknown;
  constructor() {
    for (const migration of ["0002_portal", "0004_financial_operations", "0006_self_registration", "0007_fee_schedule", "0011_athlete_approval"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        values = args;
        return statement;
      },
      async all() {
        return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } };
      },
      async first(column?: string) {
        const row = database.sqlite.prepare(sql).get(...(values as never[])) as Record<string, unknown> | undefined;
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      async run() {
        return statement.execute();
      },
      execute() {
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    const before = this.beforeBatch;
    this.beforeBatch = undefined;
    await before?.();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  db() {
    return this as unknown as D1Database;
  }
}
const admin: Actor = { id: "admin-1", email: "admin@example.test", name: "Admin", isAdmin: true, mode: "workos" };
const parent: Actor = { id: "parent-1", email: "familia@example.test", name: "Encargado", isAdmin: false, mode: "workos" };
const spouse: Actor = { id: "parent-spouse", email: "esposa@example.test", name: "Esposa", isAdmin: false, mode: "workos" };
const stranger: Actor = { id: "parent-2", email: "otra@example.test", name: "Otra", isAdmin: false, mode: "workos" };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
// Birthdates relative to today so the age rules stay valid over time.
const birthForAge = (age: number) => {
  const now = new Date();
  return `${now.getFullYear() - age}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const child = (name: string, age = 9, category = "Cadetes"): SelfAthleteInput => ({ name, birthDate: birthForAge(age), school: "Escuela", category });
const status = (error: unknown) => (error as { status: number }).status;

/** A family that holds a redeemed registration invitation, so it may enroll its first athlete. */
async function setup() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  for (const actor of [admin, parent, spouse, stranger]) await ensureUser(db, actor);
  await createInvitation(db, admin, { email: parent.email, athleteIds: [], tokenHash: hash("tok-register"), kind: "register" });
  await redeemInvitation(db, parent, hash("tok-register"));
  return { adapter, db };
}
/** Stands in for the approval action (built in a later task) when a test needs a billed member. */
function approveDirect(adapter: SQLiteD1, ...ids: string[]) {
  for (const id of ids) adapter.sqlite.prepare("UPDATE athletes SET approval_status='approved', active=1 WHERE id=?").run(id);
}
const rowOf = (adapter: SQLiteD1, id: string) =>
  adapter.sqlite.prepare("SELECT approval_status AS status, active, start_period AS startPeriod FROM athletes WHERE id=?").get(id) as { status: string; active: number; startPeriod: string };

/** Direct row access for the schema tests; the domain functions come in later tasks. */
function insertAthlete(adapter: SQLiteD1, id: string, extra: { status?: string; active?: number } = {}) {
  const columns = ["id", "name", "category", "fee_minor", "start_period", "created_at", "updated_at"];
  const values: unknown[] = [id, `Atleta ${id}`, "Iniciación", 1200000, "2026-10", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"];
  if (extra.status !== undefined) { columns.push("approval_status"); values.push(extra.status); }
  if (extra.active !== undefined) { columns.push("active"); values.push(extra.active); }
  adapter.sqlite.prepare(`INSERT INTO athletes(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...(values as never[]));
}
const statusOf = (adapter: SQLiteD1, id: string) =>
  adapter.sqlite.prepare("SELECT approval_status AS status, active FROM athletes WHERE id=?").get(id) as { status: string; active: number };

test("athletes that already exist are grandfathered as approved", () => {
  const adapter = new SQLiteD1();
  insertAthlete(adapter, "old");
  assert.deepEqual({ ...statusOf(adapter, "old") }, { status: "approved", active: 1 });
});

test("a database trigger refuses an unapproved athlete that is active, on insert and on update", () => {
  const adapter = new SQLiteD1();
  assert.throws(() => insertAthlete(adapter, "a", { status: "pending", active: 1 }), /athlete_unapproved_active/);
  insertAthlete(adapter, "b", { status: "pending", active: 0 });
  assert.throws(() => adapter.sqlite.prepare("UPDATE athletes SET active=1 WHERE id='b'").run(), /athlete_unapproved_active/);
  assert.deepEqual({ ...statusOf(adapter, "b") }, { status: "pending", active: 0 });
});

test("a pending athlete becomes approved and active in one update", () => {
  const adapter = new SQLiteD1();
  insertAthlete(adapter, "a", { status: "pending", active: 0 });
  adapter.sqlite.prepare("UPDATE athletes SET approval_status='approved', active=1 WHERE id='a'").run();
  assert.deepEqual({ ...statusOf(adapter, "a") }, { status: "approved", active: 1 });
});

test("approved, rejected and withdrawn are final; only pending can move", () => {
  const adapter = new SQLiteD1();
  insertAthlete(adapter, "ok");
  assert.throws(() => adapter.sqlite.prepare("UPDATE athletes SET approval_status='pending', active=0 WHERE id='ok'").run(), /athlete_approval_final/);
  for (const final of ["rejected", "withdrawn"]) {
    insertAthlete(adapter, final, { status: "pending", active: 0 });
    adapter.sqlite.prepare("UPDATE athletes SET approval_status=? WHERE id=?").run(final, final);
    for (const next of ["approved", "pending"])
      assert.throws(() => adapter.sqlite.prepare("UPDATE athletes SET approval_status=? WHERE id=?").run(next, final), /athlete_approval_final/);
  }
});

test("the 300-athlete budget counts pending and approved rows only", () => {
  const adapter = new SQLiteD1();
  for (let i = 0; i < 290; i++) insertAthlete(adapter, `ok-${i}`);
  for (let i = 0; i < 20; i++) {
    insertAthlete(adapter, `dead-${i}`, { status: "pending", active: 0 });
    adapter.sqlite.prepare("UPDATE athletes SET approval_status=? WHERE id=?").run(i % 2 ? "rejected" : "withdrawn", `dead-${i}`);
  }
  for (let i = 0; i < 10; i++) insertAthlete(adapter, `more-${i}`);
  assert.throws(() => insertAthlete(adapter, "one-too-many"), /athlete_limit/);
  assert.throws(() => insertAthlete(adapter, "waiting", { status: "pending", active: 0 }), /athlete_limit/);
});

test("a fee change that touches rejected rows does not trip the approval rule", () => {
  const adapter = new SQLiteD1();
  insertAthlete(adapter, "r", { status: "pending", active: 0 });
  adapter.sqlite.prepare("UPDATE athletes SET approval_status='rejected' WHERE id='r'").run();
  adapter.sqlite.prepare("UPDATE athletes SET fee_minor=1500000, updated_at='2026-10-02T00:00:00.000Z' WHERE category='Iniciación'").run();
  assert.equal((adapter.sqlite.prepare("SELECT fee_minor AS f FROM athletes WHERE id='r'").get() as { f: number }).f, 1500000);
});

test("registering stores a pending, inactive athlete linked to the guardian, with an audit row", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Ana Pendiente")]);
  assert.deepEqual({ ...rowOf(adapter, id) }, { status: "pending", active: 0, startPeriod: billingStartPeriod(new Date().toISOString()) });
  const link = adapter.sqlite.prepare("SELECT active FROM guardian_links WHERE user_id=? AND athlete_id=?").get(parent.id, id) as { active: number };
  assert.equal(link.active, 1);
  const audit = adapter.sqlite.prepare("SELECT action FROM audit_events WHERE entity_id=?").all(id) as Array<{ action: string }>;
  assert.deepEqual(audit.map((row) => row.action), ["self_register"]);
  const dashboard = await getParentDashboard(db, parent);
  assert.equal(dashboard.athletes.length, 0, "a pending athlete is not a member yet");
  assert.deepEqual(dashboard.registrations.map((r) => [r.id, r.name, r.status, r.reviewNote]), [[id, "Ana Pendiente", "pending", null]]);
});

test("a pending athlete is billed nowhere and does not give an approved sibling the family discount", async () => {
  const { adapter, db } = await setup();
  const period = billingStartPeriod(new Date().toISOString());
  const approved = await enrollAthlete(db, admin, { name: "Hermano Aprobado", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: period });
  await linkGuardian(db, admin, { userId: parent.id, athleteId: approved });
  const [pending] = await registerAthletes(db, parent, [child("Hermana Pendiente")]);
  const preview = await getMonthlyPreview(db, period);
  assert.deepEqual(preview.athletes.map((a) => a.id), [approved]);
  const { created } = await publishCurrentMonth(db, `${period}-01T06:00:00.000Z`);
  assert.equal(created, 1);
  const charges = adapter.sqlite.prepare("SELECT athlete_id AS athleteId, discount_minor AS discount FROM charges").all() as Array<{ athleteId: string; discount: number }>;
  assert.deepEqual(charges.map((c) => [c.athleteId, c.discount]), [[approved, 0]]);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM charges WHERE athlete_id=?").get(pending)!.n, 0);
});

test("one account can hold six pending requests at a time", async () => {
  const { db } = await setup();
  await registerAthletes(db, parent, Array.from({ length: 6 }, (_, i) => child(`Pendiente ${i}`)));
  await assert.rejects(registerAthletes(db, parent, [child("Séptimo")]), (error: unknown) => status(error) === 409 && (error as { code: string }).code === "registration_limit");
  assert.equal((await getParentDashboard(db, parent)).registrations.length, 6);
});

test("the athlete limit counts pending and approved rows but not rejected or withdrawn ones", async () => {
  const { adapter, db } = await setup();
  const insert = adapter.sqlite.prepare("INSERT INTO athletes(id,name,category,fee_minor,start_period,created_at,updated_at,approval_status,active) VALUES(?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 296; i++) insert.run(`bulk-${i}`, `Bulk ${i}`, "Cadetes", 1500000, "2026-10", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "approved", 1);
  for (let i = 0; i < 10; i++) insert.run(`dead-${i}`, `Dead ${i}`, "Cadetes", 1500000, "2026-10", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", i % 2 ? "rejected" : "withdrawn", 0);
  await registerAthletes(db, parent, [child("Uno"), child("Dos"), child("Tres"), child("Cuatro")]);
  await assert.rejects(registerAthletes(db, parent, [child("Quinto")]), (error: unknown) => status(error) === 409);
});

test("a family linked only to a pending athlete gets no registration window of its own", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Compartida")]);
  await createGuardianInvitation(db, parent, { email: spouse.email, athleteIds: [id], tokenHash: hash("tok-spouse") });
  await redeemInvitation(db, spouse, hash("tok-spouse"));
  assert.equal(await getRegistrationWindow(db, spouse), null, "one pending request must not open permanent self-registration");
  assert.equal(await needsAthleteRegistration(db, spouse), false);
  await assert.rejects(registerAthletes(db, spouse, [child("Otra más")]), (error: unknown) => status(error) === 403);
  assert.equal((await getRegistrationWindow(db, parent))?.via, "invitation", "the open invitation still works");
  approveDirect(adapter, id);
  assert.equal((await getRegistrationWindow(db, spouse))?.via, "family");
});

test("an advance payment needs an approved athlete, not just a link", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Todavía No")]);
  const advance = (): SubmitPaymentInput => ({
    submissionId: crypto.randomUUID(), payerName: "Persona de prueba", amountMinor: 1200000, transferDate: "2026-10-10",
    bankReference: `ref-${crypto.randomUUID()}`, allocations: [], advance: true,
    file: { key: `portal/${crypto.randomUUID()}.png`, type: "image/png", size: 100, sha256: "a".repeat(64) },
  });
  await assert.rejects(submitPayment(db, parent, advance()), (error: unknown) => status(error) === 403);
  approveDirect(adapter, id);
  await submitPayment(db, parent, advance());
});

test("a parent cannot switch a pending athlete on, and an administrator cannot link to one", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("En Espera")]);
  await assert.rejects(setOwnAthleteActive(db, parent, id, true), (error: unknown) => status(error) === 409);
  await assert.rejects(linkGuardian(db, admin, { userId: stranger.id, athleteId: id }), (error: unknown) => status(error) === 409);
  assert.deepEqual({ ...rowOf(adapter, id) }.active, 0);
});

test("administrator lists show approved athletes only", async () => {
  const { adapter, db } = await setup();
  const [pending] = await registerAthletes(db, parent, [child("Solo Pendiente")]);
  assert.equal((await getAdminDashboard(db)).athletes.some((a) => a.id === pending), false);
  assert.equal((await listFamilies(db)).find((f) => f.adultId === parent.id)!.athletes.length, 0);
  approveDirect(adapter, pending);
  assert.equal((await getAdminDashboard(db)).athletes.some((a) => a.id === pending), true);
  assert.equal((await listFamilies(db)).find((f) => f.adultId === parent.id)!.athletes.length, 1);
});

test("a guardian invitation links pending and approved athletes but skips rejected and withdrawn ones", async () => {
  const { adapter, db } = await setup();
  const [pending, rejected, withdrawn] = await registerAthletes(db, parent, [child("Uno"), child("Dos"), child("Tres")]);
  adapter.sqlite.prepare("UPDATE athletes SET approval_status='rejected' WHERE id=?").run(rejected);
  adapter.sqlite.prepare("UPDATE athletes SET approval_status='withdrawn' WHERE id=?").run(withdrawn);
  await createGuardianInvitation(db, parent, { email: spouse.email, athleteIds: [pending, rejected, withdrawn], tokenHash: hash("tok-mixed") });
  await redeemInvitation(db, spouse, hash("tok-mixed"));
  assert.deepEqual((await getParentDashboard(db, spouse)).registrations.map((r) => r.id), [pending]);
});

test("an account can send twelve registrations a day however many it withdraws", async () => {
  const { adapter, db } = await setup();
  for (let round = 0; round < 2; round++) {
    const ids = await registerAthletes(db, parent, Array.from({ length: 6 }, (_, i) => child(`Ronda ${round} ${i}`)));
    for (const id of ids) adapter.sqlite.prepare("UPDATE athletes SET approval_status='withdrawn' WHERE id=?").run(id);
  }
  await assert.rejects(registerAthletes(db, parent, [child("Decimotercera")]), (error: unknown) => status(error) === 409 && (error as { code: string }).code === "registration_limit");
});

const auditActions = (adapter: SQLiteD1, id: string) =>
  (adapter.sqlite.prepare("SELECT action FROM audit_events WHERE entity_id=? ORDER BY created_at, rowid").all(id) as Array<{ action: string }>).map((row) => row.action);

test("approving makes the athlete an active member billed from the first eligible month, with one audit row", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Nueva Socia")]);
  adapter.sqlite.prepare("UPDATE athletes SET start_period='2020-01' WHERE id=?").run(id); // proves approval recomputes it
  await approveRegistration(db, admin, id);
  const period = billingStartPeriod(new Date().toISOString());
  assert.deepEqual({ ...rowOf(adapter, id) }, { status: "approved", active: 1, startPeriod: period });
  const stored = adapter.sqlite.prepare("SELECT reviewed_by AS by, reviewed_at AS at FROM athletes WHERE id=?").get(id) as { by: string; at: string };
  assert.equal(stored.by, admin.id);
  assert.ok(stored.at);
  assert.deepEqual(auditActions(adapter, id), ["self_register", "approve_registration"]);
  assert.equal((await getParentDashboard(db, parent)).athletes.length, 1);
  assert.equal((await getParentDashboard(db, parent)).registrations.length, 0);
  const { created } = await publishCurrentMonth(db, `${period}-01T06:00:00.000Z`);
  assert.equal(created, 1);
});

test("two approved siblings get the family discount, one alone does not", async () => {
  const { adapter, db } = await setup();
  const [first, second] = await registerAthletes(db, parent, [child("Hermana Uno"), child("Hermano Dos")]);
  const period = billingStartPeriod(new Date().toISOString());
  await approveRegistration(db, admin, first);
  assert.equal((await getMonthlyPreview(db, period)).athletes.find((a) => a.id === first)!.siblingMinor, 0);
  await approveRegistration(db, admin, second);
  assert.equal((await getMonthlyPreview(db, period)).athletes.find((a) => a.id === first)!.siblingMinor, 375000);
  assert.equal(rowOf(adapter, second).status, "approved");
});

test("an administrator can correct the group on approval, and the fee follows the fee schedule", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Cambia De Grupo", 9, "Principiantes")]);
  await assert.rejects(approveRegistration(db, admin, id, { category: "Maestros" }), (error: unknown) => status(error) === 400);
  assert.equal(rowOf(adapter, id).status, "pending", "a bad group leaves the request untouched");
  await approveRegistration(db, admin, id, { category: "Avanzados" });
  const stored = adapter.sqlite.prepare("SELECT category, fee_minor AS fee FROM athletes WHERE id=?").get(id) as { category: string; fee: number };
  assert.deepEqual({ ...stored }, { category: "Avanzados", fee: 1500000 });
  const detail = JSON.parse((adapter.sqlite.prepare("SELECT detail_json AS d FROM audit_events WHERE entity_id=? AND action='approve_registration'").get(id) as { d: string }).d);
  assert.equal(detail.requestedCategory, "Iniciación");
  assert.equal(detail.category, "Avanzados");
});

test("a request can be decided once: a second approval answers 409 and adds no audit row", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Una Vez")]);
  await approveRegistration(db, admin, id);
  await assert.rejects(approveRegistration(db, admin, id), (error: unknown) => status(error) === 409);
  await assert.rejects(rejectRegistration(db, admin, id, "Ya aprobada"), (error: unknown) => status(error) === 409);
  assert.deepEqual(auditActions(adapter, id), ["self_register", "approve_registration"]);
});

test("another administrator approving between the read and the write leaves no second audit row", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Carrera")]);
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE athletes SET approval_status='approved', active=1 WHERE id=?").run(id);
  await assert.rejects(approveRegistration(db, admin, id), (error: unknown) => status(error) === 409);
  assert.deepEqual(auditActions(adapter, id), ["self_register"]);
});

test("rejecting needs a reason, keeps the athlete out of billing and shows the family why", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("No Cabe")]);
  for (const reason of ["", "  ab ", "x".repeat(301)])
    await assert.rejects(rejectRegistration(db, admin, id, reason), (error: unknown) => status(error) === 400);
  assert.equal(rowOf(adapter, id).status, "pending");
  await rejectRegistration(db, admin, id, "  Faltan datos del centro educativo.  ");
  assert.deepEqual({ ...rowOf(adapter, id) }.status, "rejected");
  assert.equal(rowOf(adapter, id).active, 0);
  const [registration] = (await getParentDashboard(db, parent)).registrations;
  assert.deepEqual([registration.status, registration.reviewNote], ["rejected", "Faltan datos del centro educativo."]);
  assert.deepEqual(auditActions(adapter, id), ["self_register", "reject_registration"]);
  const period = billingStartPeriod(new Date().toISOString());
  assert.equal((await getMonthlyPreview(db, period)).athletes.length, 0);
});

test("only administrators decide requests", async () => {
  const { db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Sin Permiso")]);
  await assert.rejects(approveRegistration(db, parent, id), (error: unknown) => status(error) === 403);
  await assert.rejects(rejectRegistration(db, parent, id, "No puedo"), (error: unknown) => status(error) === 403);
});

test("an administrator who registers their own athlete still needs an approval, which an administrator may give", async () => {
  const { adapter, db } = await setup();
  await createInvitation(db, admin, { email: admin.email, athleteIds: [], tokenHash: hash("tok-admin-register"), kind: "register" });
  await redeemInvitation(db, admin, hash("tok-admin-register"));
  const [id] = await registerAthletes(db, admin, [child("Hijo Del Admin")]);
  assert.equal(rowOf(adapter, id).status, "pending");
  await approveRegistration(db, admin, id);
  assert.equal(rowOf(adapter, id).status, "approved");
});

test("a family can withdraw its own pending request and nobody else can", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Me Retiro")]);
  await assert.rejects(withdrawRegistration(db, stranger, id), (error: unknown) => status(error) === 404);
  await withdrawRegistration(db, parent, id);
  assert.deepEqual({ ...rowOf(adapter, id) }.status, "withdrawn");
  assert.equal((adapter.sqlite.prepare("SELECT count(*) n FROM guardian_links WHERE athlete_id=? AND active=1").get(id) as { n: number }).n, 0);
  assert.equal((await getParentDashboard(db, parent)).registrations.length, 0);
  assert.deepEqual(auditActions(adapter, id), ["self_register", "withdraw_registration"]);
  await assert.rejects(withdrawRegistration(db, parent, id), (error: unknown) => status(error) === 404, "its link is gone");
  assert.equal(await countPendingRegistrations(db), 0);
});

test("an approved or rejected athlete cannot be withdrawn, and a concurrent approval keeps the links", async () => {
  const { adapter, db } = await setup();
  const [approved, rejected, racing] = await registerAthletes(db, parent, [child("Aprobada"), child("Rechazada"), child("En Carrera")]);
  await approveRegistration(db, admin, approved);
  await rejectRegistration(db, admin, rejected, "No corresponde.");
  for (const id of [approved, rejected]) await assert.rejects(withdrawRegistration(db, parent, id), (error: unknown) => status(error) === 409);
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE athletes SET approval_status='approved', active=1 WHERE id=?").run(racing);
  await assert.rejects(withdrawRegistration(db, parent, racing), (error: unknown) => status(error) === 409);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) n FROM guardian_links WHERE athlete_id=? AND active=1").get(racing) as { n: number }).n, 1);
  assert.deepEqual(auditActions(adapter, racing), ["self_register"]);
});

test("dismissing a rejection hides it for that guardian only", async () => {
  const { db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Rechazo Compartido")]);
  await createGuardianInvitation(db, parent, { email: spouse.email, athleteIds: [id], tokenHash: hash("tok-share-rejected") });
  await redeemInvitation(db, spouse, hash("tok-share-rejected"));
  await assert.rejects(dismissRejection(db, parent, id), (error: unknown) => status(error) === 409, "still pending");
  await rejectRegistration(db, admin, id, "Datos incompletos.");
  await assert.rejects(dismissRejection(db, stranger, id), (error: unknown) => status(error) === 404);
  await dismissRejection(db, parent, id);
  assert.equal((await getParentDashboard(db, parent)).registrations.length, 0);
  assert.equal((await getParentDashboard(db, spouse)).registrations.length, 1);
});

test("the same child can be registered again after a rejection or a withdrawal, but not while pending", async () => {
  const { db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Otra Vez", 9)]);
  await assert.rejects(registerAthletes(db, parent, [child("Otra Vez", 9)]), (error: unknown) => status(error) === 409);
  await rejectRegistration(db, admin, id, "Corrige la fecha.");
  const [second] = await registerAthletes(db, parent, [child("Otra Vez", 9)]);
  await withdrawRegistration(db, parent, second);
  await registerAthletes(db, parent, [child("Otra Vez", 9)]);
});

test("the queue lists the oldest request first with the guardian, family context and possible duplicates", async () => {
  const { adapter, db } = await setup();
  await createInvitation(db, admin, { email: stranger.email, athleteIds: [], tokenHash: hash("tok-register-2"), kind: "register" });
  await redeemInvitation(db, stranger, hash("tok-register-2"));
  const member = await enrollAthlete(db, admin, { name: "Ya Miembro", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: "2026-01" });
  await linkGuardian(db, admin, { userId: parent.id, athleteId: member });
  const older = (await registerAthletes(db, parent, [{ ...child("Lucía Mora", 13), nationalId: "1-0234-0567" }]))[0];
  adapter.sqlite.prepare("UPDATE athletes SET created_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(older);
  const [sameCedula] = await registerAthletes(db, stranger, [{ ...child("Lucia M.", 13), nationalId: "102340567" }]);
  const [sameNameBirth] = await registerAthletes(db, stranger, [{ ...child("Lucía Mora", 13), nationalId: "109990999" }]);
  const [unrelated] = await registerAthletes(db, stranger, [child("Sin Relación", 7)]);
  assert.equal(await countPendingRegistrations(db), 4);
  const queue = await listPendingRegistrations(db);
  assert.equal(queue[0].id, older, "oldest first");
  const first = queue[0];
  assert.deepEqual([first.guardian.id, first.guardian.email, first.guardian.approvedAthletes], [parent.id, parent.email, 1]);
  assert.deepEqual([first.age, first.nationalId, first.school], [13, "102340567", "Escuela"]);
  assert.deepEqual(first.duplicates.map((d) => [d.id, d.reason]).sort(), [[sameCedula, "cedula"], [sameNameBirth, "name_birth"]].sort());
  assert.deepEqual(queue.find((r) => r.id === unrelated)!.duplicates, []);
  assert.equal(queue.find((r) => r.id === unrelated)!.guardian.approvedAthletes, 0);
  await rejectRegistration(db, admin, sameCedula, "Duplicada.");
  assert.deepEqual((await listPendingRegistrations(db))[0].duplicates.map((d) => d.id), [sameNameBirth], "rejected requests are not duplicates");
});

test("the review form accepts an approval, with or without a group, and a rejection with a reason, and nothing else", () => {
  const form = (fields: Record<string, string>) => new FormData() && Object.entries(fields).reduce((data, [key, value]) => (data.set(key, value), data), new FormData());
  assert.deepEqual(parseRegistrationReview(form({ action: "approve" })), { action: "approve" });
  assert.deepEqual(parseRegistrationReview(form({ action: "approve", category: "Cadetes" })), { action: "approve", category: "Cadetes" });
  assert.deepEqual(parseRegistrationReview(form({ action: "reject", reason: " Falta la cédula. " })), { action: "reject", reason: "Falta la cédula." });
  assert.throws(() => parseRegistrationReview(form({ action: "reject" })), InputError);
  assert.throws(() => parseRegistrationReview(form({ action: "delete" })), InputError);
  assert.throws(() => parseRegistrationReview(form({})), InputError);
});

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the review route parses the form and runs the matching action as an administrator", () => {
  const route = source("src/pages/api/admin/athletes/[id]/review.ts");
  assert.match(route, /admin:\s*true/);
  assert.match(route, /parseRegistrationReview\(form\)/);
  assert.match(route, /approveRegistration\(/);
  assert.match(route, /rejectRegistration\(/);
  assert.match(route, /registration_approved/);
  assert.match(route, /registration_rejected/);
});

test("administrator pages ask for the waiting count without letting a failure break them", () => {
  for (const file of ["src/layouts/PortalLayout.astro", "src/pages/admin/index.astro"])
    assert.match(source(file), /countPendingRegistrations\([^)]*\)\.catch\(/, file);
  assert.match(source("src/layouts/PortalLayout.astro"), /\/admin\/inscripciones/);
});

test("the queue page guards its query and offers duplicates, a group choice, approval and a rejection reason", () => {
  const page = source("src/pages/admin/inscripciones.astro");
  assert.match(page, /listPendingRegistrations\([^)]*\)\.catch\(/);
  assert.match(page, /\.duplicates/);
  assert.match(page, /name="category"/);
  assert.match(page, /name="reason"[^>]*required/);
  assert.match(page, /value="approve"/);
  assert.match(page, /value="reject"/);
  assert.match(page, /No hay inscripciones por revisar/);
});

test("the notices and the limit code the registration flow uses are defined", () => {
  const notice = source("src/components/portal/Notice.astro");
  for (const key of ["registration_approved", "registration_rejected", "registration_limit"]) assert.match(notice, new RegExp(`${key}:`));
  assert.match(source("src/lib/portal/http.ts"), /'registration_limit'/);
});

test("the family athlete route can withdraw a pending request and dismiss a rejection", () => {
  const route = source("src/pages/api/portal/athletes/[id].ts");
  for (const part of ["withdrawRegistration(", "dismissRejection(", "registration_withdrawn", "registration_dismissed", "setOwnAthleteActive("]) assert.ok(route.includes(part), part);
});

test("the request cards say what stands, offer withdrawing and dismissing, and show the reason", () => {
  const card = source("src/components/portal/Registrations.astro");
  for (const part of ["En revisión", "No aprobada", "Retirar solicitud", "Entendido", "reviewNote", "data-confirm", 'value="withdraw"', 'value="dismiss"', "wa.me/50687686102"])
    assert.ok(card.includes(part), part);
});

test("Mis atletas lists the requests, does not send a waiting family back to the form, and explains when billing starts", () => {
  const page = source("src/pages/portal/inscribir.astro");
  assert.match(page, /<Registrations[^>]*manage/);
  assert.match(page, /mustRegister = [^\n]*registrations/);
  assert.match(page, /La Asociación revisa cada inscripción/);
  assert.match(source("src/components/portal/Notice.astro"), /athletes_registered: '[^']*revisa/);
});

test("the family home and payment page say a waiting inscription is in review instead of asking for an invitation", () => {
  const home = source("src/pages/portal/index.astro");
  assert.match(home, /Tu inscripción está en revisión/);
  assert.match(home, /dashboard\.registrations/);
  assert.match(home, /<Registrations/);
  assert.match(home, /dashboard\.athletes\.length > 0 && waitingRegistrations\.length > 0/, "mixed families get one line");
  assert.match(home, /const nextStepReady = actionNeeded\.length === 0 && dashboard\.athletes\.length > 0/);
  const pay = source("src/pages/portal/pagos/nuevo.astro");
  assert.match(pay, /Tu inscripción está en revisión/);
  assert.match(pay, /dashboard\?\.registrations/);
});

test("family events and slip upload are for families with an approved athlete, not for a pending or rejected request", async () => {
  const { adapter, db } = await setup();
  const [id] = await registerAthletes(db, parent, [child("Todavía No")]);
  const access = async () => [await canViewFamilyEvents(db, parent), await assertCanUploadSlip(db, parent).then(() => true, (error: unknown) => status(error) === 403 ? false : Promise.reject(error))];
  assert.deepEqual(await access(), [false, false], "pending");
  await rejectRegistration(db, admin, id, "No corresponde.");
  assert.deepEqual(await access(), [false, false], "rejected, link still open until the family dismisses it");
  const member = await enrollAthlete(db, admin, { name: "Ya Miembro", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: "2026-01" });
  await linkGuardian(db, admin, { userId: parent.id, athleteId: member });
  assert.deepEqual(await access(), [true, true], "approved");
  assert.equal(rowOf(adapter, id).status, "rejected");
});

test("the family only hears it can register again when the registration window is open", () => {
  const card = source("src/components/portal/Registrations.astro");
  assert.match(card, /canRegister/);
  assert.match(card, /data-confirm=\{canRegister \?/);
  assert.doesNotMatch(source("src/components/portal/Notice.astro"), /registration_withdrawn: '[^']*de nuevo/);
  const home = source("src/pages/portal/index.astro");
  assert.match(home, /getRegistrationWindow\([^)]*\)\.catch\(/);
  assert.match(home, /<Registrations[^>]*canRegister=/);
  const page = source("src/pages/portal/inscribir.astro");
  assert.match(page, /<Registrations[^>]*canRegister=\{Boolean\(window\)\}/);
});

test("Mis atletas names the section by what is in it and still shows requests to an administrator without a window", () => {
  const page = source("src/pages/portal/inscribir.astro");
  assert.match(page, /Inscripciones no aprobadas/);
  assert.match(page, /actor\.isAdmin && !window && !\(dashboard\?\.athletes\.length\) && !\(dashboard\?\.registrations\.length\)/);
});
