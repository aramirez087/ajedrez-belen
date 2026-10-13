import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  adjustCharge,
  athleteFeeSnapshot,
  applyPaymentCredit,
  billingPeriod,
  billingYear,
  createInvitation,
  enrollAthlete,
  ensureUser,
  getAdminDashboard,
  getMonthlyPreview,
  getParentDashboard,
  getPaymentDetail,
  getPaymentFile,
  getReceipt,
  linkGuardian,
  publishMonth,
  redeemInvitation,
  reviewPayment,
  revokeGuardian,
  revisePayment,
  seedDemo,
  setAthleteFee,
  setReceiptConsent,
  submitPayment,
} from "../src/lib/portal/domain";
import { renderReceipt } from "../src/lib/portal/receipt";
import { prepareReceiptEmail } from "../src/lib/portal/email";
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
  constructor() {
    this.sqlite.exec(
      readFileSync(
        new URL("../migrations/0002_portal.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(readFileSync(new URL("../migrations/0004_financial_operations.sql", import.meta.url), "utf8"));
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
const second: Actor = {
  id: "demo-parent-b",
  email: "diego@example.invalid",
  name: "Diego de prueba",
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
test("bank confirmation requires an explicit valid receipt identity before any financial or evidence mutation", async (t) => {
  const cases: Array<[string, unknown]> = [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
    ["control character", "Asociación\nno válida"],
    ["oversize", "A".repeat(201)],
  ];
  for (const [label, associationName] of cases) await t.test(label, async () => {
    const { db, adapter, charges } = await setup();
    const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
    const paymentId = await submitPayment(db, parent, data);
    const tables = [
      "charges", "charge_adjustments", "payments", "payment_revisions",
      "payment_files", "payment_requested_allocations", "payment_allocations",
      "receipt_counters", "receipts", "email_outbox", "portal_email_daily_budget",
      "audit_events", "financial_operations",
    ];
    const snapshot = () => Object.fromEntries(tables.map(table => [
      table, adapter.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]));
    const before = snapshot();
    const invalid: Omit<VerifyPaymentInput & PaymentReviewSnapshot, "associationName"> & { associationName?: unknown } = { ...verification(data), associationName };
    if (label === "missing") delete invalid.associationName;
    await assert.rejects(
      reviewPayment(db, admin, paymentId, invalid as VerifyPaymentInput & PaymentReviewSnapshot),
      { status: 400, code: "invalid_request" },
    );
    assert.deepEqual(snapshot(), before, "Invalid identity must not change money, evidence, receipt sequence, email or audit records");
  });
});

test("an explicit receipt identity is frozen and remains readable after a later void", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  const approval = { ...verification(data), associationName: "  Asociación sintética aprobada  " };
  const receiptId = await reviewPayment(db, admin, paymentId, approval);
  const issued = await getReceipt(db, parent, receiptId!);
  assert.equal(issued.snapshot.associationName, "Asociación sintética aprobada");
  approval.associationName = "Una configuración posterior";
  assert.equal((await getReceipt(db, parent, receiptId!)).snapshot.associationName, issued.snapshot.associationName);
  assert.ok(renderReceipt(issued.snapshot).text.includes("Asociación sintética aprobada"));
  await reviewPayment(db, admin, paymentId, {
    action: "void", reason: "Anulación sintética sin nueva identidad de recibo.",
    expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null,
  });
  const voided = await getReceipt(db, parent, receiptId!);
  assert.equal(voided.status, "void");
  assert.deepEqual(voided.snapshot, issued.snapshot);
});

test("a blocked confirmation still allows requesting a correction and rejecting the corrected proof", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await assert.rejects(
    reviewPayment(db, admin, paymentId, { ...verification(data), associationName: "" }),
    { status: 400, code: "invalid_request" },
  );
  const reason = "Aclarar la referencia del comprobante.";
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info", reason,
    expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
  });
  await revisePayment(db, parent, paymentId, {
    ...input(data.allocations), bankReference: "REF-CORREGIDA-SINTETICA", note: "Referencia corregida.",
    expectedRevision: 1, expectedStatus: "needs_info", expectedReviewNote: reason,
  });
  await reviewPayment(db, admin, paymentId, {
    action: "reject", reason: "Respaldo sintético rechazado.",
    expectedRevision: 2, expectedStatus: "pending", expectedReviewNote: null,
  });
  assert.equal((await getPaymentDetail(db, parent, paymentId)).payment.status, "rejected");
  assert.equal((await getParentDashboard(db, parent)).charges.find(c => c.id === charges[0].id)!.paidMinor, 0);
});
test("monthly publication is idempotent, due on eighth and snapshots manual discounts", async () => {
  const { db, charges } = await setup();
  const preview = await getMonthlyPreview(db, charges[0].period);
  assert.equal(preview.newCount, 0);
  assert.equal(preview.dueDate, `${charges[0].period}-08`);
  const reviewed = await getMonthlyPreview(db, "2027-01");
  const results = await Promise.all([
    publishMonth(db, admin, "2027-01", reviewed.snapshot),
    publishMonth(db, admin, "2027-01", reviewed.snapshot),
  ]);
  assert.deepEqual(results.sort(), [0, 3]);
  assert.equal((await getMonthlyPreview(db, "2027-01")).newCount, 0);
});

test("a stale athlete form cannot reactivate an athlete or replace a newer fee and discount", async () => {
  const { db, adapter } = await setup();
  const athlete = (await getAdminDashboard(db)).athletes[0];
  const original = { ...athlete, discountReason: athlete.discountReason ?? undefined };
  const expected = athleteFeeSnapshot(athlete);
  await setAthleteFee(db, admin, athlete.id, {
    ...original, active: false, feeMinor: 1500000, discountMinor: 10000, discountReason: "Descuento revisado",
  }, expected);
  await assert.rejects(setAthleteFee(db, admin, athlete.id, { ...original, name: "Nombre desde pestaña anterior" }, expected),
    (error: unknown) => (error as { code: string }).code === "conflict");
  const saved = (await getAdminDashboard(db)).athletes.find(a => a.id === athlete.id)!;
  assert.equal(saved.active, false);
  assert.equal(saved.feeMinor, 1500000);
  assert.equal(saved.discountMinor, 10000);
  assert.equal(saved.name, athlete.name);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='update'").get(athlete.id)!.n, 1);
});

test("competing fee edits use an atomic snapshot comparison and only the winner is audited", async () => {
  const { db, adapter } = await setup();
  const athlete = (await getAdminDashboard(db)).athletes[0];
  const original = { ...athlete, discountReason: athlete.discountReason ?? undefined };
  const expected = athleteFeeSnapshot(athlete);
  const results = await Promise.allSettled([
    setAthleteFee(db, admin, athlete.id, { ...original, active: false }, expected),
    setAthleteFee(db, admin, athlete.id, { ...original, name: "Otra edición" }, expected),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "conflict").length, 1);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='update'").get(athlete.id)!.n, 1);
});

test("a fee change during processing cannot be overwritten and an aborted update leaves no audit", async () => {
  const { db, adapter } = await setup();
  const athlete = (await getAdminDashboard(db)).athletes[0];
  const input = { ...athlete, name: "Cambio revisado", discountReason: athlete.discountReason ?? undefined };
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE athletes SET active=0 WHERE id=?").run(athlete.id);
  await assert.rejects(setAthleteFee(db, admin, athlete.id, input, athleteFeeSnapshot(athlete)),
    (error: unknown) => (error as { code: string }).code === "conflict");
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='update'").get(athlete.id)!.n, 0);
  const fresh = (await getAdminDashboard(db)).athletes.find(a => a.id === athlete.id)!;
  adapter.sqlite.exec("CREATE TRIGGER fail_fee_update BEFORE UPDATE ON athletes BEGIN SELECT RAISE(ABORT,'synthetic_update_failure'); END;");
  await assert.rejects(setAthleteFee(db, admin, athlete.id, input, athleteFeeSnapshot(fresh)), /synthetic_update_failure/);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='update'").get(athlete.id)!.n, 0);
  assert.equal(adapter.sqlite.prepare("SELECT name FROM athletes WHERE id=?").get(athlete.id)!.name, athlete.name);
});

test("fee and month mutations require the displayed snapshot, including for administrators", async () => {
  const { db } = await setup();
  const athlete = (await getAdminDashboard(db)).athletes[0];
  const input = { ...athlete, discountReason: athlete.discountReason ?? undefined };
  await assert.rejects(setAthleteFee(db, admin, athlete.id, input, undefined as unknown as string));
  await assert.rejects(setAthleteFee(db, admin, athlete.id, input, "[]"),
    (error: unknown) => (error as { code: string }).code === "conflict");
  await assert.rejects(publishMonth(db, admin, "2027-02", undefined as unknown as string),
    (error: unknown) => (error as { code: string }).code === "invalid_fields");
  await assert.rejects(publishMonth(db, admin, "2027-02", "0".repeat(64)),
    (error: unknown) => (error as { code: string }).code === "conflict");
});

test("a monthly preview becomes stale when fees, discounts, eligibility or its roster change", async () => {
  for (const change of ["fee", "discount", "active", "start", "enroll"] as const) {
    const { db, adapter } = await setup();
    const period = "2027-02";
    const preview = await getMonthlyPreview(db, period);
    const athlete = preview.athletes[0];
    const input = { ...athlete, discountReason: athlete.discountReason ?? undefined };
    if (change === "enroll") await enrollAthlete(db, admin, { ...input, name: "Inscripción nueva" });
    else await setAthleteFee(db, admin, athlete.id, {
      ...input,
      ...(change === "fee" ? { feeMinor: athlete.feeMinor === 1200000 ? 1500000 : 1200000 } : {}),
      ...(change === "discount" ? { discountMinor: 10000, discountReason: "Descuento aprobado" } : {}),
      ...(change === "active" ? { active: false } : {}),
      ...(change === "start" ? { startPeriod: "2027-03" } : {}),
    }, athleteFeeSnapshot(athlete));
    await assert.rejects(publishMonth(db, admin, period, preview.snapshot),
      (error: unknown) => (error as { code: string }).code === "conflict", change);
    assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM charges WHERE period=?").get(period)!.n, 0, change);
    assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_type='month' AND entity_id=?").get(period)!.n, 0, change);
    const fresh = await getMonthlyPreview(db, period);
    assert.equal(await publishMonth(db, admin, period, fresh.snapshot), fresh.newCount);
    assert.equal(adapter.sqlite.prepare("SELECT sum(base_minor-discount_minor) total FROM charges WHERE period=?").get(period)!.total, fresh.totalMinor);
  }
});

test("monthly publication rechecks its roster inside the transaction after preflight", async () => {
  const { db, adapter } = await setup();
  const period = "2027-02";
  const preview = await getMonthlyPreview(db, period);
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE athletes SET active=0 WHERE id=?").run(preview.athletes[0].id);
  await assert.rejects(publishMonth(db, admin, period, preview.snapshot),
    (error: unknown) => (error as { code: string }).code === "conflict");
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM charges WHERE period=?").get(period)!.n, 0);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_type='month' AND entity_id=?").get(period)!.n, 0);
});

