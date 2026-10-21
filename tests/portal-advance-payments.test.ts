import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  advanceQuote,
  applyPaymentCredit,
  assertSubmissionAccess,
  billingPeriod,
  ensureUser,
  familyMonthlyRates,
  getFeeSchedule,
  getMonthlyPreview,
  getParentDashboard,
  getReceipt,
  listFamilyMoney,
  publishCurrentMonth,
  publishMonth,
  reviewPayment,
  revisePayment,
  seedDemo,
  settleCredit,
  submitPayment,
  updateFeeSchedule,
} from "../src/lib/portal/domain";
import { addMonths } from "../src/lib/portal/advance";
import { InputError, parseAdvanceMonths } from "../src/lib/portal/http";
import { PortalError } from "../src/lib/portal/types";
import type {
  Actor,
  RequestedAllocation,
  SubmitPaymentInput,
  VerifyPaymentInput,
  PaymentReviewSnapshot,
} from "../src/lib/portal/types";

/** The adapter executes real SQLite constraints and the same atomic batch as D1. */
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  beforeBatch?: () => unknown;
  queries = 0;
  constructor() {
    this.sqlite.exec(
      readFileSync(
        new URL("../migrations/0002_portal.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(readFileSync(new URL("../migrations/0004_financial_operations.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0006_self_registration.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0007_fee_schedule.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0011_athlete_approval.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) {
    this.queries++;
    const database = this;
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        values = args;
        return statement;
      },
      async all() {
        return {
          results: database.sqlite.prepare(sql).all(...(values as never[])),
          success: true,
          meta: { changes: 0 },
        };
      },
      async first(column?: string) {
        const row = database.sqlite.prepare(sql).get(...(values as never[])) as
          | Record<string, unknown>
          | undefined;
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      async run() {
        return statement.execute();
      },
      execute() {
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
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
const admin: Actor = {
  id: "demo-admin",
  email: "admin@example.invalid",
  name: "Administración de prueba",
  isAdmin: true,
  mode: "demo",
};
const parent: Actor = {
  id: "demo-parent-a",
  email: "ana@example.invalid",
  name: "Ana de prueba",
  isAdmin: false,
  mode: "demo",
};
const outsider: Actor = {
  id: "demo-unrelated",
  email: "otra@example.invalid",
  name: "Familia independiente",
  isAdmin: false,
  mode: "demo",
};
async function setup() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  await seedDemo(db);
  return {
    adapter,
    db,
    charges: (await getParentDashboard(db, parent)).charges,
  };
}
function input(
  allocations: RequestedAllocation[],
  amountMinor = allocations.reduce((s, a) => s + a.amountMinor, 0),
): SubmitPaymentInput {
  return {
    submissionId: crypto.randomUUID(),
    payerName: "Persona de prueba",
    amountMinor,
    transferDate: "2026-10-10",
    bankReference: "000020261010283002453950810",
    allocations,
    file: {
      key: `portal/${crypto.randomUUID()}.png`,
      type: "image/png",
      size: 100,
      sha256: "a".repeat(64),
    },
  };
}
function verification(
  data: SubmitPaymentInput,
  reference = data.bankReference,
  expectedRevision = 1,
): VerifyPaymentInput & PaymentReviewSnapshot {
  return {
    action: "verify",
    expectedRevision,
    expectedStatus: "pending", expectedReviewNote: null,
    bankChecked: true,
    associationName: "Asociación de prueba",
    bankName: "Banco de prueba",
    receivingAccount: "CR-TEST-00001",
    bankReference: reference,
    amountMinor: data.amountMinor,
    paymentDate: data.transferDate,
    currency: "CRC",
    allocations: data.allocations,
    ...(reference !== data.bankReference
      ? { note: "Referencia contrastada con el banco." }
      : {}),
  };
}

const requestedCount = (adapter: SQLiteD1, paymentId: string) =>
  (adapter.sqlite.prepare("SELECT count(*) n FROM payment_requested_allocations WHERE payment_id=?").get(paymentId) as { n: number }).n;

test("an advance needs the explicit flag", async () => {
  const { db, adapter } = await setup();
  const refused = (error: unknown) =>
    error instanceof PortalError && error.status === 400 && error.message === "Seleccione las mensualidades.";
  await assert.rejects(() => submitPayment(db, parent, input([], 4500000)), refused);
  await assert.rejects(() => submitPayment(db, parent, { ...input([], 4500000), advance: false }), refused);
  const paymentId = await submitPayment(db, parent, { ...input([], 4500000), advance: true });
  assert.equal(requestedCount(adapter, paymentId), 0);
});

test("verifying an advance with no months keeps the whole amount as credit", async () => {
  const { db } = await setup();
  const data = { ...input([], 4500000), advance: true };
  const paymentId = await submitPayment(db, parent, data);
  const receiptId = await reviewPayment(db, admin, paymentId, { ...verification(data), allocations: [] });
  const receipt = await getReceipt(db, parent, receiptId!);
  assert.deepEqual(receipt.snapshot.lines, []);
  assert.equal(receipt.snapshot.unallocatedMinor, 4500000);
  assert.equal((await getParentDashboard(db, parent)).creditMinor, 4500000);
});

test("a payment that named months cannot be verified with none", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await assert.rejects(
    () => reviewPayment(db, admin, paymentId, { ...verification(data), allocations: [] }),
    (error: unknown) => error instanceof PortalError && error.status === 400,
  );
});

test("an advance in needs_info can be corrected without months", async () => {
  const { db, adapter } = await setup();
  const paymentId = await submitPayment(db, parent, { ...input([], 4500000), advance: true });
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
    reason: "Confirmar referencia.",
  });
  await revisePayment(db, parent, paymentId, {
    ...input([], 4500000),
    expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: "Confirmar referencia.",
    note: "Referencia corregida.",
  });
  const payment = adapter.sqlite.prepare("SELECT status, revision FROM payments WHERE id=?").get(paymentId) as { status: string; revision: number };
  assert.deepEqual({ ...payment }, { status: "pending", revision: 2 });
});

test("parseAdvanceMonths accepts only whole months from 0 to 12", () => {
  const form = (value?: string) => { const data = new FormData(); if (value !== undefined) data.set("advanceMonths", value); return data; };
  assert.equal(parseAdvanceMonths(form()), 0);
  assert.equal(parseAdvanceMonths(form("")), 0);
  assert.equal(parseAdvanceMonths(form("3")), 3);
  assert.equal(parseAdvanceMonths(form("12")), 12);
  for (const bad of ["13", "-1", "2.5", "abc"]) assert.throws(() => parseAdvanceMonths(form(bad)), InputError);
});

// ---- Credit settles itself (Task 2) ----
const periodNow = billingPeriod(new Date().toISOString());
const nextPeriodOf = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};
const periodNext = nextPeriodOf(periodNow);
const instantNext = `${periodNext}-01T06:00:00.000Z`;

