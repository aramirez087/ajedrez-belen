import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  getParentDashboard,
  recoverPaymentSubmission,
  reviewPayment,
  revisePayment,
  seedDemo,
  submitPayment,
} from "../src/lib/portal/domain";
import { PortalError, type Actor, type SubmitPaymentInput } from "../src/lib/portal/types";
import { submitPaymentForm } from "../src/lib/portal/payment-submission";
import { attachSlipDraft, registerSlipDraft } from "../src/lib/portal/ocr";

/** Execute real schema constraints and atomic D1 batches against synthetic memory-only data. */
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  executions = 0;
  batches = 0;
  afterMissingPaymentRead?: () => Promise<void>;
  private barrier?: { remaining: number; ready: Promise<void>; release: () => void };

  constructor() {
    for (const migration of ["0002_portal.sql", "0003_ocr.sql", "0004_financial_operations.sql", "0006_self_registration.sql"]) {
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
        if (!row && sql === "SELECT submitted_by AS submittedBy FROM payments WHERE id=?" && database.afterMissingPaymentRead) {
          const completeCompetingRequest = database.afterMissingPaymentRead;
          database.afterMissingPaymentRead = undefined;
          await completeCompetingRequest();
        }
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      async run() { return statement.execute(); },
      execute() {
        database.executions++;
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }

  synchronizeNextBatches(count: number) {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    this.barrier = { remaining: count, ready, release };
  }

  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    const barrier = this.barrier;
    if (barrier) {
      if (--barrier.remaining === 0) { this.barrier = undefined; barrier.release(); }
      await barrier.ready;
    }
    this.batches++;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map(statement => statement.execute());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  db() { return this as unknown as D1Database; }
}

const parent: Actor = {
  id: "demo-parent-a", email: "ana@example.invalid", name: "Ana de prueba", isAdmin: false, mode: "demo",
};
const second: Actor = {
  id: "demo-parent-b", email: "diego@example.invalid", name: "Diego de prueba", isAdmin: false, mode: "demo",
};
const admin: Actor = {
  id: "demo-admin", email: "admin@example.invalid", name: "Administración de prueba", isAdmin: true, mode: "demo",
};

async function setup(t: TestContext) {
  const adapter = new SQLiteD1();
  t.after(() => adapter.sqlite.close());
  const db = adapter.db();
  await seedDemo(db);
  const charges = (await getParentDashboard(db, parent)).charges;
  assert.equal(charges.length, 2);
  const input: SubmitPaymentInput = {
    submissionId: crypto.randomUUID(),
    payerName: "Persona sintética",
    amountMinor: 200000,
    transferDate: "2026-10-10",
    bankReference: "SYNTHETIC-REFERENCE-001",
    allocations: charges.map(charge => ({ chargeId: charge.id, amountMinor: 100000 })),
    file: { key: `portal/${crypto.randomUUID()}.png`, type: "image/png", size: 100, sha256: "a".repeat(64) },
    note: "Comprobante sintético original.",
  };
  return { adapter, db, input };
}

function financialSnapshot(adapter: SQLiteD1) {
  const tables = ["payments", "payment_revisions", "payment_files", "payment_requested_allocations",
    "payment_allocations", "receipts", "receipt_counters", "email_outbox", "audit_events", "slip_drafts"];
  return Object.fromEntries(tables.map(table => [table, adapter.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function assertSingleSubmission(adapter: SQLiteD1, id: string, allocations = 2) {
  for (const table of ["payments", "payment_revisions", "payment_files"]) {
    assert.equal(adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 1, table);
  }
  assert.equal(adapter.sqlite.prepare("SELECT id FROM payments").get()!.id, id);
  assert.equal(adapter.sqlite.prepare("SELECT status FROM payments").get()!.status, "pending");
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM payment_requested_allocations").get()!.n, allocations);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE entity_type='payment' AND action='submit'").get()!.n, 1);
  for (const table of ["payment_allocations", "receipts", "email_outbox"]) {
    assert.equal(adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  }
}

function isConflict(error: unknown): error is PortalError {
  return error instanceof PortalError && error.status === 409 && error.code === "conflict";
}

function verification(input: SubmitPaymentInput, revision = 1) {
  return {
    action: "verify" as const, expectedRevision: revision, expectedStatus: "pending" as const, expectedReviewNote: null,
    bankChecked: true, associationName: "Asociación de prueba", bankName: "Banco sintético", receivingAccount: "CR-SYNTHETIC-001",
    bankReference: input.bankReference, amountMinor: input.amountMinor,
    paymentDate: input.transferDate, currency: "CRC" as const, allocations: input.allocations,
  };
}

test("a submission requires a UUIDv4 token before it can write payment records", async t => {
  const { adapter, db, input } = await setup(t);
  const before = financialSnapshot(adapter);
  for (const submissionId of [undefined, "", "not-a-uuid", "00000000-0000-1000-8000-000000000000"]) {
    await assert.rejects(submitPayment(db, parent, { ...input, submissionId } as SubmitPaymentInput),
      error => error instanceof PortalError && error.status === 400);
  }
  assert.deepEqual(financialSnapshot(adapter), before);
});

test("submission recovery is read-only for both a missing token and a completed submission", async t => {
  const { adapter, db, input } = await setup(t);
  const initialWrites = adapter.executions;
  const initialBatches = adapter.batches;
  const before = financialSnapshot(adapter);
  assert.equal(await recoverPaymentSubmission(db, parent, input), null);
  assert.equal(adapter.executions, initialWrites);
  assert.equal(adapter.batches, initialBatches);
  assert.deepEqual(financialSnapshot(adapter), before);

  const id = await submitPayment(db, parent, input);
  const submitted = financialSnapshot(adapter);
  const submittedWrites = adapter.executions;
  const submittedBatches = adapter.batches;
  assert.equal(await recoverPaymentSubmission(db, parent, input), id);
  assert.equal(adapter.executions, submittedWrites);
  assert.equal(adapter.batches, submittedBatches);
  assert.deepEqual(financialSnapshot(adapter), submitted);
});

test("sequential retries reuse one payment when allocations reorder or the same evidence gets a new storage key", async t => {
  const { adapter, db, input } = await setup(t);
  const id = await submitPayment(db, parent, input);
  const before = financialSnapshot(adapter);
  assert.equal(id, input.submissionId);
  assert.equal(await submitPayment(db, parent, input), id);
  assert.equal(await submitPayment(db, parent, {
    ...input,
    allocations: [...input.allocations].reverse(),
    file: { ...input.file, key: `portal/${crypto.randomUUID()}.png` },
  }), id);
  assertSingleSubmission(adapter, id);
  assert.deepEqual(financialSnapshot(adapter), before);
});

test("simultaneous identical submissions return one payment after both attempt the atomic insert", async t => {
  const { adapter, db, input } = await setup(t);
  const batches = adapter.batches;
  adapter.synchronizeNextBatches(2);
  const ids = await Promise.all([
    submitPayment(db, parent, input),
    submitPayment(db, parent, { ...input, file: { ...input.file, key: `portal/${crypto.randomUUID()}.png` } }),
  ]);
  assert.deepEqual(ids, [input.submissionId, input.submissionId]);
  assert.equal(adapter.batches - batches, 2, "both requests must pass the initial lookup before either commits");
  assertSingleSubmission(adapter, input.submissionId);
});

test("simultaneous different payloads sharing a token have one winner and one conflict", async t => {
  const { adapter, db, input } = await setup(t);
  adapter.synchronizeNextBatches(2);
  const changed = { ...input, payerName: "Otra persona sintética", file: { ...input.file, key: `portal/${crypto.randomUUID()}.png` } };
  const results = await Promise.allSettled([submitPayment(db, parent, input), submitPayment(db, parent, changed)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && isConflict(result.reason)).length, 1);
  assertSingleSubmission(adapter, input.submissionId);
  const winner = results[0].status === "fulfilled" ? input : changed;
  assert.equal(adapter.sqlite.prepare("SELECT payer_name FROM payments").get()!.payer_name, winner.payerName);
});

test("reused submission tokens reject changes to every persisted business or evidence field", async t => {
  const { adapter, db, input } = await setup(t);
  const assisted: SubmitPaymentInput = {
    ...input, designatedAdultId: parent.id, shareEvidence: true, auditReason: "Registro asistido sintético.",
  };
  await submitPayment(db, admin, assisted);
  const before = financialSnapshot(adapter);
  const changes: Array<[string, Partial<SubmitPaymentInput>]> = [
    ["payer", { payerName: "Otra persona sintética" }],
    ["amount", { amountMinor: assisted.amountMinor + 100 }],
    ["date", { transferDate: "2026-10-09" }],
    ["reference", { bankReference: "SYNTHETIC-REFERENCE-002" }],
    ["note", { note: "Nota distinta." }],
    ["reason", { auditReason: "Otro motivo." }],
    ["designated adult", { designatedAdultId: second.id }],
    ["evidence sharing", { shareEvidence: false }],
    ["allocation amounts", { allocations: assisted.allocations.map((allocation, index) => ({ ...allocation, amountMinor: allocation.amountMinor + (index ? -100 : 100) })) }],
    ["allocation membership", { allocations: [assisted.allocations[0]] }],
    ["evidence hash", { file: { ...assisted.file, sha256: "b".repeat(64) } }],
    ["evidence MIME type", { file: { ...assisted.file, type: "application/pdf" } }],
    ["evidence size", { file: { ...assisted.file, size: 101 } }],
  ];
  for (const [field, change] of changes) {
    await assert.rejects(recoverPaymentSubmission(db, admin, { ...assisted, ...change }), isConflict, `${field}: recovery`);
    await assert.rejects(submitPayment(db, admin, { ...assisted, ...change }), isConflict, `${field}: submission`);
    assert.deepEqual(financialSnapshot(adapter), before, `${field}: nothing changes`);
  }
});

test("another active guardian cannot recover or take over a known submission token", async t => {
  const { adapter, db, input } = await setup(t);
  await submitPayment(db, parent, input);
  const before = financialSnapshot(adapter);
  for (const attempt of [recoverPaymentSubmission, submitPayment]) {
    await assert.rejects(attempt(db, second, input), error => {
      assert.ok(isConflict(error));
      for (const privateValue of [input.submissionId, input.payerName, parent.id, parent.email, input.bankReference, input.file.key]) {
        assert.ok(!error.message.includes(privateValue), "conflict response must not expose the existing submission");
      }
      return true;
    });
  }
  assert.deepEqual(financialSnapshot(adapter), before);
});

test("the original submission remains recoverable after a correction and bank verification without changing either", async t => {
  const { adapter, db, input } = await setup(t);
  const id = await submitPayment(db, parent, input);
  const reason = "Corregir la referencia sintética.";
  await reviewPayment(db, admin, id, { action: "needs_info", reason, expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null });
  const corrected = {
    ...input, payerName: "Persona corregida", bankReference: "SYNTHETIC-CORRECTED-002", amountMinor: 300000,
    allocations: input.allocations.map((allocation, index) => ({ ...allocation, amountMinor: allocation.amountMinor + (index ? 0 : 100000) })),
    file: { ...input.file, key: `portal/${crypto.randomUUID()}.png`, sha256: "c".repeat(64) },
    note: "Corrección sintética.", expectedRevision: 1, expectedStatus: "needs_info" as const, expectedReviewNote: reason,
  };
  await revisePayment(db, parent, id, corrected);
  const revised = financialSnapshot(adapter);
  assert.equal(await recoverPaymentSubmission(db, parent, input), id);
  assert.equal(await submitPayment(db, parent, input), id);
  await assert.rejects(recoverPaymentSubmission(db, parent, corrected), isConflict);
  assert.deepEqual(financialSnapshot(adapter), revised);

  await reviewPayment(db, admin, id, verification(corrected, 2));
  const verified = financialSnapshot(adapter);
  assert.equal(await recoverPaymentSubmission(db, parent, input), id);
  assert.equal(await submitPayment(db, parent, input), id);
  assert.deepEqual(financialSnapshot(adapter), verified);
  assert.equal(adapter.sqlite.prepare("SELECT revision,status,bank_reference FROM payments").get()!.revision, 2);
  assert.equal(adapter.sqlite.prepare("SELECT status FROM payments").get()!.status, "verified");
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM receipts").get()!.n, 1);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM payment_files").get()!.n, 2);
});

test("a new token is a separate submission even for the same bank reference, while bank credit remains unique", async t => {
  const { adapter, db, input } = await setup(t);
  const first = await submitPayment(db, parent, input);
  await reviewPayment(db, admin, first, verification(input));
  const fresh = { ...input, submissionId: crypto.randomUUID(), file: { ...input.file, key: `portal/${crypto.randomUUID()}.png` } };
  assert.equal(await recoverPaymentSubmission(db, parent, fresh), null);
  const secondId = await submitPayment(db, parent, fresh);
  assert.notEqual(secondId, first);
  await assert.rejects(
    reviewPayment(db, admin, secondId, verification(fresh)),
    (error: unknown) => error instanceof PortalError && error.status === 409 && error.code === "duplicate_transfer",
  );
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM payments").get()!.n, 2);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM payments WHERE status='verified'").get()!.n, 1);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM receipts").get()!.n, 1);
  assert.equal(adapter.sqlite.prepare("SELECT count(*) AS n FROM payment_allocations").get()!.n, input.allocations.length);
});

