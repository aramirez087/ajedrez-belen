import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { discardEmailDraft, getDraftForSubmission, registerSlipDraft } from "../src/lib/portal/ocr";
import { getParentDashboard, seedDemo, submitPayment } from "../src/lib/portal/domain";
import type { Actor } from "../src/lib/portal/types";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const migration of ["0002_portal.sql", "0003_ocr.sql", "0005_email_inbound.sql", "0006_self_registration.sql", "0011_athlete_approval.sql"])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  prepare(query: string) {
    let values: unknown[] = [];
    const db = this;
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first() { return db.sqlite.prepare(query).get(...(values as never[])) ?? null; },
      async all() { return { results: db.sqlite.prepare(query).all(...(values as never[])), meta: {}, success: true }; },
      async run() { return statement.execute(); },
      execute() {
        return { results: [], success: true, meta: { changes: Number(db.sqlite.prepare(query).run(...(values as never[])).changes) } };
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
  db() { return this as unknown as D1Database; }
}
class Bucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  failDelete = false;
  put(key: string, bytes: ArrayBuffer) { this.objects.set(key, new Uint8Array(bytes).slice()); }
  async delete(key: string) {
    if (this.failDelete) throw new Error("storage unavailable");
    this.deleted.push(key);
    this.objects.delete(key);
  }
  binding() { return this as unknown as R2Bucket; }
}
const parent: Actor = { id: "demo-parent-a", email: "ana@example.invalid", name: "Familia A", isAdmin: false, mode: "demo" };
const second: Actor = { id: "demo-parent-b", email: "diego@example.invalid", name: "Familia B", isAdmin: false, mode: "demo" };
const admin: Actor = { id: "demo-admin", email: "admin@example.invalid", name: "Admin", isAdmin: true, mode: "demo" };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")).buffer;
const sha = async (bytes: ArrayBuffer) => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
type Context = Awaited<ReturnType<typeof setup>>;
async function setup() {
  const adapter = new SQLiteD1();
  const db = adapter.db();
  await seedDemo(db);
  return { adapter, db, bucket: new Bucket() };
}
/** A saved draft that arrived by email: a draft row, its object, and the inbound-mail row that lists it. */
async function emailDraft(ctx: Context, actor: Actor, now = new Date()) {
  const record = await registerSlipDraft(ctx.db, actor, {
    key: `portal/drafts/${crypto.randomUUID()}/original`, type: "image/png", size: png.byteLength, sha256: await sha(png),
  }, now);
  ctx.bucket.put(record.key, png);
  ctx.adapter.sqlite.prepare("INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,?,'draft_created',?)")
    .run(crypto.randomUUID(), `m-${record.id}`, actor.email, actor.id, record.id, now.toISOString());
  return record;
}
const row = (ctx: Context, id: string) =>
  ctx.adapter.sqlite.prepare("SELECT state, cleanup_token FROM slip_drafts WHERE id=?").get(id) as { state: string; cleanup_token: string | null };
const failure = (code: string, status: number) => (e: unknown) =>
  (e as { code: string }).code === code && (e as { status: number }).status === status;

test("discarding an emailed file deletes it and frees its slot", async () => {
  const ctx = await setup();
  const drafts = [];
  for (let i = 0; i < 5; i++) drafts.push(await emailDraft(ctx, parent));
  await assert.rejects(emailDraft(ctx, parent), (e) => (e as { code: string }).code === "draft_limit");
  await discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), drafts[2].id);
  assert.deepEqual(ctx.bucket.deleted, [drafts[2].key]);
  assert.equal(ctx.bucket.objects.has(drafts[2].key), false);
  assert.equal(row(ctx, drafts[2].id).state, "deleted");
  const mail = ctx.adapter.sqlite.prepare("SELECT count(*) AS n FROM email_inbound WHERE draft_id=?").get(drafts[2].id) as { n: number };
  assert.equal(mail.n, 1, "the record of the email stays");
  await emailDraft(ctx, parent); // the slot is free again
});

test("only the owner's emailed drafts can be discarded", async () => {
  const ctx = await setup();
  const mine = await emailDraft(ctx, parent);
  const webOnly = await registerSlipDraft(ctx.db, parent, {
    key: "portal/drafts/web-only/original", type: "image/png", size: png.byteLength, sha256: await sha(png),
  });
  ctx.bucket.put(webOnly.key, png);
  for (const [actor, id] of [[second, mine.id], [admin, mine.id], [parent, webOnly.id], [parent, "does-not-exist"]] as const)
    await assert.rejects(discardEmailDraft(ctx.db, actor, ctx.bucket.binding(), id), failure("draft_not_found", 404));
  assert.deepEqual(ctx.bucket.deleted, []);
  assert.equal(row(ctx, mine.id).state, "draft");
  assert.equal(row(ctx, webOnly.id).state, "draft");
});

test("a file a payment already uses is refused and left untouched", async () => {
  const ctx = await setup();
  const record = await emailDraft(ctx, parent);
  const charge = (await getParentDashboard(ctx.db, parent)).charges[0];
  const metadata = await getDraftForSubmission(ctx.db, parent, record.id);
  await submitPayment(ctx.db, parent, {
    submissionId: crypto.randomUUID(),
    payerName: "Persona confirmada por adulto",
    amountMinor: 100000,
    transferDate: "2026-10-10",
    bankReference: "00000000001234567890123456",
    allocations: [{ chargeId: charge.id, amountMinor: 100000 }],
    file: metadata,
  });
  await assert.rejects(discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id), failure("draft_not_found", 404));
  assert.deepEqual(ctx.bucket.deleted, []);
  assert.equal(ctx.bucket.objects.has(record.key), true);
  assert.equal(row(ctx, record.id).state, "draft");
});

