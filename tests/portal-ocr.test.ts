import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  assertCanUploadSlip,
  attachSlipDraft,
  cleanupExpiredDrafts,
  cleanupOwnExpiredDrafts,
  getDraftForSubmission,
  getLatestExtraction,
  getPaymentExtractions,
  getSlipDraft,
  registerSlipDraft,
  requestSlipExtraction,
  type OcrEnvironment,
} from "../src/lib/portal/ocr";
import {
  getParentDashboard,
  getPaymentDetail,
  reviewPayment,
  revisePayment,
  seedDemo,
  submitPayment,
} from "../src/lib/portal/domain";
import type { Actor } from "../src/lib/portal/types";
import { DEFAULT_GROQ_VISION_MODEL } from "../src/lib/portal/ocr-provider";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const migration of ["0002_portal.sql", "0003_ocr.sql", "0006_self_registration.sql"])
      this.sqlite.exec(
        readFileSync(
          new URL(`../migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      );
  }
  prepare(query: string) {
    let values: unknown[] = [];
    const db = this;
    const statement = {
      bind(...args: unknown[]) {
        values = args;
        return statement;
      },
      async first() {
        return db.sqlite.prepare(query).get(...(values as never[])) ?? null;
      },
      async all() {
        return {
          results: db.sqlite.prepare(query).all(...(values as never[])),
          meta: {},
          success: true,
        };
      },
      async run() {
        return statement.execute();
      },
      execute() {
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(
              db.sqlite.prepare(query).run(...(values as never[])).changes,
            ),
          },
        };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sqlite.exec("ROLLBACK");
      throw cause;
    }
  }
  db() {
    return this as unknown as D1Database;
  }
}
class Bucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  put(key: string, bytes: ArrayBuffer) {
    this.objects.set(key, new Uint8Array(bytes).slice());
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    return bytes
      ? {
          size: bytes.byteLength,
          arrayBuffer: async () => bytes.slice().buffer,
        }
      : null;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  binding() {
    return this as unknown as R2Bucket;
  }
}
const parent: Actor = {
  id: "demo-parent-a",
  email: "ana@example.invalid",
  name: "Familia A",
  isAdmin: false,
  mode: "demo",
};
const second: Actor = {
  id: "demo-parent-b",
  email: "diego@example.invalid",
  name: "Familia B",
  isAdmin: false,
  mode: "demo",
};
const admin: Actor = {
  id: "demo-admin",
  email: "admin@example.invalid",
  name: "Admin",
  isAdmin: true,
  mode: "demo",
};
const liveActor: Actor = { ...parent, mode: "workos" };
const original = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  ),
).buffer;
const suggestions = {
  amount: "12000.00",
  currency: "CRC",
  transferDate: "2026-10-08",
  payerName: "Persona legible",
  bankReference: "000020261010283002453950810",
  description: "Atleta legible",
  warnings: [],
};
const providerResponse = () =>
  Response.json({
    model: DEFAULT_GROQ_VISION_MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(suggestions) },
      },
    ],
  });
const sha = async (bytes: ArrayBuffer) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
async function setup() {
  const adapter = new SQLiteD1(),
    db = adapter.db(),
    bucket = new Bucket();
  await seedDemo(db);
  return { db, adapter, bucket };
}
async function draft(
  context: Awaited<ReturnType<typeof setup>>,
  actor = parent,
  bytes = original,
  type = "image/png",
  now = new Date(),
) {
  const record = await registerSlipDraft(
    context.db,
    actor,
    {
      key: `portal/drafts/${crypto.randomUUID()}`,
      type,
      size: bytes.byteLength,
      sha256: await sha(bytes),
    },
    now,
  );
  context.bucket.put(record.key, bytes);
  return record;
}
const demo = (bucket: Bucket): OcrEnvironment => ({
  SLIPS: bucket.binding(),
  OCR_MODE: "demo",
});
const groq = (bucket: Bucket): OcrEnvironment => ({
  SLIPS: bucket.binding(),
  OCR_MODE: "groq",
  GROQ_API_KEY: "synthetic-key",
});
test("original drafts are immutable, user-bound, and require an active enrollment", async () => {
  const ctx = await setup(),
    record = await draft(ctx);
  assert.equal(
    (await getSlipDraft(ctx.db, parent, record.id)).sha256,
    await sha(original),
  );
  await assert.rejects(
    getSlipDraft(ctx.db, second, record.id),
    (e) => (e as { status: number }).status === 404,
  );
  await assert.rejects(
    getSlipDraft(ctx.db, admin, record.id),
    (e) => (e as { status: number }).status === 404,
  );
  assert.throws(
    () =>
      ctx.adapter.sqlite
        .prepare("UPDATE slip_drafts SET file_sha256=? WHERE id=?")
        .run("b".repeat(64), record.id),
    /immutable_draft_evidence/,
  );
  ctx.adapter.sqlite
    .prepare("UPDATE guardian_links SET active=0 WHERE user_id=?")
    .run(parent.id);
  await assert.rejects(
    assertCanUploadSlip(ctx.db, parent),
    (e) => (e as { status: number }).status === 403,
  );
});
test("reservation before R2 put tracks missing originals and blocks OCR until exact bytes exist", async () => {
  const ctx = await setup();
  const record = await registerSlipDraft(ctx.db, parent, {
    key: `portal/drafts/${crypto.randomUUID()}`,
    type: "image/png",
    size: original.byteLength,
    sha256: await sha(original),
  });
  await assert.rejects(
    requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
      demoAllowed: true,
    }),
    (e) => (e as { code: string }).code === "original_missing",
  );
  const changed = new Uint8Array(original).slice();
  changed[changed.length - 1] ^= 1;
  ctx.bucket.put(record.key, changed.buffer);
  await assert.rejects(
    requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
      demoAllowed: true,
    }),
    (e) => (e as { code: string }).code === "invalid_image",
  );
  ctx.bucket.put(record.key, original);
  assert.equal(
    (
      await requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
        demoAllowed: true,
      })
    ).status,
    "ready",
  );
});
test("demo extraction is fixed and conspicuous; production mode rejects demo before provider access", async () => {
  const ctx = await setup(),
    record = await draft(ctx);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error("Must not fetch");
  };
  await assert.rejects(
    requestSlipExtraction(ctx.db, parent, record.id, groq(ctx.bucket), {
      fetcher,
    }),
    (e) => (e as { status: number }).status === 403,
  );
  await assert.rejects(
    requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
      fetcher,
    }),
    (e) => (e as { status: number }).status === 403,
  );
  await assert.rejects(
    requestSlipExtraction(ctx.db, liveActor, record.id, demo(ctx.bucket), {
      demoAllowed: true,
      fetcher,
    }),
    (e) => (e as { status: number }).status === 403,
  );
  const result = await requestSlipExtraction(
    ctx.db,
    parent,
    record.id,
    demo(ctx.bucket),
    { demoAllowed: true, fetcher },
  );
  assert.equal(result.status, "ready");
  assert.equal(result.mode, "demo");
  assert.equal(result.model, "fixed-demo-fixture");
  assert.deepEqual(result.suggestions?.warnings, ["demo_fixture"]);
  assert.equal(calls, 0);
});
test("live extraction uses saved original bytes and preserves exact reference as a suggestion only", async () => {
  const ctx = await setup(),
    record = await draft(ctx);
  let calls = 0;
  const result = await requestSlipExtraction(
    ctx.db,
    liveActor,
    record.id,
    groq(ctx.bucket),
    {
      fetcher: async (_url, init) => {
        calls++;
        const payload = JSON.parse(String(init?.body));
        const image = payload.messages
          .find((m: { role: string }) => m.role === "user")
          .content.find((p: { type: string }) => p.type === "image_url")
          .image_url.url;
        assert.equal(
          image,
          `data:image/png;base64,${Buffer.from(original).toString("base64")}`,
        );
        return providerResponse();
      },
    },
  );
  assert.equal(result.status, "ready");
  assert.equal(result.suggestions?.bankReference, suggestions.bankReference);
  assert.equal(calls, 1);
  assert.equal(
    (
      ctx.adapter.sqlite.prepare("SELECT count(*) n FROM payments").get() as {
        n: number;
      }
    ).n,
    0,
  );
  assert.deepEqual(
    (await ctx.bucket.get(record.key)) &&
      new Uint8Array(await (await ctx.bucket.get(record.key))!.arrayBuffer()),
    new Uint8Array(original),
  );
});
test("ready extraction is cached only for same adult, original hash, derivative hash and mode", async () => {
  const ctx = await setup(),
    first = await draft(ctx);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return providerResponse();
  };
  await requestSlipExtraction(ctx.db, liveActor, first.id, groq(ctx.bucket), {
    fetcher,
  });
  const next = await draft(ctx);
  const cached = await requestSlipExtraction(
    ctx.db,
    liveActor,
    next.id,
    groq(ctx.bucket),
    { fetcher },
  );
  assert.equal(cached.draftId, next.id);
  assert.equal(calls, 1);
  const other = await draft(ctx, second);
  await requestSlipExtraction(
    ctx.db,
    { ...second, mode: "workos" },
    other.id,
    groq(ctx.bucket),
    { fetcher },
  );
  assert.equal(calls, 2);
});
test("PDF derivative is separate from retained original and tied to its source hash", async () => {
  const ctx = await setup(),
    pdf = new TextEncoder().encode(
      "%PDF-1.4\nSynthetic original PDF evidence.\n%%EOF",
    ).buffer,
    record = await draft(ctx, parent, pdf, "application/pdf");
  await assert.rejects(
    requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
      demoAllowed: true,
    }),
    (e) => (e as { code: string }).code === "ocr_pdf_preview_required",
  );
  const result = await requestSlipExtraction(
    ctx.db,
    parent,
    record.id,
    demo(ctx.bucket),
    {
      demoAllowed: true,
      derivedImage: { bytes: original, contentType: "image/png" },
    },
  );
  assert.equal(result.sourceKind, "pdf_preview");
  assert.equal(result.sourceSha256, await sha(original));
  assert.equal(
    (await getSlipDraft(ctx.db, parent, record.id)).sha256,
    await sha(pdf),
  );
  assert.deepEqual(
    new Uint8Array(await (await ctx.bucket.get(record.key))!.arrayBuffer()),
    new Uint8Array(pdf),
  );
});
test("one active live claim prevents simultaneous provider calls; quotas reserve atomically", async () => {
  const ctx = await setup(),
    first = await draft(ctx),
    next = await draft(ctx);
  let finish!: (response: Response) => void;
  let started!: () => void;
  const signal = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = requestSlipExtraction(
    ctx.db,
    liveActor,
    first.id,
    groq(ctx.bucket),
    {
      fetcher: async () => {
        started();
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    },
  );
  await signal;
  await assert.rejects(
    requestSlipExtraction(ctx.db, liveActor, next.id, groq(ctx.bucket), {
      fetcher: async () => {
        throw new Error("Should not fetch");
      },
    }),
    (e) => (e as { code: string }).code === "ocr_busy",
  );
  finish(providerResponse());
  await pending;
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare("SELECT attempts FROM ocr_daily_budget WHERE scope='global'")
        .get() as { attempts: number }
    ).attempts,
    1,
  );
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare("SELECT count(*) n FROM slip_extractions")
        .get() as { n: number }
    ).n,
    1,
  );
});
test("global/day, per-adult/day and minute budgets are enforced without another provider request", async () => {
  const ctx = await setup(),
    record = await draft(ctx),
    now = new Date(),
    stamp = now.toISOString(),
    day = stamp.slice(0, 10),
    minute = stamp.slice(0, 16);
  ctx.adapter.sqlite
    .prepare(
      "INSERT INTO ocr_daily_budget(day,scope,attempts) VALUES(?,'global',49)",
    )
    .run(day);
  ctx.adapter.sqlite
    .prepare("INSERT INTO ocr_daily_budget(day,scope,attempts) VALUES(?,?,9)")
    .run(day, `user:${parent.id}`);
  ctx.adapter.sqlite
    .prepare("INSERT INTO ocr_minute_budget(minute,attempts) VALUES(?,1)")
    .run(minute);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ error: { message: "synthetic" } }, { status: 503 });
  };
  await requestSlipExtraction(ctx.db, liveActor, record.id, groq(ctx.bucket), {
    fetcher,
    now,
  });
  await assert.rejects(
    requestSlipExtraction(ctx.db, liveActor, record.id, groq(ctx.bucket), {
      fetcher,
      now,
    }),
    (e) => (e as { code: string }).code === "ocr_limit",
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare("SELECT attempts FROM ocr_daily_budget WHERE scope='global'")
        .get() as { attempts: number }
    ).attempts,
    50,
  );
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare("SELECT attempts FROM ocr_daily_budget WHERE scope=?")
        .get(`user:${parent.id}`) as { attempts: number }
    ).attempts,
    10,
  );
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare("SELECT attempts FROM ocr_minute_budget")
        .get() as { attempts: number }
    ).attempts,
    2,
  );
});
test("failed extraction does not lose original or retry automatically, and each draft is bounded to three attempts", async (t) => {
  // This test advances three minutes inside one daily retry budget. Pin the
  // whole fixture to midday so running near UTC midnight cannot reset it.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
  const ctx = await setup(),
    record = await draft(ctx);
  let calls = 0;
  const start = new Date();
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error("network timeout");
  };
  for (let i = 0; i < 3; i++) {
    const result = await requestSlipExtraction(
      ctx.db,
      liveActor,
      record.id,
      groq(ctx.bucket),
      { fetcher, now: new Date(start.getTime() + i * 60000) },
    );
    assert.equal(result.status, "failed");
    assert.ok(ctx.bucket.objects.has(record.key));
  }
  await assert.rejects(
    requestSlipExtraction(ctx.db, liveActor, record.id, groq(ctx.bucket), {
      fetcher,
      now: new Date(start.getTime() + 180000),
    }),
    (e) => (e as { code: string }).code === "ocr_limit",
  );
  assert.equal(calls, 3);
  assert.equal(
    (await getDraftForSubmission(ctx.db, parent, record.id)).key,
    record.key,
  );
});
test("expired reservations count toward quota until cleanup and owner cleanup never touches another adult", async () => {
  const ctx = await setup(),
    past = new Date(Date.now() - 3 * 3600000);
  for (let i = 0; i < 5; i++)
    await draft(ctx, parent, original, "image/png", past);
  const other = await draft(ctx, second, original, "image/png", past);
  await assert.rejects(
    draft(ctx),
    (e) => (e as { code: string }).code === "draft_limit",
  );
  const result = await cleanupOwnExpiredDrafts(
    ctx.db,
    parent,
    ctx.bucket.binding(),
  );
  assert.equal(result.deleted, 5);
  assert.ok(ctx.bucket.objects.has(other.key));
  assert.equal(ctx.bucket.deleted.length, 5);
  await draft(ctx);
});
test("submitted evidence is preserved even if attach follow-up crashes; OCR is retained separately with the file", async () => {
  const ctx = await setup(),
    record = await draft(ctx);
  await requestSlipExtraction(ctx.db, parent, record.id, demo(ctx.bucket), {
    demoAllowed: true,
  });
  const charge = (await getParentDashboard(ctx.db, parent)).charges[0];
  const metadata = await getDraftForSubmission(ctx.db, parent, record.id);
  const paymentId = await submitPayment(ctx.db, parent, {
    submissionId: crypto.randomUUID(),
    payerName: "Persona confirmada por adulto",
    amountMinor: 100000,
    transferDate: "2026-10-10",
    bankReference: "00000000001234567890123456",
    allocations: [{ chargeId: charge.id, amountMinor: 100000 }],
    file: metadata,
  });
  await assert.rejects(
    getDraftForSubmission(ctx.db, parent, record.id),
    (e) => (e as { code: string }).code === "draft_expired",
  );
  const future = new Date(Date.now() + 3 * 3600000);
  const cleaned = await cleanupExpiredDrafts(
    ctx.db,
    admin,
    ctx.bucket.binding(),
    20,
    future,
  );
  assert.equal(cleaned.retained, 1);
  assert.equal(cleaned.deleted, 0);
  assert.ok(ctx.bucket.objects.has(record.key));
  assert.equal(
    (await getSlipDraft(ctx.db, parent, record.id)).state,
    "attached",
  );
  await attachSlipDraft(ctx.db, parent, record.id, paymentId);
  await attachSlipDraft(ctx.db, parent, record.id, paymentId);
  await assert.rejects(
    attachSlipDraft(ctx.db, parent, record.id, "different-payment-id"),
    (e) => (e as { code: string }).code === "draft_expired",
  );
  const extraction = (await getPaymentExtractions(ctx.db, admin, paymentId))[0];
  assert.equal(extraction.revision, 1);
  assert.equal(extraction.extraction.suggestions?.amount, "12000.00");
  assert.equal(
    (await getPaymentDetail(ctx.db, parent, paymentId)).payment.amountMinor,
    100000,
  );
  assert.deepEqual(
    await getPaymentExtractions(ctx.db, second, paymentId).catch(() => []),
    [],
  );
  assert.throws(
    () =>
      ctx.adapter.sqlite
        .prepare("UPDATE slip_drafts SET state='deleting' WHERE id=?")
        .run(record.id),
    /financial_evidence_referenced/,
  );
});
test("revision original and OCR metadata survive independently, including administrator-authored corrections", async () => {
  const ctx = await setup(),
    first = await draft(ctx);
  const charge = (await getParentDashboard(ctx.db, parent)).charges[0];
  const fields = {
    payerName: "Persona original",
    amountMinor: 100000,
    transferDate: "2026-10-10",
    bankReference: "00000000001234567890123456",
    allocations: [{ chargeId: charge.id, amountMinor: 100000 }],
  };
  const paymentId = await submitPayment(ctx.db, parent, {
    submissionId: crypto.randomUUID(),
    ...fields,
    file: await getDraftForSubmission(ctx.db, parent, first.id),
  });
  await attachSlipDraft(ctx.db, parent, first.id, paymentId);
  await reviewPayment(ctx.db, admin, paymentId, {
    action: "needs_info",
    expectedRevision: 1, expectedStatus: "pending", expectedReviewNote: null,
    reason: "Corregir respaldo.",
  });
  const correction = await draft(ctx, admin);
  await requestSlipExtraction(ctx.db, admin, correction.id, demo(ctx.bucket), {
    demoAllowed: true,
  });
  await revisePayment(ctx.db, admin, paymentId, {
    expectedRevision: 1, expectedStatus: "needs_info", expectedReviewNote: "Corregir respaldo.",
    ...fields,
    payerName: "Persona corregida",
    note: "Corrección administrativa documentada.",
    file: await getDraftForSubmission(ctx.db, admin, correction.id),
  });
  await attachSlipDraft(ctx.db, admin, correction.id, paymentId);
  assert.equal(
    (await getPaymentDetail(ctx.db, admin, paymentId)).files.length,
    2,
  );
  assert.equal(
    (await getPaymentExtractions(ctx.db, admin, paymentId))[0].revision,
    2,
  );
  assert.ok(
    ctx.bucket.objects.has(first.key) && ctx.bucket.objects.has(correction.key),
  );
});
test("finished suggestions are immutable and an inactive athlete can still have arrears paid", async () => {
  const ctx = await setup();
  ctx.adapter.sqlite.prepare("UPDATE athletes SET active=0").run();
  await assertCanUploadSlip(ctx.db, parent);
  const record = await draft(ctx);
  const result = await requestSlipExtraction(
    ctx.db,
    parent,
    record.id,
    demo(ctx.bucket),
    { demoAllowed: true },
  );
  assert.throws(
    () =>
      ctx.adapter.sqlite
        .prepare("UPDATE slip_extractions SET suggestions_json='{}' WHERE id=?")
        .run(result.id),
    /immutable_finished_extraction/,
  );
  assert.equal(
    (await getLatestExtraction(ctx.db, parent, record.id))?.id,
    result.id,
  );
});
test("each provider quota independently blocks a request before credentials or network are used", async () => {
  for (const scope of ["global", "user", "minute"]) {
    const ctx = await setup(),
      record = await draft(ctx),
      now = new Date(),
      stamp = now.toISOString();
    if (scope === "minute")
      ctx.adapter.sqlite
        .prepare("INSERT INTO ocr_minute_budget(minute,attempts) VALUES(?,2)")
        .run(stamp.slice(0, 16));
    else
      ctx.adapter.sqlite
        .prepare(
          "INSERT INTO ocr_daily_budget(day,scope,attempts) VALUES(?,?,?)",
        )
        .run(
          stamp.slice(0, 10),
          scope === "global" ? "global" : `user:${parent.id}`,
          scope === "global" ? 50 : 10,
        );
    let calls = 0;
    await assert.rejects(
      requestSlipExtraction(ctx.db, liveActor, record.id, groq(ctx.bucket), {
        now,
        fetcher: async () => {
          calls++;
          return providerResponse();
        },
      }),
      (e) => (e as { code: string }).code === "ocr_limit",
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        ctx.adapter.sqlite
          .prepare("SELECT count(*) n FROM slip_extractions")
          .get() as { n: number }
      ).n,
      0,
    );
  }
});
test("an interrupted provider lease requires a deliberate request after sixty seconds", async () => {
  const ctx = await setup(),
    record = await draft(ctx),
    now = new Date();
  ctx.adapter.sqlite
    .prepare(
      "INSERT INTO slip_extractions(id,draft_id,owner_id,file_sha256,source_kind,source_sha256,mode,status,claim_token,claim_expires_at,created_at) VALUES(?,?,?,?, 'original',?,'groq','sending',?,?,?)",
    )
    .run(
      crypto.randomUUID(),
      record.id,
      parent.id,
      record.sha256,
      record.sha256,
      crypto.randomUUID(),
      new Date(now.getTime() + 60000).toISOString(),
      now.toISOString(),
    );
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return providerResponse();
  };
  await assert.rejects(
    requestSlipExtraction(ctx.db, liveActor, record.id, groq(ctx.bucket), {
      now,
      fetcher,
    }),
    (e) => (e as { code: string }).code === "ocr_busy",
  );
  assert.equal(calls, 0);
  const resumed = await requestSlipExtraction(
    ctx.db,
    liveActor,
    record.id,
    groq(ctx.bucket),
    { now: new Date(now.getTime() + 60001), fetcher },
  );
  assert.equal(resumed.status, "ready");
  assert.equal(calls, 1);
  assert.equal(
    (
      ctx.adapter.sqlite
        .prepare(
          "SELECT count(*) n FROM slip_extractions WHERE error_code='interrupted'",
        )
        .get() as { n: number }
    ).n,
    1,
  );
});
test("aggregate unreferenced reservation budget remains bounded across different adults", async () => {
  const ctx = await setup();
  for (let adult = 0; adult < 7; adult++) {
    ctx.adapter.sqlite
      .prepare(
        "INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      )
      .run(
        `budget-adult-${adult}`,
        `budget-${adult}@example.invalid`,
        "Adulto de prueba",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    ctx.adapter.sqlite
      .prepare(
        "INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,'demo-athlete-1',1,0,'demo-admin',?,?)",
      )
      .run(
        `budget-adult-${adult}`,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  }
  let registered = 0;
  for (let i = 0; i < 34; i++) {
    const actor: Actor = {
      id: `budget-adult-${Math.floor(i / 5)}`,
      email: `budget-${Math.floor(i / 5)}@example.invalid`,
      name: "Adulto de prueba",
      isAdmin: false,
      mode: "demo",
    };
    const create = () =>
      registerSlipDraft(ctx.db, actor, {
        key: `portal/budget/${i}`,
        type: "image/png",
        size: 3145728,
        sha256: "a".repeat(64),
      });
    if (i === 33)
      await assert.rejects(
        create(),
        (e) => (e as { code: string }).code === "draft_limit",
      );
    else {
      await create();
      registered++;
    }
  }
  assert.equal(registered, 33);
  assert.ok(
    (
      ctx.adapter.sqlite
        .prepare("SELECT sum(file_size) n FROM slip_drafts")
        .get() as { n: number }
    ).n <= 104857600,
  );
});