test("an interrupted atomic submission rolls back all records and can be retried with the original token", async t => {
  const { adapter, db, input } = await setup(t);
  const before = financialSnapshot(adapter);
  adapter.sqlite.exec("CREATE TRIGGER synthetic_file_failure BEFORE INSERT ON payment_files BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END;");
  await assert.rejects(submitPayment(db, parent, input), /synthetic_storage_failure/);
  assert.deepEqual(financialSnapshot(adapter), before);
  assert.equal(await recoverPaymentSubmission(db, parent, input), null);
  adapter.sqlite.exec("DROP TRIGGER synthetic_file_failure");
  assert.equal(await submitPayment(db, parent, input), input.submissionId);
  assertSingleSubmission(adapter, input.submissionId);
});

test("a completed submission does not bypass a subsequently deactivated account", async t => {
  const { adapter, db, input } = await setup(t);
  await submitPayment(db, parent, input);
  adapter.sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(parent.id);
  const before = financialSnapshot(adapter);
  for (const attempt of [recoverPaymentSubmission, submitPayment]) {
    await assert.rejects(attempt(db, parent, input), error => error instanceof PortalError && error.status === 403);
  }
  assert.deepEqual(financialSnapshot(adapter), before);
});

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
));

async function pngInput(input: SubmitPaymentInput): Promise<SubmitPaymentInput> {
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", png)).toString("hex");
  return { ...input, file: { ...input.file, size: png.byteLength, sha256 } };
}