async function verifiedAdvance(db: D1Database, who: Actor, amountMinor: number): Promise<string> {
  const data = { ...input([], amountMinor), advance: true, bankReference: `REF-${crypto.randomUUID()}` };
  const paymentId = await submitPayment(db, who, data);
  await reviewPayment(db, admin, paymentId, { ...verification(data), allocations: [] });
  return paymentId;
}
const allocationRows = (adapter: SQLiteD1) =>
  adapter.sqlite.prepare(
    "SELECT c.period, s.name AS athlete, a.amount_minor AS amountMinor, a.payment_id AS paymentId, s.id AS athleteId FROM payment_allocations a JOIN charges c ON c.id=a.charge_id JOIN athletes s ON s.id=c.athlete_id ORDER BY a.rowid",
  ).all() as Array<{ period: string; athlete: string; amountMinor: number; paymentId: string; athleteId: string }>;
/**
 * Parent A (two siblings) has paid exactly two months ahead; this and next month are published but
 * nothing is settled yet. Next month is published first, because publishing settles on its own.
 */
async function twoMonthsPaidAhead() {
  const context = await setup();
  const monthTotal = context.charges.reduce((sum, charge) => sum + charge.totalMinor, 0);
  await publishCurrentMonth(context.db, instantNext);
  const paymentId = await verifiedAdvance(context.db, parent, monthTotal * 2);
  return { ...context, monthTotal, paymentId };
}

