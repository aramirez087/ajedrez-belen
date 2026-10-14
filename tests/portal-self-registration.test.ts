import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ageOn,
  billingPeriod,
  billingStartPeriod,
  createInvitation,
  ensureUser,
  getMonthlyPreview,
  getRegistrationWindow,
  needsAthleteRegistration,
  publishCurrentMonth,
  redeemInvitation,
  registerAthletes,
  registerAthletesWithOptionalGuardian,
  listAthleteProfiles,
  listOwnAthleteProfiles,
  createGuardianInvitation,
  revokeGuardian,
  enrollAthlete,
  getParentDashboard,
  linkGuardian,
  setAthletePaused,
  setOwnAthleteActive,
  submitPayment,
} from "../src/lib/portal/domain";
import type { Actor } from "../src/lib/portal/types";
import type { APIContext } from "astro";
import { authorizePortal } from "../src/lib/portal/access";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const migration of ["0002_portal.sql", "0004_financial_operations.sql", "0006_self_registration.sql"]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
  }
  prepare(sql: string) {
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async all() {
        return { results: database.sqlite.prepare(sql).all(...(values as never[])), success: true, meta: { changes: 0 } };
      },
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
    try {
      const results = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  db() { return this as unknown as D1Database; }
}

const admin: Actor = { id: "admin-1", email: "admin@example.test", name: "Admin", isAdmin: true, mode: "workos" };
const parent: Actor = { id: "parent-1", email: "familia@example.test", name: "Encargado", isAdmin: false, mode: "workos" };
const stranger: Actor = { id: "parent-2", email: "otra@example.test", name: "Otra", isAdmin: false, mode: "workos" };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
// Birthdates relative to today so the age rules stay valid over time.
const birthForAge = (age: number) => {
  const now = new Date();
  return `${now.getFullYear() - age}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

async function setup() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  await ensureUser(db, admin);
  await ensureUser(db, parent);
  await ensureUser(db, stranger);
  await createInvitation(db, admin, { email: parent.email, athleteIds: [], tokenHash: hash("tok-register"), kind: "register" });
  const redeemed = await redeemInvitation(db, parent, hash("tok-register"));
  return { adapter, db, redeemed };
}

test("age is derived from the birthdate, including the birthday boundary", () => {
  assert.equal(ageOn("2013-06-15", "2026-06-14"), 12);
  assert.equal(ageOn("2013-06-15", "2026-06-15"), 13);
  assert.equal(ageOn("2013-06-15", "2026-10-13"), 13);
});

test("first billing month: registration on or before the 8th bills that month, from the 9th it starts next month", () => {
  // America/Costa_Rica is UTC-6; 06:00Z is midnight CR on the stated day.
  assert.equal(billingStartPeriod("2026-10-01T06:00:00.000Z"), "2026-10");
  assert.equal(billingStartPeriod("2026-10-08T06:00:00.000Z"), "2026-10");
  assert.equal(billingStartPeriod("2026-10-08T23:00:00.000Z"), "2026-10"); // 17:00 CR, still the 8th
  assert.equal(billingStartPeriod("2026-10-09T06:00:00.000Z"), "2026-11");
  assert.equal(billingStartPeriod("2026-10-31T06:00:00.000Z"), "2026-11");
  assert.equal(billingStartPeriod("2026-12-09T06:00:00.000Z"), "2027-01"); // year rollover
  assert.equal(billingStartPeriod("2026-12-08T06:00:00.000Z"), "2026-12");
});

test("a registration invitation opens a self-service window and the cédula rule follows the derived age", async () => {
  const { db, redeemed } = await setup();
  assert.equal(redeemed.kind, "register");
  assert.equal((await getRegistrationWindow(db, parent))?.via, "invitation");
  assert.equal(await getRegistrationWindow(db, stranger), null);
  assert.equal(await needsAthleteRegistration(db, parent), true);
  assert.equal(await needsAthleteRegistration(db, stranger), false);
  await assert.rejects(
    registerAthletes(db, stranger, [{ name: "Sin Ventana", birthDate: birthForAge(9), school: "Escuela", category: "Cadetes" }]),
    (error: unknown) => (error as { status: number }).status === 403,
  );
  // 13 years old without cédula, and with the old "fill with ones" placeholder: both rejected.
  await assert.rejects(
    registerAthletes(db, parent, [{ name: "Mayor Sin Cédula", birthDate: birthForAge(13), school: "Colegio", category: "Cadetes" }]),
    /cédula/,
  );
  await assert.rejects(
    registerAthletes(db, parent, [{ name: "Mayor Con Unos", birthDate: birthForAge(13), nationalId: "111111111", school: "Colegio", category: "Cadetes" }]),
    /cédula/,
  );
});

test("siblings self-register with derived fees, then publish with the family discount", async () => {
  const { adapter, db } = await setup();
  const ids = await registerAthletes(db, parent, [
    { name: "Hermana Mayor", birthDate: birthForAge(13), nationalId: "1-0234-0567", school: "Colegio", category: "Cadetes" },
    { name: "Hermano Menor", birthDate: birthForAge(8), school: "Escuela", category: "Principiantes" },
  ]);
  assert.equal(ids.length, 2);
  assert.equal(await needsAthleteRegistration(db, parent), false);
  const athletes = adapter.sqlite.prepare(
    "SELECT name,category,fee_minor AS fee,national_id AS nationalId,active,start_period AS startPeriod FROM athletes ORDER BY name",
  ).all() as Array<{ name: string; category: string; fee: number; nationalId: string | null; active: number; startPeriod: string }>;
  assert.deepEqual(athletes.map((a) => [a.category, a.fee]), [["Cadetes", 1500000], ["Iniciación", 1200000]]);
  assert.equal(athletes[0].nationalId, "102340567");
  assert.equal(athletes[1].nationalId, null);
  assert.ok(athletes.every((a) => a.active === 1 && a.startPeriod === billingStartPeriod(new Date().toISOString())));
  await assert.rejects(
    registerAthletes(db, parent, [{ name: "Hermana Mayor", birthDate: birthForAge(13), nationalId: "102340567", school: "Colegio", category: "Cadetes" }]),
    (error: unknown) => (error as { status: number }).status === 409,
  );
  // Publish the first billed month (this month on/before the 8th, next month after).
  const startPeriod = billingStartPeriod(new Date().toISOString());
  const { created } = await publishCurrentMonth(db, `${startPeriod}-01T06:00:00.000Z`);
  assert.equal(created, 2);
  const charges = adapter.sqlite.prepare(
    "SELECT period, base_minor - discount_minor AS total FROM charges ORDER BY base_minor DESC",
  ).all() as Array<{ period: string; total: number }>;
  assert.deepEqual(charges.map((c) => c.total), [1125000, 900000]); // 25% off both siblings
  assert.ok(charges.every((c) => c.period === startPeriod)); // no charge before the first billed month
});

test("a linked family can add athletes at any time, and the guardian controls baja/alta of their own", async () => {
  const { db } = await setup();
  const [first] = await registerAthletes(db, parent, [
    { name: "Primero", birthDate: birthForAge(10), school: "Escuela", category: "Cadetes" },
  ]);
  // Even without any fresh invitation, the existing link keeps self-service open.
  const [second] = await registerAthletes(db, parent, [
    { name: "Segundo", birthDate: birthForAge(9), school: "Escuela", category: "Cadetes" },
  ]);
  assert.ok(second);
  await assert.rejects(setOwnAthleteActive(db, stranger, first, false),
    (error: unknown) => (error as { status: number }).status === 404);
  await setOwnAthleteActive(db, parent, first, false);
  const preview = await getMonthlyPreview(db, "2027-01");
  assert.deepEqual(preview.athletes.map((a) => a.name), ["Segundo"]);
  await setOwnAthleteActive(db, parent, first, true);
  assert.equal((await getMonthlyPreview(db, "2027-01")).athletes.length, 2);
  await setOwnAthleteActive(db, parent, first, false);
  await revokeGuardian(db, admin, { userId: parent.id, athleteId: first });
  await assert.rejects(setOwnAthleteActive(db, parent, first, true),
    (error: unknown) => (error as { status: number }).status === 404);
  assert.equal((await getMonthlyPreview(db, "2027-01")).athletes.length, 1);
});

test("a guardian invites the other guardian to exactly their own athletes, during or after registration", async () => {
  const { db } = await setup();
  const ids = await registerAthletes(db, parent, [
    { name: "Compartido Uno", birthDate: birthForAge(10), school: "Escuela", category: "Cadetes" },
    { name: "Compartido Dos", birthDate: birthForAge(8), school: "Escuela", category: "Iniciación" },
  ]);
  const spouse: Actor = { id: "parent-spouse", email: "esposa@example.test", name: "Esposa", isAdmin: false, mode: "workos" };
  await ensureUser(db, spouse);
  // Own email and other families' athletes are rejected.
  await assert.rejects(
    createGuardianInvitation(db, parent, { email: parent.email, athleteIds: ids, tokenHash: hash("tok-self") }),
    /otra persona/,
  );
  const foreign = await enrollAthlete(db, admin, {
    name: "De Otra Familia", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: billingPeriod(new Date().toISOString()),
  });
  await assert.rejects(
    createGuardianInvitation(db, parent, { email: spouse.email, athleteIds: [foreign], tokenHash: hash("tok-foreign") }),
    (error: unknown) => (error as { status: number }).status === 403,
  );
  // Happy path: the spouse redeems and sees the same athletes; balances are shared.
  await createGuardianInvitation(db, parent, { email: spouse.email, athleteIds: ids, tokenHash: hash("tok-spouse") });
  const redeemed = await redeemInvitation(db, spouse, hash("tok-spouse"));
  assert.equal(redeemed.kind, "link");
  assert.deepEqual((await getParentDashboard(db, spouse)).athletes.map((a) => a.id).sort(), [...ids].sort());
  // And the spouse can add the next sibling without a new invitation from anyone.
  const [third] = await registerAthletes(db, spouse, [
    { name: "Compartido Tres", birthDate: birthForAge(6), school: "Escuela", category: "Iniciación" },
  ]);
  assert.ok(third);
});

test("dual role: an administrator who is also a guardian pays their own family like any parent", async () => {
  const { db } = await setup();
  const athleteId = await enrollAthlete(db, admin, {
    name: "Hija Del Admin", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: billingPeriod(new Date().toISOString()),
  });
  await linkGuardian(db, admin, { userId: admin.id, athleteId });
  await publishCurrentMonth(db, new Date().toISOString());
  const [charge] = (await getParentDashboard(db, admin)).charges;
  assert.ok(charge, "the administrator sees the family charge in the parent dashboard");
  const paymentInput = {
    submissionId: crypto.randomUUID(),
    payerName: "Admin Encargado",
    amountMinor: charge.balanceMinor,
    transferDate: "2026-10-10",
    bankReference: "REF-DOBLE-ROL-1",
    allocations: [{ chargeId: charge.id, amountMinor: charge.balanceMinor }],
    file: { key: `portal/${crypto.randomUUID()}.png`, type: "image/png", size: 100, sha256: "b".repeat(64) },
  };
  // Own family: no staff-assistance reason needed, designated to self.
  const paymentId = await submitPayment(db, admin, { ...paymentInput, designatedAdultId: admin.id });
  assert.ok(paymentId);
  // Someone else's family: the reason stays mandatory.
  await assert.rejects(
    submitPayment(db, admin, { ...paymentInput, submissionId: crypto.randomUUID(), bankReference: "REF-DOBLE-ROL-2", designatedAdultId: parent.id }),
    /inválido|Texto/i,
  );
});

test("admin pause stops new charges without touching history, and only admins can pause", async () => {
  const { adapter, db } = await setup();
  const [pausedId, siblingId] = await registerAthletes(db, parent, [
    { name: "En Pausa", birthDate: birthForAge(11), school: "Escuela", category: "Cadetes" },
    { name: "Activo", birthDate: birthForAge(10), school: "Escuela", category: "Cadetes" },
  ]);
  await publishCurrentMonth(db, "2027-01-01T06:00:00.000Z");
  await assert.rejects(setAthletePaused(db, parent, pausedId, true),
    (error: unknown) => (error as { status: number }).status === 403);
  await setAthletePaused(db, admin, pausedId, true);
  const february = await publishCurrentMonth(db, "2027-02-01T06:00:00.000Z");
  assert.equal(february.created, 1); // only the non-paused sibling
  const febCharges = adapter.sqlite.prepare(
    "SELECT athlete_id AS athleteId, base_minor - discount_minor AS total FROM charges WHERE period='2027-02'",
  ).all() as Array<{ athleteId: string; total: number }>;
  assert.equal(febCharges.length, 1);
  assert.equal(febCharges[0].athleteId, siblingId);
  assert.equal(febCharges[0].total, 1125000); // paused sibling still counts for the 25% rate
  const januaryCount = adapter.sqlite.prepare("SELECT count(*) AS n FROM charges WHERE period='2027-01'").get() as { n: number };
  assert.equal(januaryCount.n, 2); // history untouched
  await setAthletePaused(db, admin, pausedId, false);
  const march = await publishCurrentMonth(db, "2027-03-01T06:00:00.000Z");
  assert.equal(march.created, 2);
});

test("a malformed co-guardian email does not save the athletes", async () => {
  const { adapter, db } = await setup();
  const athletes = [{ name: "No Debe Quedar", birthDate: birthForAge(9), school: "Escuela", category: "Cadetes" as const }];
  const count = () => (adapter.sqlite.prepare("SELECT count(*) AS n FROM athletes").get() as { n: number }).n;
  await assert.rejects(
    registerAthletesWithOptionalGuardian(db, parent, athletes, { email: "no-es-correo", tokenHash: hash("tok-bad-mail") }),
    (error: unknown) => (error as { status: number }).status === 400,
  );
  assert.equal(count(), 0);
  await assert.rejects(
    registerAthletesWithOptionalGuardian(db, parent, athletes, { email: parent.email, tokenHash: hash("tok-self-mail") }),
    /otra persona/,
  );
  assert.equal(count(), 0);
  const ids = await registerAthletesWithOptionalGuardian(db, parent, athletes, { email: "otro@example.test", tokenHash: hash("tok-ok-mail") });
  assert.equal(ids.length, 1);
  const invite = adapter.sqlite.prepare("SELECT email FROM invitations WHERE token_hash=?").get(hash("tok-ok-mail")) as { email: string };
  assert.equal(invite.email, "otro@example.test");
});

test("a parent profile list includes only that family's athletes and omits cédula", async () => {
  const { db } = await setup();
  const [own] = await registerAthletes(db, parent, [
    { name: "Mio", birthDate: birthForAge(13), nationalId: "1-0234-0567", school: "Colegio", category: "Cadetes" },
  ]);
  const foreign = await enrollAthlete(db, admin, {
    name: "Ajeno", category: "Cadetes", feeMinor: 1500000, discountMinor: 0, startPeriod: billingPeriod(new Date().toISOString()),
  });
  const ownProfiles = await listOwnAthleteProfiles(db, parent);
  assert.equal(ownProfiles.has(own), true);
  assert.equal(ownProfiles.get(own)?.school, "Colegio");
  assert.equal(ownProfiles.get(own)?.nationalId, null);
  assert.equal(ownProfiles.has(foreign), false);
  const all = await listAthleteProfiles(db);
  assert.equal(all.has(foreign), true);
  assert.equal(all.get(own)?.nationalId, "102340567");
  await revokeGuardian(db, admin, { userId: parent.id, athleteId: own });
  assert.equal((await listOwnAthleteProfiles(db, parent)).has(own), false);
});

const portalEnv = {
  PORTAL_ENABLED: "true",
  WORKOS_API_KEY: "sk_SYNTHETIC_ONLY",
  WORKOS_CLIENT_ID: "client_synthetic",
  WORKOS_COOKIE_PASSWORD: "SYNTHETIC_LOCAL_COOKIE_PASSWORD_NOT_A_SECRET",
  WORKOS_REDIRECT_URI: "https://portal.example.invalid/auth/callback",
  WORKOS_ORGANIZATION_ID: "org_synthetic_staff",
  ADMIN_USER_IDS: "user_synthetic_staff",
};

function familyPage(actor: Actor, path: string, method = "GET") {
  const url = new URL(path, "https://portal.example.invalid");
  return {
    locals: {
      auth: {
        user: { id: actor.id, email: actor.email, emailVerified: true, firstName: actor.name, lastName: "Prueba" },
        sessionId: "synthetic-verified-session",
        accessToken: "synthetic-SDK-verified-token",
        organizationId: undefined,
        impersonator: null,
      },
    },
    url,
    request: new Request(url, { method }),
  } as unknown as APIContext;
}

test("until the first athlete exists, every other family page returns to enrollment", async () => {
  const { db } = await setup();
  const env = { ...portalEnv, DB: db } as Cloudflare.Env;
  for (const path of ["/portal", "/portal/pagos/nuevo", "/portal/eventos"]) {
    const blocked = await authorizePortal(familyPage(parent, path), env);
    assert.equal(blocked.ok, false, path);
    if (!blocked.ok) {
      assert.equal(blocked.response.status, 302);
      assert.equal(blocked.response.headers.get("Location"), "/portal/inscribir");
    }
  }
  for (const path of ["/portal/inscribir", "/portal/invitacion", "/portal/acceso"]) {
    assert.equal((await authorizePortal(familyPage(parent, path), env)).ok, true, path);
  }
  assert.equal((await authorizePortal(familyPage(parent, "/portal/pagos/nuevo", "POST"), env)).ok, true);
  assert.equal((await authorizePortal(familyPage(stranger, "/portal"), env)).ok, true);
  await registerAthletes(db, parent, [
    { name: "Primero", birthDate: birthForAge(10), school: "Escuela", category: "Cadetes" },
  ]);
  assert.equal((await authorizePortal(familyPage(parent, "/portal"), env)).ok, true);
});