function forbidStorage(db: D1Database) {
  let accesses = 0;
  const env = {
    DB: db,
    SLIPS: new Proxy({}, {
      get() { accesses++; throw new Error("A completed retry must not access object storage"); },
    }),
  } as unknown as Cloudflare.Env;
  return { env, accesses: () => accesses };
}

test("a lost multipart response recovers before reserving another draft or accessing object storage", async t => {
  const { adapter, db, input } = await setup(t);
  const original = await pngInput(input);
  const id = await submitPayment(db, parent, original);
  const before = financialSnapshot(adapter);
  const writes = adapter.executions;
  const bucket = forbidStorage(db);
  const form = new FormData();
  form.set("slip", new File([png], "synthetic.png", { type: "image/png" }));
  assert.equal(await submitPaymentForm(bucket.env, parent, form, input), id);

  const changed = new FormData();
  changed.set("slip", new File([png, new Uint8Array([1])], "changed.png", { type: "image/png" }));
  await assert.rejects(submitPaymentForm(bucket.env, parent, changed, input), isConflict);
  assert.equal(bucket.accesses(), 0);
  assert.equal(adapter.executions, writes);
  assert.deepEqual(financialSnapshot(adapter), before);
});

test("a lost response with an already attached draft recovers without reopening or uploading evidence", async t => {
  const { adapter, db, input } = await setup(t);
  const original = await pngInput(input);
  const draft = await registerSlipDraft(db, parent, original.file);
  const id = await submitPayment(db, parent, original);
  await attachSlipDraft(db, parent, draft.id, id);
  const before = financialSnapshot(adapter);
  const writes = adapter.executions;
  const bucket = forbidStorage(db);
  const form = new FormData();
  form.set("draftId", draft.id);
  assert.equal(await submitPaymentForm(bucket.env, parent, form, input), id);
  assert.equal(bucket.accesses(), 0);
  assert.equal(adapter.executions, writes);
  assert.deepEqual(financialSnapshot(adapter), before);
  assert.equal(adapter.sqlite.prepare("SELECT state FROM slip_drafts").get()!.state, "attached");
});