test("failed monthly insertion rolls back the snapshot claim and retry publishes exactly once", async () => {
  const { db, adapter } = await setup();
  const period = "2027-02";
  const preview = await getMonthlyPreview(db, period);
  adapter.sqlite.exec("CREATE TRIGGER fail_month BEFORE INSERT ON charges BEGIN SELECT RAISE(ABORT,'synthetic_month_failure'); END;");
  await assert.rejects(publishMonth(db, admin, period, preview.snapshot), /synthetic_month_failure/);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM charges WHERE period=?").get(period)!.n, 0);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE entity_type='month' AND entity_id=?").get(period)!.n, 0);
  adapter.sqlite.exec("DROP TRIGGER fail_month");
  assert.equal(await publishMonth(db, admin, period, preview.snapshot), preview.newCount);
  assert.equal(await publishMonth(db, admin, period, preview.snapshot), 0);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) n FROM charges WHERE period=?").get(period)!.n, preview.newCount);
});

test("monthly publication recovers a lost committed response without duplicate charges", async () => {
  const { db, adapter } = await setup();
  const period = "2027-02";
  const preview = await getMonthlyPreview(db, period);
  const originalBatch = adapter.batch.bind(adapter);
  let interrupted = true;
  adapter.batch = async statements => {
    const result = await originalBatch(statements);
    if (interrupted) { interrupted = false; throw new Error("synthetic_lost_response"); }
    return result;
  };
  await assert.rejects(publishMonth(db, admin, period, preview.snapshot), /synthetic_lost_response/);
  const initial = adapter.sqlite.prepare("SELECT id FROM charges WHERE period=? ORDER BY id").all(period);
  assert.equal(initial.length, preview.newCount);
  assert.equal(await publishMonth(db, admin, period, preview.snapshot), 0);
  assert.deepEqual(adapter.sqlite.prepare("SELECT id FROM charges WHERE period=? ORDER BY id").all(period), initial);
});