test("credit settles into published charges oldest month first, siblings by name", async () => {
  const { db, adapter } = await twoMonthsPaidAhead();
  assert.equal(await settleCredit(db, instantNext), 4);
  assert.deepEqual(allocationRows(adapter).map((row) => [row.period, row.athlete]), [
    [periodNow, "Sofía de prueba"], [periodNow, "Timothy de prueba"],
    [periodNext, "Sofía de prueba"], [periodNext, "Timothy de prueba"],
  ]);
  const dashboard = await getParentDashboard(db, parent);
  assert.equal(dashboard.creditMinor, 0);
  assert.ok(dashboard.charges.every((charge) => charge.balanceMinor === 0));
  const audits = adapter.sqlite.prepare("SELECT actor_id AS actor, count(*) AS n FROM audit_events WHERE action='auto_apply_credit' GROUP BY actor_id").all();
  assert.deepEqual(audits.map((row) => ({ ...row })), [{ actor: "system:monthly-publish", n: 1 }]);
});

test("settling twice allocates nothing the second time", async () => {
  const { db, adapter } = await twoMonthsPaidAhead();
  await settleCredit(db, instantNext);
  const before = allocationRows(adapter).length;
  assert.equal(await settleCredit(db, instantNext), 0);
  assert.equal(allocationRows(adapter).length, before);
});

test("a competing manual application cannot be over-allocated", async () => {
  const { db, adapter, paymentId, charges, monthTotal } = await twoMonthsPaidAhead();
  const sofia = charges.find((charge) => charge.athleteName === "Sofía de prueba")!;
  adapter.beforeBatch = async () => {
    await applyPaymentCredit(db, admin, {
      operationId: crypto.randomUUID(), paymentId,
      allocations: [{ chargeId: sofia.id, amountMinor: sofia.totalMinor }], reason: "Aplicación manual.",
    });
  };
  assert.equal(await settleCredit(db, instantNext), 3);
  const overCharged = adapter.sqlite.prepare(
    "SELECT count(*) AS n FROM charges c WHERE COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE charge_id=c.id),0) > c.base_minor-c.discount_minor",
  ).get() as { n: number };
  assert.equal(overCharged.n, 0);
  const allocated = allocationRows(adapter).reduce((sum, row) => sum + row.amountMinor, 0);
  assert.equal(allocated, monthTotal * 2);
});

test("a voided payment does not settle", async () => {
  const { db, paymentId } = await twoMonthsPaidAhead();
  await reviewPayment(db, admin, paymentId, {
    action: "void", expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null, reason: "Depósito devuelto.",
  });
  assert.equal(await settleCredit(db, instantNext), 0);
});

test("voiding after settling returns the charges to unpaid", async () => {
  const { db, paymentId, monthTotal } = await twoMonthsPaidAhead();
  await settleCredit(db, instantNext);
  assert.equal((await getParentDashboard(db, parent)).balanceMinor, 0);
  await reviewPayment(db, admin, paymentId, {
    action: "void", expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null, reason: "Depósito devuelto.",
  });
  assert.equal((await getParentDashboard(db, parent)).balanceMinor, monthTotal * 2);
});