test("a request recovers when its competing submission attaches the shared draft after a stale lookup", async t => {
  const { adapter, db, input } = await setup(t);
  const original = await pngInput(input);
  const draft = await registerSlipDraft(db, parent, original.file);
  const bucket = forbidStorage(db);
  let committed: ReturnType<typeof financialSnapshot> | undefined;
  let writes = 0;
  adapter.afterMissingPaymentRead = async () => {
    assert.equal(await submitPayment(db, parent, original), input.submissionId);
    await attachSlipDraft(db, parent, draft.id, input.submissionId);
    committed = financialSnapshot(adapter);
    writes = adapter.executions;
  };
  const form = new FormData();
  form.set("draftId", draft.id);
  assert.equal(await submitPaymentForm(bucket.env, parent, form, input), input.submissionId);
  assert.ok(committed, "the competing request must commit after the retry captures a missing payment");
  assertSingleSubmission(adapter, input.submissionId);
  assert.equal(adapter.sqlite.prepare("SELECT state FROM slip_drafts").get()!.state, "attached");
  assert.equal(bucket.accesses(), 0);
  assert.equal(adapter.executions, writes);
  assert.deepEqual(financialSnapshot(adapter), committed);
});

for (const changedField of ["payload", "evidence"] as const) {
  test(`a shared-draft race still rejects different ${changedField} under the same submission token`, async t => {
    const { adapter, db, input } = await setup(t);
    const original = await pngInput(input);
    const draft = await registerSlipDraft(db, parent, original.file);
    const bucket = forbidStorage(db);
    let committed: ReturnType<typeof financialSnapshot> | undefined;
    adapter.afterMissingPaymentRead = async () => {
      await submitPayment(db, parent, original);
      await attachSlipDraft(db, parent, draft.id, input.submissionId);
      committed = financialSnapshot(adapter);
    };
    const form = new FormData();
    form.set("draftId", draft.id);
    if (changedField === "evidence") {
      form.set("slip", new File([png, new Uint8Array([1])], "changed.png", { type: "image/png" }));
    }
    const attempt = changedField === "payload" ? { ...input, note: "A different synthetic note." } : input;
    await assert.rejects(submitPaymentForm(bucket.env, parent, form, attempt), isConflict);
    assert.ok(committed);
    assertSingleSubmission(adapter, input.submissionId);
    assert.equal(bucket.accesses(), 0);
    assert.deepEqual(financialSnapshot(adapter), committed);
  });
}

test("an attached draft retains its original error when this submission has not committed", async t => {
  const { adapter, db, input } = await setup(t);
  const original = await pngInput(input);
  const draft = await registerSlipDraft(db, parent, original.file);
  await submitPayment(db, parent, original);
  await attachSlipDraft(db, parent, draft.id, input.submissionId);
  const before = financialSnapshot(adapter);
  const writes = adapter.executions;
  const bucket = forbidStorage(db);
  const form = new FormData();
  form.set("draftId", draft.id);
  await assert.rejects(submitPaymentForm(bucket.env, parent, form, { ...input, submissionId: crypto.randomUUID() }),
    error => error instanceof PortalError && error.status === 409 && error.code === "draft_expired");
  assert.equal(bucket.accesses(), 0);
  assert.equal(adapter.executions, writes);
  assert.deepEqual(financialSnapshot(adapter), before);
});