test("Unicode profile values and an empty roster have stable, compact publication snapshots", async () => {
  const { db, adapter } = await setup();
  const athlete = (await getAdminDashboard(db)).athletes[0];
  await setAthleteFee(db, admin, athlete.id, { ...athlete, name: 'María “Prueba” \\ / ♞',
    discountReason: 'Acuerdo: "prueba" / familiar', discountMinor: 10000 }, athleteFeeSnapshot(athlete));
  const reviewed = await getMonthlyPreview(db, "2027-02");
  assert.match(reviewed.snapshot, /^[a-f0-9]{64}$/);
  assert.equal(await publishMonth(db, admin, "2027-02", reviewed.snapshot), reviewed.newCount);
  assert.equal((await getMonthlyPreview(db, "2027-02")).snapshot, reviewed.snapshot);
  adapter.sqlite.exec("UPDATE athletes SET active=0");
  const empty = await getMonthlyPreview(db, "2027-03");
  assert.equal(empty.newCount, 0);
  assert.equal(await publishMonth(db, admin, "2027-03", empty.snapshot), 0);
});
test("billing and receipt sequence year change at Costa Rica midnight", () => {
  assert.equal(billingYear("2027-01-01T05:59:59.000Z"), 2026);
  assert.equal(billingYear("2027-01-01T06:00:00.000Z"), 2027);
  assert.equal(billingPeriod("2026-11-01T05:59:59.000Z"), "2026-10");
  assert.equal(billingPeriod("2026-11-01T06:00:00.000Z"), "2026-11");
});
test("pending submission never reduces balances and unrelated charges are denied", async () => {
  const { db, charges } = await setup();
  const original = (await getParentDashboard(db, parent)).balanceMinor;
  const data = input([{ chargeId: charges[0].id, amountMinor: 300000 }]);
  await submitPayment(db, parent, data);
  const dashboard = await getParentDashboard(db, parent);
  assert.equal(dashboard.balanceMinor, original);
  assert.equal(dashboard.pendingMinor, 300000);
  await assert.rejects(
    submitPayment(db, outsider, { ...data, submissionId: crypto.randomUUID() }),
    (e) => (e as { status: number }).status === 403,
  );
});
test("two guardians share child balances but sibling receipt and raw evidence stay private", async () => {
  const { db, charges } = await setup();
  const data = input(
    charges.map((c) => ({ chargeId: c.id, amountMinor: 100000 })),
  );
  const paymentId = await submitPayment(db, parent, data);
  const receiptId = await reviewPayment(
    db,
    admin,
    paymentId,
    verification(data),
  );
  const detail = await getPaymentDetail(db, parent, paymentId);
  assert.equal(detail.files.length, 1);
  await assert.rejects(
    getPaymentFile(db, second, detail.files[0].id),
    (e) => (e as { status: number }).status === 404,
  );
  await assert.rejects(
    getReceipt(db, second, receiptId!),
    (e) => (e as { status: number }).status === 404,
  );
  const dashboard = await getParentDashboard(db, second);
  assert.equal(dashboard.charges.length, 1);
  assert.equal(dashboard.charges[0].paidMinor, 100000);
  assert.equal(dashboard.payments.length, 0);
  assert.equal(dashboard.receipts.length, 0);
});
test("partial approval and overpayment credit create one immutable numbered receipt and durable mail", async () => {
  const { db, adapter, charges } = await setup();
  const data = input(
    [{ chargeId: charges[0].id, amountMinor: 200000 }],
    300000,
  );
  const paymentId = await submitPayment(db, parent, data);
  const receiptId = await reviewPayment(
    db,
    admin,
    paymentId,
    verification(data),
  );
  const receipt = await getReceipt(db, parent, receiptId!);
  assert.match(receipt.number, /^AB-\d{4}-000001$/);
  assert.equal(receipt.snapshot.bankReference, data.bankReference);
  assert.equal(receipt.snapshot.unallocatedMinor, 100000);
  assert.equal((await getParentDashboard(db, parent)).creditMinor, 100000);
  assert.equal(
    (
      adapter.sqlite.prepare("SELECT count(*) n FROM email_outbox").get() as {
        n: number;
      }
    ).n,
    1,
  );
  adapter.sqlite
    .prepare("UPDATE athletes SET name=? WHERE id=?")
    .run("Nuevo nombre", charges[0].athleteId);
  assert.notEqual(
    (await getReceipt(db, parent, receiptId!)).snapshot.lines[0].athleteName,
    "Nuevo nombre",
  );
  assert.throws(
    () =>
      adapter.sqlite
        .prepare("UPDATE receipts SET snapshot_json='{}' WHERE id=?")
        .run(receiptId!),
    /immutable_receipt/,
  );
  await applyPaymentCredit(db, admin, {
    operationId: crypto.randomUUID(),
    paymentId,
    allocations: [{ chargeId: charges[0].id, amountMinor: 100000 }],
    reason: "Aplicar saldo al mismo mes.",
  });
  assert.equal((await getParentDashboard(db, parent)).creditMinor, 0);
  assert.equal(
    (await getReceipt(db, parent, receiptId!)).snapshot.unallocatedMinor,
    100000,
  );
});
test("concurrent approval of one payment yields exactly one receipt, one sequence and one allocation", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  const results = await Promise.allSettled([
    reviewPayment(db, admin, paymentId, verification(data)),
    reviewPayment(db, admin, paymentId, verification(data)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  for (const table of ["receipts", "payment_allocations", "email_outbox"])
    assert.equal(
      (
        adapter.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as {
          n: number;
        }
      ).n,
      1,
    );
  assert.equal(
    (
      adapter.sqlite.prepare("SELECT sequence FROM receipt_counters").get() as {
        sequence: number;
      }
    ).sequence,
    1,
  );
});
test("concurrent payments cannot over-credit a charge, and failed approval rolls back all records", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([
    { chargeId: charges[0].id, amountMinor: charges[0].balanceMinor },
  ]);
  const first = await submitPayment(db, parent, data),
    otherData = { ...input(data.allocations), bankReference: "DIFFERENT" },
    other = await submitPayment(db, parent, otherData);
  const results = await Promise.allSettled([
    reviewPayment(db, admin, first, verification(data)),
    reviewPayment(db, admin, other, verification(otherData)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      adapter.sqlite.prepare("SELECT count(*) n FROM receipts").get() as {
        n: number;
      }
    ).n,
    1,
  );
  assert.equal(
    (
      adapter.sqlite
        .prepare("SELECT count(*) n FROM payments WHERE status='pending'")
        .get() as { n: number }
    ).n,
    1,
  );
  assert.equal(
    (await getParentDashboard(db, parent)).charges[0].balanceMinor,
    0,
  );
});
test("normalized bank transfer cannot be credited twice, distinct transfer sequence has no failed gap", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const first = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, first, verification(data));
  const duplicate = await submitPayment(db, parent, input(data.allocations));
  await assert.rejects(
    reviewPayment(db, admin, duplicate, verification(data)),
    (e) => (e as { status: number }).status === 409,
  );
  assert.equal(
    (
      adapter.sqlite.prepare("SELECT sequence FROM receipt_counters").get() as {
        sequence: number;
      }
    ).sequence,
    1,
  );
  const otherData = {
      ...input(data.allocations),
      bankReference: "another-transfer",
    },
    other = await submitPayment(db, parent, otherData);
  const receiptId = await reviewPayment(
    db,
    admin,
    other,
    verification(otherData),
  );
  assert.match((await getReceipt(db, parent, receiptId!)).number, /-000002$/);
});
test("needs-info corrections retain revisions and files; audited void restores charges without deleting receipt", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info",
    expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
    reason: "Confirmar referencia.",
  });
  const revised = {
    ...input(data.allocations),
    expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: "Confirmar referencia.",
    bankReference: "REVISED",
    note: "Referencia corregida.",
  };
  await revisePayment(db, parent, paymentId, revised);
  assert.equal(
    (await getPaymentDetail(db, parent, paymentId)).revisions.length,
    2,
  );
  assert.equal((await getPaymentDetail(db, parent, paymentId)).files.length, 2);
  const receiptId = await reviewPayment(
    db,
    admin,
    paymentId,
    verification(revised, revised.bankReference, 2),
  );
  await reviewPayment(db, admin, paymentId, {
    action: "void",
    expectedRevision: 2, expectedStatus: "verified", expectedReviewNote: null,
    reason: "Depósito devuelto.",
  });
  assert.equal((await getReceipt(db, parent, receiptId!)).status, "void");
  assert.equal((await getParentDashboard(db, parent)).charges[0].paidMinor, 0);
  assert.equal(
    (
      adapter.sqlite
        .prepare("SELECT count(*) n FROM payment_allocations")
        .get() as { n: number }
    ).n,
    1,
  );
  assert.equal(
    (
      adapter.sqlite
        .prepare(
          "SELECT count(*) n FROM email_outbox WHERE kind='receipt_void'",
        )
        .get() as { n: number }
    ).n,
    1,
  );
});
test("receipt email goes only to the uploader despite every guardian opt-in; revoked access stays denied", async () => {
  const { db, adapter, charges } = await setup();
  await linkGuardian(db, admin, {
    userId: second.id,
    athleteId: charges[1].athleteId,
  });
  await setReceiptConsent(db, second, {
    userId: second.id,
    athleteId: charges[0].athleteId,
    receiptOptIn: true,
  });
  await setReceiptConsent(db, second, {
    userId: second.id,
    athleteId: charges[1].athleteId,
    receiptOptIn: true,
  });
  const data = input(
      charges.map((c) => ({ chargeId: c.id, amountMinor: 100000 })),
    ),
    paymentId = await submitPayment(db, parent, data),
    receiptId = await reviewPayment(db, admin, paymentId, verification(data));
  await assert.rejects(getReceipt(db, second, receiptId!), (e) => (e as { status:number }).status === 404);
  assert.equal(
    (
      adapter.sqlite.prepare("SELECT count(*) n FROM email_outbox").get() as {
        n: number;
      }
    ).n,
    1,
  );
  const outbox = adapter.sqlite.prepare("SELECT recipient_id,recipient_email FROM email_outbox").all() as Array<{recipient_id:string;recipient_email:string}>;
  assert.deepEqual(outbox.map(row => ({...row})), [{recipient_id:parent.id,recipient_email:parent.email}]);
  await revokeGuardian(db, admin, {
    userId: second.id,
    athleteId: charges[0].athleteId,
  });
  await assert.rejects(
    getReceipt(db, second, receiptId!),
    (e) => (e as { status: number }).status === 404,
  );
});
test("invitation is bound to verified adult email and expiration, and grants all explicit athletes", async () => {
  const { db, charges } = await setup();
  const tokenHash = "b".repeat(64);
  await createInvitation(db, admin, {
    email: second.email,
    athleteIds: charges.map((c) => c.athleteId),
    tokenHash,
  });
  await assert.rejects(
    redeemInvitation(db, outsider, tokenHash),
    (e) => (e as { status: number }).status === 403,
  );
  await redeemInvitation(db, second, tokenHash);
  assert.equal((await getParentDashboard(db, second)).athletes.length, 2);
  await assert.rejects(redeemInvitation(db, second, tokenHash));
});
test("revoking one athlete invalidates the whole pending invitation; only a fresh invitation restores access", async () => {
  const { adapter, db, charges } = await setup();
  const athleteIds = charges.map(charge => charge.athleteId);
  const oldHash = "c".repeat(64), newHash = "d".repeat(64);
  const oldId = await createInvitation(db, admin, { email: second.email, athleteIds, tokenHash: oldHash });
  const otherChildId = await createInvitation(db, admin, { email: second.email, athleteIds: [athleteIds[1]], tokenHash: "c1".repeat(32) });
  const otherAdultId = await createInvitation(db, admin, { email: outsider.email, athleteIds: [athleteIds[0]], tokenHash: "c2".repeat(32) });
  const unaffected = adapter.sqlite.prepare("SELECT * FROM invitations WHERE id IN (?,?) ORDER BY id").all(otherChildId, otherAdultId);
  await revokeGuardian(db, admin, { userId: second.id, athleteId: athleteIds[0] });
  assert.deepEqual(adapter.sqlite.prepare("SELECT * FROM invitations WHERE id IN (?,?) ORDER BY id").all(otherChildId, otherAdultId), unaffected);
  const links = adapter.sqlite.prepare("SELECT * FROM guardian_links WHERE user_id=? ORDER BY athlete_id").all(second.id);
  await assert.rejects(redeemInvitation(db, second, oldHash), (error: unknown) => (error as { status: number }).status === 403);
  assert.deepEqual(adapter.sqlite.prepare("SELECT * FROM guardian_links WHERE user_id=? ORDER BY athlete_id").all(second.id), links);
  assert.equal(adapter.sqlite.prepare("SELECT redeemed_at FROM invitations WHERE id=?").get(oldId)!.redeemed_at, null);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE entity_id=? AND action='redeem'").get(oldId)!.count, 0);
  const freshId = await createInvitation(db, admin, { email: second.email, athleteIds, tokenHash: newHash });
  await redeemInvitation(db, second, newHash);
  assert.deepEqual((await getParentDashboard(db, second)).athletes.map(athlete => athlete.id).sort(), [...athleteIds].sort());
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE entity_id=? AND action='redeem'").get(freshId)!.count, 1);
});
test("guardian revocation after an invitation read wins before its atomic grant and creates no redemption audit", async () => {
  const { adapter, db, charges } = await setup();
  const tokenHash = "e".repeat(64);
  const invitationId = await createInvitation(db, admin, { email: second.email, athleteIds: charges.map(charge => charge.athleteId), tokenHash });
  adapter.beforeBatch = async () => { await revokeGuardian(db, admin, { userId: second.id, athleteId: charges[0].athleteId }); };
  await assert.rejects(redeemInvitation(db, second, tokenHash), (error: unknown) => (error as { status: number }).status === 409);
  assert.equal((await getParentDashboard(db, second)).athletes.length, 0);
  assert.equal(adapter.sqlite.prepare("SELECT redeemed_at FROM invitations WHERE id=?").get(invitationId)!.redeemed_at, null);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE entity_id=? AND action='redeem'").get(invitationId)!.count, 0);
});
test("concurrent invitation redemption grants once, audits once and never logs its token", async () => {
  const { adapter, db, charges } = await setup();
  const tokenHash = "f".repeat(64), athleteIds = charges.map(charge => charge.athleteId);
  const invitationId = await createInvitation(db, admin, { email: second.email, athleteIds, tokenHash });
  const results = await Promise.allSettled([redeemInvitation(db, second, tokenHash), redeemInvitation(db, second, tokenHash)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const audit = adapter.sqlite.prepare("SELECT actor_id,detail_json FROM audit_events WHERE entity_id=? AND action='redeem'").all(invitationId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, second.id);
  assert.deepEqual(JSON.parse(audit[0].detail_json as string), { athleteIds });
  assert.ok(!JSON.stringify(audit).includes(tokenHash));
  await assert.rejects(redeemInvitation(db, second, tokenHash));
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE entity_id=? AND action='redeem'").get(invitationId)!.count, 1);
});
test("expired invitations and account changes at redemption commit cannot grant or consume access", async () => {
  for (const invalidation of ["expired", "inactive", "email"] as const) {
    const { adapter, db, charges } = await setup();
    const tokenHash = "a1".repeat(32);
    const links = adapter.sqlite.prepare("SELECT * FROM guardian_links WHERE user_id=? ORDER BY athlete_id").all(outsider.id);
    const invitationId = await createInvitation(db, admin, { email: outsider.email, athleteIds: charges.map(charge => charge.athleteId), tokenHash });
    if (invalidation === "expired") adapter.sqlite.prepare("UPDATE invitations SET expires_at=created_at WHERE id=?").run(invitationId);
    else adapter.beforeBatch = () => {
      if (invalidation === "inactive") adapter.sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(outsider.id);
      else adapter.sqlite.prepare("UPDATE users SET email=? WHERE id=?").run("changed@example.invalid", outsider.id);
    };
    await assert.rejects(redeemInvitation(db, outsider, tokenHash));
    assert.deepEqual(adapter.sqlite.prepare("SELECT * FROM guardian_links WHERE user_id=? ORDER BY athlete_id").all(outsider.id), links);
    assert.equal(adapter.sqlite.prepare("SELECT redeemed_at FROM invitations WHERE id=?").get(invitationId)!.redeemed_at, null);
    assert.equal(adapter.sqlite.prepare("SELECT count(*) AS count FROM audit_events WHERE entity_id=? AND action='redeem'").get(invitationId)!.count, 0);
  }
});
test("bank confirmation and reason for changed verified fields are required", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]),
    paymentId = await submitPayment(db, parent, data);
  await assert.rejects(
    reviewPayment(db, admin, paymentId, {
      ...verification(data),
      bankChecked: false,
    }),
  );
  await assert.rejects(
    reviewPayment(db, admin, paymentId, {
      ...verification(data),
      bankReference: "changed",
    }),
  );
  await assert.rejects(
    reviewPayment(db, parent, paymentId, verification(data)),
    (e) => (e as { status: number }).status === 403,
  );
  assert.equal((await getAdminDashboard(db)).pendingCount, 1);
});
test("charge adjustments cannot erase already paid balance; inactive account remains inactive", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 800000 }]),
    paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, verification(data));
  await assert.rejects(
    adjustCharge(db, admin, {
      operationId: crypto.randomUUID(),
      chargeId: charges[0].id,
      amountMinor: -200000,
      reason: "Descuento manual.",
    }),
  );
  adapter.sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(parent.id);
  assert.equal((await ensureUser(db, parent)).active, false);
  await assert.rejects(
    getParentDashboard(db, parent),
    (e) => (e as { status: number }).status === 403,
  );
});
test("admin recording keeps submitter separate, requires designated adult and limits pending submissions", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  await assert.rejects(submitPayment(db, admin, data));
  const paymentId = await submitPayment(db, admin, {
    ...data,
    designatedAdultId: parent.id,
    auditReason: "Familia sin acceso al portal.",
  });
  const detail = await getPaymentDetail(db, parent, paymentId);
  assert.equal(detail.payment.submitterId, admin.id);
  assert.equal(detail.payment.designatedAdultId, parent.id);
  assert.equal(detail.files.length, 0);
  for (let i = 0; i < 9; i++)
    await submitPayment(db, parent, input(data.allocations));
  await assert.rejects(
    submitPayment(db, parent, input(data.allocations)),
    (e) => (e as { status: number }).status === 409,
  );
});
test("revocation during approval rolls back the verification, allocations, sequence and outbox", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  adapter.beforeBatch = () =>
    adapter.sqlite
      .prepare(
        "UPDATE guardian_links SET active=0 WHERE user_id=? AND athlete_id=?",
      )
      .run(parent.id, charges[0].athleteId);
  await assert.rejects(
    reviewPayment(db, admin, paymentId, verification(data)),
    (e) => (e as { status: number }).status === 409,
  );
  assert.equal(
    (
      adapter.sqlite
        .prepare("SELECT status FROM payments WHERE id=?")
        .get(paymentId) as { status: string }
    ).status,
    "pending",
  );
  for (const table of [
    "receipts",
    "receipt_counters",
    "payment_allocations",
    "email_outbox",
  ])
    assert.equal(
      (
        adapter.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as {
          n: number;
        }
      ).n,
      0,
    );
});
test("other guardian consent changes during approval never add email copies", async () => {
  const { db, adapter, charges } = await setup();
  await setReceiptConsent(db, second, {
    userId: second.id,
    athleteId: charges[0].athleteId,
    receiptOptIn: true,
  });
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  adapter.beforeBatch = () =>
    adapter.sqlite
      .prepare("UPDATE guardian_links SET receipt_opt_in=0 WHERE user_id=?")
      .run(second.id);
  await reviewPayment(db, admin, paymentId, verification(data));
  assert.equal(
    (
      adapter.sqlite
        .prepare("SELECT count(*) n FROM email_outbox WHERE recipient_id=?")
        .get(second.id) as { n: number }
    ).n,
    0,
  );
});
test("every original and void email has stable UUIDv4 idempotency metadata", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, verification(data));
  await reviewPayment(db, admin, paymentId, {
    action: "void",
    expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null,
    reason: "Devolución bancaria.",
  });
  const found = adapter.sqlite
    .prepare("SELECT id FROM email_outbox")
    .all() as Array<{ id: string }>;
  assert.equal(found.length, 2);
  for (const row of found)
    assert.match(
      row.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});