test("publishing a month settles credit up to the current month only", async () => {
  const context = await setup();
  const monthTotal = context.charges.reduce((sum, charge) => sum + charge.totalMinor, 0);
  await verifiedAdvance(context.db, parent, monthTotal * 2);
  await publishMonth(context.db, admin, periodNext, (await getMonthlyPreview(context.db, periodNext)).snapshot);
  assert.deepEqual(allocationRows(context.adapter).map((row) => row.period), [periodNow, periodNow]);
  assert.equal(await settleCredit(context.db, `${periodNow}-15T18:00:00.000Z`), 0);
});

test("a fee increase leaves the difference owed", async () => {
  const { db } = await setup();
  await verifiedAdvance(db, outsider, 2_400_000);
  assert.equal(await settleCredit(db, new Date().toISOString()), 1);
  await updateFeeSchedule(db, admin, { ...(await getFeeSchedule(db)), "Iniciación": 1_300_000 });
  await publishCurrentMonth(db, instantNext);
  assert.equal(await settleCredit(db, instantNext), 1);
  const next = (await getParentDashboard(db, outsider)).charges.find((charge) => charge.period === periodNext)!;
  assert.equal(next.totalMinor, 1_300_000);
  assert.equal(next.balanceMinor, 100_000);
});

test("credit never crosses families", async () => {
  const { db, adapter } = await setup();
  const mine = await verifiedAdvance(db, parent, 1_000_000);
  const theirs = await verifiedAdvance(db, outsider, 500_000);
  assert.equal(await settleCredit(db, new Date().toISOString()), 2);
  // Two payments verified in the same millisecond settle in either order; only who got what matters.
  const rows = allocationRows(adapter).map((row) => ({ payment: row.paymentId, athlete: row.athleteId, amount: row.amountMinor }))
    .sort((a, b) => a.athlete.localeCompare(b.athlete));
  assert.deepEqual(rows, [
    { payment: mine, athlete: "demo-athlete-2", amount: 1_000_000 },
    { payment: theirs, athlete: "demo-athlete-3", amount: 500_000 },
  ]);
});

// ---- Rates, coverage and family money (Task 3) ----
test("a family's monthly rate is what publishing would charge, sibling discount included", async () => {
  const { db } = await setup();
  const rates = await familyMonthlyRates(db, periodNext);
  assert.equal(rates.get("demo-parent-a"), 900_000 + 1_125_000);
  assert.equal(rates.get("demo-parent-b"), 900_000, "a shared athlete counts for every active guardian");
  assert.equal(rates.get("demo-unrelated"), 1_200_000);
  assert.equal(rates.has("demo-admin"), false);
});

test("paused, withdrawn and not-yet-started athletes are not in the rate", async () => {
  const { db, adapter } = await setup();
  adapter.sqlite.prepare("UPDATE athletes SET paused=1 WHERE id='demo-athlete-2'").run();
  adapter.sqlite.prepare("UPDATE athletes SET start_period='2099-01' WHERE id='demo-athlete-3'").run();
  const rates = await familyMonthlyRates(db, periodNext);
  assert.equal(rates.get("demo-parent-a"), 900_000, "the paused sibling still counts for the family discount");
  assert.equal(rates.has("demo-unrelated"), false);
});

test("a family with nothing billable has rate 0 and covers no months", async () => {
  const { db, adapter } = await setup();
  adapter.sqlite.prepare("UPDATE athletes SET active=0 WHERE id='demo-athlete-1'").run();
  adapter.sqlite.prepare("UPDATE athletes SET paused=1 WHERE id='demo-athlete-2'").run();
  const quote = await advanceQuote(db, "demo-parent-a", 5_000_000, `${periodNow}-15T18:00:00.000Z`);
  assert.deepEqual(quote, { monthlyRateMinor: 0, months: 0, throughPeriod: null, leftoverMinor: 5_000_000 });
});

test("the quote covers whole months starting next month", async () => {
  const { db } = await setup();
  const quote = await advanceQuote(db, "demo-parent-a", 4_050_000 + 100_000, `${periodNow}-15T18:00:00.000Z`);
  assert.deepEqual(quote, { monthlyRateMinor: 2_025_000, months: 2, throughPeriod: addMonths(periodNext, 1), leftoverMinor: 100_000 });
});