test("discarding the same file twice reports it as gone", async () => {
  const ctx = await setup();
  const record = await emailDraft(ctx, parent);
  await discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id);
  await assert.rejects(discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id), failure("draft_not_found", 404));
  assert.equal(ctx.bucket.deleted.length, 1);
});

test("a storage failure puts the file back so it can be discarded again", async () => {
  const ctx = await setup();
  const drafts = [];
  for (let i = 0; i < 5; i++) drafts.push(await emailDraft(ctx, parent));
  ctx.bucket.failDelete = true;
  await assert.rejects(discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), drafts[0].id), failure("draft_discard_failed", 503));
  assert.deepEqual({ ...row(ctx, drafts[0].id) }, { state: "draft", cleanup_token: null });
  assert.equal(ctx.bucket.objects.has(drafts[0].key), true);
  await assert.rejects(emailDraft(ctx, parent), (e) => (e as { code: string }).code === "draft_limit"); // still holds its slot
  ctx.bucket.failDelete = false;
  await discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), drafts[0].id);
  assert.equal(row(ctx, drafts[0].id).state, "deleted");
});

test("a read of the file in progress blocks the discard until its claim lapses", async () => {
  const ctx = await setup();
  const record = await emailDraft(ctx, parent);
  const claim = (id: string, token: string, expires: Date) =>
    ctx.adapter.sqlite.prepare("INSERT INTO slip_extractions(id,draft_id,owner_id,file_sha256,source_kind,source_sha256,mode,status,claim_token,claim_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, record.id, parent.id, "a".repeat(64), "original", "a".repeat(64), "demo", "sending", token, expires.toISOString(), new Date().toISOString());
  claim("ext-live", "claim-live", new Date(Date.now() + 60000));
  await assert.rejects(discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id), failure("draft_busy", 409));
  assert.equal(row(ctx, record.id).state, "draft");
  assert.deepEqual(ctx.bucket.deleted, []);
  ctx.adapter.sqlite.prepare("DELETE FROM slip_extractions WHERE id='ext-live'").run();
  claim("ext-lapsed", "claim-lapsed", new Date(Date.now() - 60000));
  await discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id);
  assert.equal(row(ctx, record.id).state, "deleted");
});

test("an expired file that was never cleaned can still be discarded", async () => {
  const ctx = await setup();
  const record = await emailDraft(ctx, parent, new Date(Date.now() - 3 * 3600000));
  await discardEmailDraft(ctx.db, parent, ctx.bucket.binding(), record.id);
  assert.equal(row(ctx, record.id).state, "deleted");
  assert.deepEqual(ctx.bucket.deleted, [record.key]);
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the discard route is guarded, reports a vanished file calmly and returns to the dashboard", () => {
  const route = read("src/pages/api/portal/slips/[id]/discard.ts");
  assert.match(route, /portalMutation\(\s*context, env, \{ back: '\/portal' \}/);
  assert.match(route, /discardEmailDraft\(env\.DB, actor, env\.SLIPS, context\.params\.id \?\? ''\)/);
  assert.match(route, /error\.code === 'draft_not_found'\) return successRedirect\('\/portal', 'draft_gone'\)/);
  assert.match(route, /successRedirect\('\/portal', 'draft_discarded'\)/);
});

test("every code the discard route can send has a plain message", () => {
  const notice = read("src/components/portal/Notice.astro");
  const http = read("src/lib/portal/http.ts");
  for (const code of ["draft_discarded", "draft_gone", "draft_busy", "draft_discard_failed"])
    assert.match(notice, new RegExp(`\\b${code}:`), `Notice.astro lacks ${code}`);
  for (const code of ["draft_busy", "draft_discard_failed"])
    assert.match(http, new RegExp(`'${code}'`), `http.ts errorCodes lacks ${code}`);
});

test("every emailed file on the dashboard offers a confirmed discard", () => {
  const page = read("src/pages/portal/index.astro");
  assert.equal((page.match(/<DiscardDraft /g) ?? []).length, 3, "list rows (finish), the single-file variant and list rows (nothing owed)");
  const component = read("src/components/portal/DiscardDraft.astro");
  assert.match(component, /action=\{`\/api\/portal\/slips\/\$\{encodeURIComponent\(id\)\}\/discard`\}/);
  assert.match(component, /method="post"/);
  assert.match(component, /data-confirm="¿Descartar este comprobante\? Se borra el archivo\. Si ya transferiste, tendrás que enviarlo otra vez para registrar el pago\."/);
});

test("cancelling a confirmation leaves the form usable", () => {
  const layout = read("src/layouts/PortalLayout.astro");
  const handler = layout.match(/form\.addEventListener\('submit', event => \{\s*if \(pending\)[\s\S]*?status\.textContent = 'Enviando…[^\n]*\n\s*\}[^\n]*\n/)?.[0] ?? "";
  assert.ok(handler, "the submit-status handler was found");
  // A microtask runs between two listeners of a click-driven submit, before the confirmation
  // listener cancels it, so the form was marked as sending and stayed disabled after "Volver".
  assert.doesNotMatch(handler, /queueMicrotask/);
  assert.match(handler, /setTimeout\(\(\) => \{/);
});