test("retained evidence budget is enforced by SQLite before new metadata is retained", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  const insert = adapter.sqlite.prepare(
    "INSERT INTO payment_files(id,payment_id,revision,file_key,file_type,file_size,file_sha256,created_at) VALUES(?,?,?,?,'image/png',3145728,?,?)",
  );
  const maximum = Math.floor((5000000000 - data.file.size) / 3145728);
  for (let i = 0; i < maximum; i++)
    insert.run(
      `budget-${i}`,
      paymentId,
      i + 2,
      `budget/${i}`,
      "b".repeat(64),
      "2026-10-10T12:00:00.000Z",
    );
  assert.throws(
    () =>
      insert.run(
        "budget-overflow",
        paymentId,
        maximum + 2,
        "budget/overflow",
        "b".repeat(64),
        "2026-10-10T12:00:00.000Z",
      ),
    /storage_limit/,
  );
});
test("daily submission budget includes rejected payments and does not reset on review", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  for (let i = 0; i < 20; i++) {
    const paymentId = await submitPayment(db, parent, input(data.allocations));
    await reviewPayment(db, admin, paymentId, {
      action: "reject",
      expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
      reason: "Prueba de presupuesto.",
    });
  }
  await assert.rejects(
    submitPayment(db, parent, input(data.allocations)),
    (e) => (e as { status: number }).status === 409,
  );
});
test("dashboard totals include old credit and charges beyond display limits, with open review first", async () => {
  const { db, adapter, charges } = await setup();
  const pending = await submitPayment(
    db,
    parent,
    input([{ chargeId: charges[0].id, amountMinor: 100000 }]),
  );
  adapter.sqlite
    .prepare(
      "UPDATE payments SET submitted_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(pending);
  adapter.sqlite
    .exec(`WITH RECURSIVE history(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM history WHERE n<501)
    INSERT INTO payments(id,designated_user_id,submitted_by,payer_name,amount_minor,transfer_date,bank_reference,status,submitted_at,updated_at,verified_amount_minor,verified_date,verified_reference,verified_bank_name,verified_receiving_account,bank_match_key,verified_by,verified_at)
    SELECT 'history-'||n,'demo-parent-a','demo-parent-a','Persona histórica',10000,'2024-01-01','history-'||n,'verified',datetime('2024-01-01','+'||n||' days'),datetime('2024-01-01','+'||n||' days'),10000,'2024-01-01','history-'||n,'Banco','Cuenta','history-'||n,'demo-admin','2024-01-01T12:00:00.000Z' FROM history;
    WITH RECURSIVE months(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM months WHERE n<700)
    INSERT INTO charges(id,athlete_id,period,due_date,base_minor,discount_minor,published_by,created_at)
    SELECT 'history-charge-'||a.id||'-'||n,a.id,printf('%04d-%02d',2027+(n-1)/12,1+(n-1)%12),printf('%04d-%02d-08',2027+(n-1)/12,1+(n-1)%12),a.fee_minor,0,'demo-admin','2024-01-01T12:00:00.000Z' FROM months CROSS JOIN athletes a;`);
  const dashboard = await getAdminDashboard(db);
  assert.equal(dashboard.payments.length, 500);
  assert.equal(dashboard.charges.length, 2000);
  assert.equal(dashboard.payments[0].id, pending);
  assert.equal(dashboard.pendingCount, 1);
  assert.equal(dashboard.verifiedMinor, 5010000);
  assert.equal(dashboard.creditMinor, 5010000);
  assert.equal(dashboard.balanceMinor, 3900000 * 701 - 675000);
  const parentDashboard = await getParentDashboard(db, parent);
  assert.equal(parentDashboard.payments.length, 200);
  assert.equal(parentDashboard.pendingMinor, 100000);
  assert.equal(parentDashboard.creditMinor, 5010000);
});
test("revoked guardian cannot see current athlete data in an old payment detail, while their own bank evidence stays private", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  const file = (await getPaymentDetail(db, parent, paymentId)).files[0];
  const before = (await getParentDashboard(db, parent)).payments.find(payment => payment.id === paymentId)!;
  assert.equal(before.canOpenDetail, true);
  await revokeGuardian(db, admin, {
    userId: parent.id,
    athleteId: charges[0].athleteId,
  });
  await assert.rejects(
    getPaymentDetail(db, parent, paymentId),
    (e) => (e as { status: number }).status === 404,
  );
  const dashboard = await getParentDashboard(db, parent);
  const retained = dashboard.payments.find(payment => payment.id === paymentId)!;
  assert.equal(retained.canOpenDetail, false);
  assert.deepEqual(retained, { ...before, canOpenDetail: false }, "Keep the complete own-payment summary while removing its unavailable detail link");
  assert.equal(dashboard.pendingMinor, data.amountMinor);
  assert.equal((await getPaymentFile(db, parent, file.id)).id, file.id);
  await assert.rejects(
    getPaymentFile(db, outsider, file.id),
    (e) => (e as { status: number }).status === 404,
  );
});