test("family money matches each account's own dashboard", async () => {
  const { db } = await setup();
  await verifiedAdvance(db, parent, 1_000_000);
  await verifiedAdvance(db, outsider, 500_000);
  const money = await listFamilyMoney(db);
  for (const who of [parent, outsider]) {
    const dashboard = await getParentDashboard(db, who);
    assert.deepEqual(money.get(who.id), { balanceMinor: dashboard.balanceMinor, creditMinor: dashboard.creditMinor }, who.id);
  }
});

// ---- Final review fixes ----
test("credit with nothing to settle costs a fixed handful of queries, however many payments hold it", async () => {
  const { db, adapter } = await setup();
  const [alex] = (await getParentDashboard(db, outsider)).charges;
  const data = { ...input([{ chargeId: alex.id, amountMinor: alex.totalMinor }]), bankReference: `REF-${crypto.randomUUID()}` };
  const paid = await submitPayment(db, outsider, data);
  await reviewPayment(db, admin, paid, verification(data));
  for (let i = 0; i < 10; i++) await verifiedAdvance(db, outsider, 100_000);
  const before = adapter.queries;
  assert.equal(await settleCredit(db, new Date().toISOString()), 0);
  assert.ok(adapter.queries - before <= 3, `used ${adapter.queries - before} queries`);
});

test("one run settles at most the per-run limit of payments and the next run continues", async () => {
  const { db, adapter } = await setup();
  await publishCurrentMonth(db, instantNext);
  for (let i = 0; i < 3; i++) await verifiedAdvance(db, parent, 1_000_000);
  await settleCredit(db, instantNext, 2);
  assert.equal(new Set(allocationRows(adapter).map((row) => row.paymentId)).size, 2);
  await settleCredit(db, instantNext, 2);
  const rows = allocationRows(adapter);
  assert.equal(new Set(rows.map((row) => row.paymentId)).size, 3);
  assert.equal(rows.reduce((sum, row) => sum + row.amountMinor, 0), 3_000_000);
});

test("settling leaves alone the months a pending payment already asked for", async () => {
  const { db, adapter, charges } = await setup();
  const sofia = charges.find((charge) => charge.athleteName === "Sofía de prueba")!;
  await verifiedAdvance(db, parent, 3_000_000);
  const pending = input([{ chargeId: sofia.id, amountMinor: sofia.totalMinor }]);
  const pendingId = await submitPayment(db, parent, pending);
  await settleCredit(db, new Date().toISOString());
  assert.deepEqual(allocationRows(adapter).map((row) => row.athlete), ["Timothy de prueba"]);
  await reviewPayment(db, admin, pendingId, verification(pending));
});

test("a partial request reserves only the amount asked", async () => {
  const { db, adapter, charges } = await setup();
  const sofia = charges.find((charge) => charge.athleteName === "Sofía de prueba")!;
  await verifiedAdvance(db, parent, 3_000_000);
  await submitPayment(db, parent, input([{ chargeId: sofia.id, amountMinor: 100_000 }]));
  await settleCredit(db, new Date().toISOString());
  const toSofia = allocationRows(adapter).filter((row) => row.athlete === "Sofía de prueba").reduce((sum, row) => sum + row.amountMinor, 0);
  assert.equal(toSofia, sofia.totalMinor - 100_000);
});

test("an advance needs an account that has an athlete", async () => {
  const { db } = await setup();
  const lone: Actor = { id: "demo-no-athletes", email: "sin-atletas@example.invalid", name: "Sin atletas", isAdmin: false, mode: "demo" };
  await ensureUser(db, lone);
  const data = { ...input([], 1_000_000), advance: true };
  const forbidden = (error: unknown) => error instanceof PortalError && error.status === 403;
  await assert.rejects(() => assertSubmissionAccess(db, lone, data), forbidden);
  await assert.rejects(() => submitPayment(db, lone, data), forbidden);
});