test("parent dashboard links follow every requested athlete relationship and authorized receipt list while admin review remains available", async () => {
  const { db, charges } = await setup();
  const data = input(charges.slice(0, 2).map(charge => ({ chargeId: charge.id, amountMinor: 100000 })));
  assert.equal(data.allocations.length, 2);
  const paymentId = await submitPayment(db, parent, data);
  const receiptId = await reviewPayment(db, admin, paymentId, verification(data));
  assert.ok(receiptId);
  const staffData = { ...input([{ chargeId: charges[0].id, amountMinor: 100000 }]),
    bankReference: "staff-availability-test", designatedAdultId: parent.id, auditReason: "Registro asistido de prueba." };
  const staffPaymentId = await submitPayment(db, admin, staffData);
  const before = await getParentDashboard(db, parent);
  assert.equal(before.payments.find(payment => payment.id === paymentId)!.canOpenDetail, true);
  assert.ok(before.receipts.some(receipt => receipt.id === receiptId));
  await revokeGuardian(db, admin, { userId: parent.id, athleteId: charges[0].athleteId });
  const activeData = { ...input([{ chargeId: charges[1].id, amountMinor: 100000 }]), bankReference: "active-availability-test" };
  const activePaymentId = await submitPayment(db, parent, activeData);
  const after = await getParentDashboard(db, parent);
  const retained = after.payments.find(payment => payment.id === paymentId)!;
  assert.equal(retained.canOpenDetail, false, "One revoked requested relationship blocks the complete detail");
  assert.deepEqual(retained, { ...before.payments.find(payment => payment.id === paymentId), canOpenDetail: false });
  assert.equal(retained.receiptId, receiptId, "Historical receipt identity stays in the own-payment summary");
  assert.ok(!after.receipts.some(receipt => receipt.id === receiptId), "Only the authorized receipt list supplies receipt links");
  assert.equal(after.payments.find(payment => payment.id === staffPaymentId)!.canOpenDetail, false);
  assert.equal(after.payments.find(payment => payment.id === activePaymentId)!.canOpenDetail, true);
  await assert.rejects(getPaymentDetail(db, parent, paymentId), (e) => (e as { status: number }).status === 404);
  await assert.rejects(getReceipt(db, parent, receiptId!), (e) => (e as { status: number }).status === 404);
  assert.equal((await getPaymentDetail(db, parent, activePaymentId)).payment.id, activePaymentId);
  const staffDashboard = await getParentDashboard(db, admin);
  assert.equal(staffDashboard.payments.find(payment => payment.id === staffPaymentId)!.canOpenDetail, true);
  assert.equal((await getPaymentDetail(db, admin, staffPaymentId)).payment.id, staffPaymentId);
  assert.equal((await getParentDashboard(db, outsider)).payments.length, 0);
});


test("a stale review cannot approve replaced evidence even when the financial fields are unchanged", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  const oldScreen = verification(data);
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info", reason: "Adjuntar respaldo legible.",
    expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
  });
  await revisePayment(db, parent, paymentId, {
    ...data, file: { ...data.file, key: `portal/${crypto.randomUUID()}.png`, sha256: "b".repeat(64) },
    note: "Nuevo respaldo; datos sin cambios.", expectedRevision: 1, expectedStatus: "needs_info", expectedReviewNote: "Adjuntar respaldo legible.",
  });
  await assert.rejects(reviewPayment(db, admin, paymentId, oldScreen),
    (error) => (error as { code: string }).code === "conflict");
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.status, "pending");
  for (const table of ["receipts", "receipt_counters", "payment_allocations", "email_outbox"])
    assert.equal((adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='verify'").get() as { n: number }).n, 0);
  const receiptId = await reviewPayment(db, admin, paymentId, verification(data, data.bankReference, 2));
  assert.ok(receiptId, "A fresh screen can approve the reviewed replacement");
});

test("review compare-and-swap rejects a status change during processing without creating financial records", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE payments SET status='needs_info',review_note='Revisar con tesorería' WHERE id=?").run(paymentId);
  await assert.rejects(reviewPayment(db, admin, paymentId, verification(data)),
    (error) => (error as { code: string }).code === "conflict");
  const payment = (await getPaymentDetail(db, admin, paymentId)).payment;
  assert.equal(payment.status, "needs_info");
  assert.equal(payment.reviewNote, "Revisar con tesorería");
  for (const table of ["receipts", "receipt_counters", "payment_allocations", "email_outbox"])
    assert.equal((adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
});

test("an old family correction cannot overwrite a newer correction request", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info", reason: "Corregir nombre.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
  });
  const correction = { ...data, file: undefined, payerName: "Nombre corregido", note: "Nombre confirmado.", expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: "Corregir nombre." };
  await revisePayment(db, parent, paymentId, correction);
  await reviewPayment(db, admin, paymentId, {
    action: "needs_info", reason: "Adjuntar el respaldo legible.", expectedRevision: 2, expectedStatus: "pending", expectedReviewNote: null,
  });
  await assert.rejects(revisePayment(db, parent, paymentId, { ...correction, payerName: "Nombre desactualizado" }),
    (error) => (error as { code: string }).code === "conflict");
  const detail = await getPaymentDetail(db, admin, paymentId);
  assert.equal(detail.payment.revision, 2);
  assert.equal(detail.payment.status, "needs_info");
  assert.equal(detail.payment.payerName, "Nombre corregido");
  assert.equal(detail.revisions.length, 2);
});


test("charge adjustment retries and concurrent native submissions commit once with one audit", async () => {
  const { db, adapter, charges } = await setup();
  const input = { operationId: crypto.randomUUID(), chargeId: charges[0].id, amountMinor: 50000, reason: "Ajuste sintético autorizado." };
  await Promise.all([adjustCharge(db, admin, input), adjustCharge(db, admin, input)]);
  // The response may be lost after commit: resubmitting the saved form stays safe.
  await adjustCharge(db, admin, input);
  const dashboard = await getParentDashboard(db, parent);
  assert.equal(dashboard.charges.find(c => c.id === input.chargeId)!.totalMinor, charges[0].totalMinor + 50000);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM charge_adjustments WHERE charge_id=?").get(input.chargeId) as { n:number }).n, 1);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE entity_id=? AND action='adjust'").get(input.chargeId) as { n:number }).n, 1);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM financial_operations").get() as { n:number }).n, 1);
  for (const replacement of [{ amountMinor: 100000 }, { reason: "Motivo distinto." }])
    await assert.rejects(adjustCharge(db, admin, { ...input, ...replacement }), e => (e as { code:string }).code === "conflict");
  assert.throws(() => adapter.sqlite.prepare("DELETE FROM financial_operations").run(), /immutable_financial_operation/);
});

test("racing different payloads cannot reuse the same adjustment operation", async () => {
  const { db, adapter, charges } = await setup();
  const input = { operationId: crypto.randomUUID(), chargeId: charges[0].id, amountMinor: 50000, reason: "Ajuste sintético." };
  const results = await Promise.allSettled([
    adjustCharge(db, admin, input),
    adjustCharge(db, admin, { ...input, amountMinor: 100000 }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "conflict");
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM charge_adjustments").get() as { n:number }).n, 1);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='adjust'").get() as { n:number }).n, 1);
});

test("operation IDs are required and scoped to actor, action and target", async () => {
  const { db, adapter, charges } = await setup();
  const input = { operationId: crypto.randomUUID(), chargeId: charges[0].id, amountMinor: 10000, reason: "Ajuste sintético." };
  for (const operationId of ["", "invalid", undefined as unknown as string])
    await assert.rejects(adjustCharge(db, admin, { ...input, operationId }), e => (e as { code:string }).code === "invalid_fields");
  await adjustCharge(db, admin, input);
  await adjustCharge(db, admin, { ...input, chargeId: charges[1].id });
  const anotherAdmin = { ...admin, id: "demo-other-admin", email: "other-admin@example.invalid" };
  await ensureUser(db, anotherAdmin);
  await adjustCharge(db, anotherAdmin, input);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM financial_operations").get() as { n:number }).n, 3);
});

test("failed adjustment rolls back the operation marker and can be corrected", async () => {
  const { db, adapter, charges } = await setup();
  const input = { operationId: crypto.randomUUID(), chargeId: charges[0].id, amountMinor: -charges[0].totalMinor - 1, reason: "Ajuste sintético." };
  await assert.rejects(adjustCharge(db, admin, input));
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM financial_operations").get() as { n:number }).n, 0);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='adjust'").get() as { n:number }).n, 0);
  await adjustCharge(db, admin, { ...input, amountMinor: 10000 });
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM financial_operations").get() as { n:number }).n, 1);
});

test("credit retries commit once, preserve the receipt and replay even after all credit is consumed", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }], 500000);
  const paymentId = await submitPayment(db, parent, data);
  const receiptId = await reviewPayment(db, admin, paymentId, verification(data));
  const beforeReceipt = (await getReceipt(db, parent, receiptId!)).snapshot;
  const operation = { operationId: crypto.randomUUID(), paymentId, allocations: [{ chargeId: charges[0].id, amountMinor: 100000 }], reason: "Aplicación sintética autorizada." };
  await Promise.all([applyPaymentCredit(db, admin, operation), applyPaymentCredit(db, admin, operation)]);
  await applyPaymentCredit(db, admin, operation);
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.unallocatedMinor, 300000);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE entity_id=? AND action='apply_credit'").get(paymentId) as { n:number }).n, 1);
  await assert.rejects(applyPaymentCredit(db, admin, { ...operation, allocations: [{ chargeId: charges[0].id, amountMinor: 200000 }] }), e => (e as { code:string }).code === "conflict");
  await applyPaymentCredit(db, admin, { ...operation, operationId: crypto.randomUUID(), allocations: [{ chargeId: charges[0].id, amountMinor: 300000 }] });
  await applyPaymentCredit(db, admin, operation);
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.unallocatedMinor, 0);
  assert.deepEqual((await getReceipt(db, parent, receiptId!)).snapshot, beforeReceipt);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE entity_id=? AND action='apply_credit'").get(paymentId) as { n:number }).n, 2);
});

test("a failed credit batch rolls back its marker and a deliberate retry can complete", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }], 500000);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, verification(data));
  const operation = { operationId: crypto.randomUUID(), paymentId, allocations: [{ chargeId: charges[0].id, amountMinor: 100000 }], reason: "Aplicación sintética." };
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE guardian_links SET active=0 WHERE user_id=? AND athlete_id=?").run(parent.id, charges[0].athleteId);
  await assert.rejects(applyPaymentCredit(db, admin, operation), e => (e as { code:string }).code === "conflict");
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM financial_operations").get() as { n:number }).n, 0);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='apply_credit'").get() as { n:number }).n, 0);
  await linkGuardian(db, admin, { userId: parent.id, athleteId: charges[0].athleteId });
  await applyPaymentCredit(db, admin, operation);
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.unallocatedMinor, 300000);
});


test("adjustment retry recovers when the database committed but its response was lost", async () => {
  const { db, adapter, charges } = await setup();
  const operation = { operationId: crypto.randomUUID(), chargeId: charges[0].id, amountMinor: 50000, reason: "Ajuste sintético." };
  const originalBatch = adapter.batch.bind(adapter);
  let responseLost = false;
  adapter.batch = async statements => {
    const result = await originalBatch(statements);
    if (!responseLost) { responseLost = true; throw new Error("simulated_lost_response"); }
    return result;
  };
  await assert.rejects(adjustCharge(db, admin, operation), /simulated_lost_response/);
  await adjustCharge(db, admin, operation);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM charge_adjustments").get() as { n:number }).n, 1);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='adjust'").get() as { n:number }).n, 1);
});

test("racing credit requests with different payloads commit only the winning operation", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }], 500000);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, verification(data));
  const operation = { operationId: crypto.randomUUID(), paymentId, allocations: [{ chargeId: charges[0].id, amountMinor: 100000 }], reason: "Aplicación sintética." };
  await assert.rejects(applyPaymentCredit(db, admin, { ...operation, operationId: "" }), e => (e as { code:string }).code === "invalid_fields");
  const results = await Promise.allSettled([
    applyPaymentCredit(db, admin, operation),
    applyPaymentCredit(db, admin, { ...operation, allocations: [{ chargeId: charges[0].id, amountMinor: 200000 }] }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "conflict");
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='apply_credit'").get() as { n:number }).n, 1);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM payment_allocations WHERE payment_id=?").get(paymentId) as { n:number }).n, 2);
});


test("an older admin screen cannot replace or approve a changed needs-info note", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, { action: "needs_info", reason: "Confirmar referencia.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  const oldScreen = { expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: "Confirmar referencia." };
  await reviewPayment(db, admin, paymentId, { ...oldScreen, action: "needs_info", reason: "Adjuntar el PDF completo." });
  for (const action of ["needs_info", "reject"] as const)
    await assert.rejects(reviewPayment(db, admin, paymentId, { ...oldScreen, action, reason: "Una decisión desde la pantalla anterior." }), e => (e as { code:string }).code === "conflict");
  await assert.rejects(reviewPayment(db, admin, paymentId, { ...verification(data), ...oldScreen }), e => (e as { code:string }).code === "conflict");
  const detail = await getPaymentDetail(db, admin, paymentId);
  assert.equal(detail.payment.status, "needs_info");
  assert.equal(detail.payment.revision, 1);
  assert.equal(detail.payment.reviewNote, "Adjuntar el PDF completo.");
  assert.equal(detail.audit.filter(event => event.action === "needs_info").length, 2);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM receipts").get() as { n:number }).n, 0);
  await reviewPayment(db, admin, paymentId, { ...verification(data), ...oldScreen, expectedReviewNote: detail.payment.reviewNote });
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.status, "verified");
});

test("a family correction must answer the currently displayed reason even when status and revision are unchanged", async () => {
  const { db, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, { action: "needs_info", reason: "Confirmar referencia.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  const oldScreen = { expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: "Confirmar referencia." };
  await reviewPayment(db, admin, paymentId, { ...oldScreen, action: "needs_info", reason: "Necesitamos el comprobante legible." });
  const correction = { ...data, file: undefined, ...oldScreen, note: "Referencia confirmada." };
  await assert.rejects(revisePayment(db, parent, paymentId, correction), e => (e as { code:string }).code === "conflict");
  const detail = await getPaymentDetail(db, parent, paymentId);
  assert.equal(detail.payment.reviewNote, "Necesitamos el comprobante legible.");
  assert.equal(detail.payment.revision, 1);
  assert.equal(detail.revisions.length, 1);
  await revisePayment(db, parent, paymentId, { ...correction, expectedReviewNote: detail.payment.reviewNote, note: "Respondí a la solicitud vigente." });
  assert.equal((await getPaymentDetail(db, parent, paymentId)).payment.revision, 2);
});

test("the verification transaction rejects a same-status note change after the initial read", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, { action: "needs_info", reason: "Solicitud original.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE payments SET review_note='Nueva solicitud de tesorería.' WHERE id=?").run(paymentId);
  await assert.rejects(reviewPayment(db, admin, paymentId, { ...verification(data), expectedStatus: "needs_info", expectedReviewNote: "Solicitud original." }), e => (e as { code:string }).code === "conflict");
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.reviewNote, "Nueva solicitud de tesorería.");
  for (const table of ["receipts", "receipt_counters", "payment_allocations", "email_outbox"])
    assert.equal((adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n:number }).n, 0);
});

test("the family correction transaction preserves a new reason written during processing", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await reviewPayment(db, admin, paymentId, { action: "needs_info", reason: "Solicitud original.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE payments SET review_note='Nueva solicitud de tesorería.' WHERE id=?").run(paymentId);
  await assert.rejects(revisePayment(db, parent, paymentId, { ...data, file: undefined, note: "Respuesta anterior.", expectedRevision: 1, expectedStatus: "needs_info", expectedReviewNote: "Solicitud original." }), e => (e as { code:string }).code === "conflict");
  const detail = await getPaymentDetail(db, parent, paymentId);
  assert.equal(detail.payment.reviewNote, "Nueva solicitud de tesorería.");
  assert.equal(detail.payment.revision, 1);
  assert.equal(detail.revisions.length, 1);
});


test("staff-assisted bank confirmation queues only the designated family adult and preserves the receipt through voiding", async () => {
  const { db, adapter, charges } = await setup();
  const data = { ...input([{ chargeId: charges[0].id, amountMinor: 100000 }]), designatedAdultId: parent.id, auditReason: "Registro asistido solicitado por la familia." };
  const paymentId = await submitPayment(db, admin, data);
  assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox").get() as {n:number}).n, 0);
  const receiptId = await reviewPayment(db, admin, paymentId, verification(data));
  const receipt = await getReceipt(db, parent, receiptId!);
  assert.equal(receipt.emailStatus, "queued");
  assert.equal(receipt.status, "issued");
  assert.equal(receipt.snapshot.amountMinor, 100000);
  assert.equal(receipt.snapshot.designatedAdult.id, parent.id);
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.status, "verified");
  assert.equal((await getParentDashboard(db, parent)).charges.find(c => c.id === charges[0].id)!.paidMinor, 100000);
  assert.deepEqual(adapter.sqlite.prepare("SELECT recipient_id,recipient_email FROM email_outbox").all().map(row => ({...row})), [{recipient_id:parent.id,recipient_email:parent.email}]);
  const audit = JSON.parse((adapter.sqlite.prepare("SELECT detail_json FROM audit_events WHERE entity_id=? AND action='verify'").get(paymentId) as {detail_json:string}).detail_json);
  assert.equal(audit.bankMatchConfirmed, true);
  assert.equal(audit.emailRecipientPolicy, "designated_adult");
  assert.equal(audit.emailRecipientPending, false);
  assert.equal(audit.emailRecipientUserId, parent.id);
  await reviewPayment(db, admin, paymentId, { action: "void", reason: "Anulación sintética.", expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null });
  const voided = await getReceipt(db, admin, receiptId!);
  assert.deepEqual(voided.snapshot, receipt.snapshot);
  assert.equal(voided.status, "void");
  assert.equal(voided.emailStatus, "queued");
  assert.deepEqual(adapter.sqlite.prepare("SELECT recipient_id,recipient_email,kind FROM email_outbox WHERE status='queued'").all().map(row => ({...row})), [{recipient_id:parent.id,recipient_email:parent.email,kind:"receipt_void"}]);
});

test("a staff correction preserves the original verified uploader as the sole receipt email recipient", async () => {
  const { db, adapter, charges } = await setup();
  const data = input([{ chargeId: charges[0].id, amountMinor: 100000 }]);
  const paymentId = await submitPayment(db, parent, data);
  await setReceiptConsent(db, second, { userId: second.id, athleteId: charges[0].athleteId, receiptOptIn: true });
  await reviewPayment(db, admin, paymentId, { action: "needs_info", reason: "Corregir el respaldo.", expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  await revisePayment(db, admin, paymentId, { ...data, file: { ...data.file, key: `portal/${crypto.randomUUID()}.png` }, payerName: "Nombre consignado por el banco", note: "Corrección administrativa autorizada.", expectedRevision: 1, expectedStatus: "needs_info", expectedReviewNote: "Corregir el respaldo." });
  const receiptId = await reviewPayment(db, admin, paymentId, verification(data, data.bankReference, 2));
  assert.equal((await getPaymentDetail(db, admin, paymentId)).payment.submitterId, parent.id);
  assert.equal((await getReceipt(db, parent, receiptId!)).snapshot.payerName, "Nombre consignado por el banco");
  const emails = adapter.sqlite.prepare("SELECT recipient_id,recipient_email FROM email_outbox").all().map(row => ({...row}));
  assert.deepEqual(emails, [{recipient_id:parent.id,recipient_email:parent.email}]);
  const audit = JSON.parse((adapter.sqlite.prepare("SELECT detail_json FROM audit_events WHERE entity_id=? AND action='verify'").get(paymentId) as {detail_json:string}).detail_json);
  assert.equal(audit.emailRecipientPolicy, "uploader_only");
  assert.equal(audit.emailRecipientPending, false);
  assert.equal(audit.emailRecipientUserId, parent.id);
});

test("void notices use the designated adult without copying legacy opted-in guardians or staff uploaders", async () => {
  for (const staffAssisted of [false, true]) {
    const { db, adapter, charges } = await setup();
    const data = { ...input([{ chargeId: charges[0].id, amountMinor: 100000 }]), ...(staffAssisted ? { designatedAdultId: parent.id, auditReason: "Registro asistido." } : {}) };
    const paymentId = await submitPayment(db, staffAssisted ? admin : parent, data);
    const receiptId = await reviewPayment(db, admin, paymentId, verification(data));
    await setReceiptConsent(db, second, { userId: second.id, athleteId: charges[0].athleteId, receiptOptIn: true });
    const createdAt = new Date().toISOString();
    const insert = adapter.sqlite.prepare("INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,'receipt','queued',?,?,?)");
    const legacyRecipients = staffAssisted ? [admin, second] : [second];
    for (const recipient of legacyRecipients) insert.run(crypto.randomUUID(), receiptId, recipient.id, recipient.email, recipient.name, createdAt, createdAt, createdAt);
    adapter.sqlite.prepare("UPDATE email_outbox SET status='blocked',updated_at='2099-01-01T00:00:00.000Z' WHERE recipient_id=?").run(second.id);
    assert.equal((await getReceipt(db, admin, receiptId!)).emailStatus, "queued", "Legacy copies must not mask the designated recipient status");
    await reviewPayment(db, admin, paymentId, { action: "void", reason: "Anulación sintética.", expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null });
    assert.equal((await getReceipt(db, admin, receiptId!)).emailStatus, "queued");
    const notices = adapter.sqlite.prepare("SELECT recipient_id,recipient_email FROM email_outbox WHERE kind='receipt_void'").all().map(row => ({...row}));
    assert.deepEqual(notices, [{recipient_id:parent.id,recipient_email:parent.email}]);
    assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox WHERE kind='receipt' AND status<>'cancelled'").get() as {n:number}).n, 0);
  }
});

test("void notices retain the frozen address and do not retarget changed, inactive or revoked recipients", async () => {
  for (const staffAssisted of [false,true]) for (const invalidation of ["email", "inactive", "link"]) {
    const { db, adapter, charges } = await setup();
    const data = { ...input([{ chargeId: charges[0].id, amountMinor: 100000 }]), ...(staffAssisted ? { designatedAdultId: parent.id, auditReason: "Registro asistido." } : {}) };
    const paymentId = await submitPayment(db, staffAssisted ? admin : parent, data);
    await reviewPayment(db, admin, paymentId, verification(data));
    if (invalidation === "email") adapter.sqlite.prepare("UPDATE users SET email='new@example.invalid' WHERE id=?").run(parent.id);
    if (invalidation === "inactive") adapter.sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(parent.id);
    if (invalidation === "link") await revokeGuardian(db, admin, { userId: parent.id, athleteId: charges[0].athleteId });
    await reviewPayment(db, admin, paymentId, { action: "void", reason: "Anulación sintética.", expectedRevision: 1, expectedStatus: "verified", expectedReviewNote: null });
    assert.equal((adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox WHERE kind='receipt_void'").get() as {n:number}).n, 0);
    assert.equal((adapter.sqlite.prepare("SELECT recipient_email FROM email_outbox").get() as {recipient_email:string}).recipient_email, parent.email);
  }
});


test("staff-assisted inactive or invalid-email adults keep the bank-confirmed receipt without any email fallback", async () => {
  for (const condition of ["inactive", "empty", "invalid"]) {
    const { db, adapter, charges } = await setup();
    const data = { ...input([{ chargeId: charges[0].id, amountMinor: 100000 }]), designatedAdultId: parent.id, auditReason: "Registro asistido." };
    const paymentId = await submitPayment(db, admin, data);
    const email = condition === "empty" ? "" : condition === "invalid" ? "dirección pendiente" : parent.email;
    adapter.sqlite.prepare("UPDATE users SET active=?,email=? WHERE id=?").run(condition === "inactive" ? 0 : 1,email,parent.id);
    const receiptId = await reviewPayment(db, admin, paymentId, verification(data));
    const receipt = await getReceipt(db, admin, receiptId!);
    assert.equal(receipt.emailStatus,"recipient_pending");
    assert.equal(receipt.snapshot.designatedAdult.email,email);
    assert.equal(receipt.snapshot.amountMinor,data.amountMinor);
    assert.ok(renderReceipt(receipt.snapshot).text.includes(receipt.number));
    assert.equal((await getPaymentDetail(db,admin,paymentId)).payment.status,"verified");
    assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox").get()?.n,0);
    const audit = JSON.parse((adapter.sqlite.prepare("SELECT detail_json FROM audit_events WHERE entity_id=? AND action='verify'").get(paymentId) as {detail_json:string}).detail_json);
    assert.equal(audit.emailRecipientPolicy,"designated_adult");
    assert.equal(audit.emailRecipientPending,true);
    assert.equal(audit.emailRecipientUserId,null);
    await reviewPayment(db, admin, paymentId, {action:"void",reason:"Anulación sintética.",expectedRevision:1,expectedStatus:"verified",expectedReviewNote:null});
    assert.equal((await getReceipt(db,admin,receiptId!)).emailStatus,"recipient_pending");
    assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox").get()?.n,0);
    assert.deepEqual((await getReceipt(db,admin,receiptId!)).snapshot,receipt.snapshot);
  }
});

test("a designated address changed during confirmation is held and audited without retargeting the frozen snapshot", async () => {
  const { db, adapter, charges } = await setup();
  const data = { ...input([{ chargeId:charges[0].id,amountMinor:100000 }]),designatedAdultId:parent.id,auditReason:"Registro asistido." };
  const paymentId = await submitPayment(db,admin,data);
  adapter.beforeBatch = () => adapter.sqlite.prepare("UPDATE users SET email='new@example.invalid' WHERE id=?").run(parent.id);
  const receiptId = await reviewPayment(db,admin,paymentId,verification(data));
  assert.equal((await getReceipt(db,admin,receiptId!)).emailStatus,"recipient_pending");
  assert.equal((await getReceipt(db,admin,receiptId!)).snapshot.designatedAdult.email,parent.email);
  const audit = JSON.parse((adapter.sqlite.prepare("SELECT detail_json FROM audit_events WHERE entity_id=? AND action='verify'").get(paymentId) as {detail_json:string}).detail_json);
  assert.equal(audit.emailRecipientPending,true);
  assert.equal(audit.emailRecipientUserId,null);
});

test("missing designated accounts or revoked required links fail closed before bank confirmation", async () => {
  for (const condition of ["missing", "link"]) {
    const { db,adapter,charges } = await setup();
    const data = { ...input([{chargeId:charges[0].id,amountMinor:100000}]),designatedAdultId:parent.id,auditReason:"Registro asistido." };
    const paymentId = await submitPayment(db,admin,data);
    if(condition === "missing") {
      adapter.sqlite.exec("PRAGMA foreign_keys=OFF");
      adapter.sqlite.prepare("DELETE FROM users WHERE id=?").run(parent.id);
    } else await revokeGuardian(db,admin,{userId:parent.id,athleteId:charges[0].athleteId});
    await assert.rejects(reviewPayment(db,admin,paymentId,verification(data)), condition === "missing" ? {status:409,code:"recipient_missing"} : {status:403});
    assert.equal(adapter.sqlite.prepare("SELECT status FROM payments WHERE id=?").get(paymentId)?.status,"pending");
    assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM receipts").get()?.n,0);
    assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM email_outbox").get()?.n,0);
  }
});

test("designated family identity and email cannot be made ambiguous by duplicate account addresses", async () => {
  const {adapter} = await setup();
  assert.throws(() => adapter.sqlite.prepare("UPDATE users SET email=? WHERE id=?").run(parent.email.toUpperCase(),second.id),/UNIQUE/);
});


test("a held receipt can deliberately prepare its first email after verified account contact repair without changing finances",async()=>{
  const {db,adapter,charges}=await setup();
  const data={...input([{chargeId:charges[0].id,amountMinor:100000}]),designatedAdultId:parent.id,auditReason:"Registro asistido."};
  const paymentId=await submitPayment(db,admin,data);
  adapter.sqlite.prepare("UPDATE users SET email='' WHERE id=?").run(parent.id);
  const receiptId=await reviewPayment(db,admin,paymentId,verification(data));
  const issued=await getReceipt(db,admin,receiptId!);
  assert.equal(issued.emailStatus,"recipient_pending");
  assert.equal(issued.canPrepareEmail,true);
  const paymentBefore=adapter.sqlite.prepare("SELECT * FROM payments WHERE id=?").get(paymentId);
  const allocationBefore=adapter.sqlite.prepare("SELECT * FROM payment_allocations WHERE payment_id=?").all(paymentId);
  // Existing verified-account synchronization repairs contact data, never the frozen receipt.
  await ensureUser(db,parent);
  assert.equal((await getReceipt(db,admin,receiptId!)).emailStatus,"recipient_pending");
  const result=await prepareReceiptEmail(db,admin,receiptId!);
  assert.equal(result.created,true);
  const prepared=await getReceipt(db,admin,receiptId!);
  assert.equal(prepared.emailStatus,"queued");
  assert.equal(prepared.canPrepareEmail,false);
  assert.deepEqual(prepared.snapshot,issued.snapshot);
  assert.equal(prepared.snapshot.designatedAdult.email,"");
  assert.equal(adapter.sqlite.prepare("SELECT recipient_email FROM email_outbox WHERE id=?").get(result.outboxId)?.recipient_email,parent.email);
  assert.deepEqual(adapter.sqlite.prepare("SELECT * FROM payments WHERE id=?").get(paymentId),paymentBefore);
  assert.deepEqual(adapter.sqlite.prepare("SELECT * FROM payment_allocations WHERE payment_id=?").all(paymentId),allocationBefore);
});


test("first-email preparation is unavailable for legacy-only email history or a void receipt",async()=>{
  const {db,adapter,charges}=await setup();
  const data={...input([{chargeId:charges[0].id,amountMinor:100000}]),designatedAdultId:parent.id,auditReason:"Registro asistido."};
  const paymentId=await submitPayment(db,admin,data);
  adapter.sqlite.prepare("UPDATE users SET email='' WHERE id=?").run(parent.id);
  const receiptId=await reviewPayment(db,admin,paymentId,verification(data));
  const now=new Date().toISOString();
  adapter.sqlite.prepare("INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,'receipt','cancelled',?,?,?)").run(crypto.randomUUID(),receiptId,second.id,second.email,second.name,now,now,now);
  const held=await getReceipt(db,admin,receiptId!);
  assert.equal(held.emailStatus,"recipient_pending");
  assert.equal(held.canPrepareEmail,false);
  await reviewPayment(db,admin,paymentId,{action:"void",reason:"Anulación sintética.",expectedRevision:1,expectedStatus:"verified",expectedReviewNote:null});
  assert.equal((await getReceipt(db,admin,receiptId!)).canPrepareEmail,false);
});
