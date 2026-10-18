# Families Can Discard an Emailed File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family can remove one of its own emailed files from its dashboard, and expired emailed files stop blocking new emails.

**Architecture:** `discardEmailDraft` in `src/lib/portal/ocr.ts` reuses the cleanup's safe sequence (claim row → delete object → mark deleted) for one draft, undoing the claim if storage fails. A `POST /api/portal/slips/[id]/discard` route wraps it with `portalMutation`. The dashboard panel gets a confirmed "Descartar" form per file. The email worker runs the sender's expired-draft cleanup before saving a new file.

**Tech Stack:** Astro 7 on Cloudflare Workers, D1 (SQLite), R2, Email Worker, node:test with a `node:sqlite` D1 shim.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-discard-emailed-drafts-design.md`.
- No schema migration, no audit event. The `slip_drafts` row stays with `state='deleted'`.
- Only the actor's own, emailed (`email_inbound` row), `state='draft'` files can be discarded. A file referenced by `payment_files` can never be discarded.
- No row is ever left in `state='deleting'` by a failed discard.
- Spanish copy, tú form, one or two short sentences per block.
- Every new error code goes in `errorCodes` in `src/lib/portal/http.ts` and has a message in `src/components/portal/Notice.astro` (a test enforces this).
- Owner's instruction for this work: commit and push when everything is verified, in three commits (discard feature = Tasks 1–3, worker = Task 4, spec and plan with the first). Stage files by name; never `git add -A` (the untracked `videos/` folder is not ours). Verify with `npm test`, `npm run check`, `npm run test:portal` (dev server on `http://127.0.0.1:4400`) and `npm run build`.

---

### Task 1: `discardEmailDraft`

**Files:**
- Create: `tests/portal-draft-discard.test.ts`
- Modify: `src/lib/portal/ocr.ts` (add after `cleanupOwnExpiredDrafts`, end of file)

**Interfaces:**
- Consumes (already in `ocr.ts`): `sql(db, query, values)`, `error(status, code): never`, `draftColumns`, `assertCanUploadSlip(db, actor)`, `SlipDraft`.
- Produces: `discardEmailDraft(db: D1Database, actor: Actor, bucket: R2Bucket, draftId: string, now = new Date()): Promise<void>`. Throws `PortalError` codes: `draft_not_found` (404), `draft_busy` (409), `draft_discard_failed` (503), or `forbidden` (403) from `assertCanUploadSlip`.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal-draft-discard.test.ts`:

```ts
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
    for (const migration of ["0002_portal.sql", "0003_ocr.sql", "0005_email_inbound.sql", "0006_self_registration.sql"])
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
  assert.deepEqual(row(ctx, drafts[0].id), { state: "draft", cleanup_token: null });
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/portal-draft-discard.test.ts`
Expected: FAIL with `SyntaxError: ... does not provide an export named 'discardEmailDraft'`.

- [ ] **Step 3: Implement** — append to `src/lib/portal/ocr.ts`:

```ts
/**
 * A family removes one of its own emailed files. It follows the expiry cleanup's safe sequence
 * (claim the row, delete the object, finish) for one draft that has not expired. If storage
 * fails the claim is undone, so no row is ever left half-deleted. A file a payment references
 * can never be discarded: the claim excludes it and a database trigger backs that up.
 */
export async function discardEmailDraft(
  db: D1Database,
  actor: Actor,
  bucket: R2Bucket,
  draftId: string,
  now = new Date(),
): Promise<void> {
  await assertCanUploadSlip(db, actor);
  const draft = await sql(
    db,
    `SELECT ${draftColumns} FROM slip_drafts WHERE id=? AND owner_id=? AND state='draft' AND EXISTS(SELECT 1 FROM email_inbound WHERE draft_id=slip_drafts.id)`,
    [draftId, actor.id],
  ).first<SlipDraft>();
  if (!draft) error(404, "draft_not_found");
  const token = crypto.randomUUID();
  const claim = await sql(
    db,
    "UPDATE slip_drafts SET state='deleting',cleanup_token=? WHERE id=? AND owner_id=? AND state='draft' AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key) AND NOT EXISTS(SELECT 1 FROM slip_extractions WHERE draft_id=slip_drafts.id AND status='sending' AND claim_expires_at>?)",
    [token, draft.id, actor.id, now.toISOString()],
  ).run();
  if (!claim.meta.changes) {
    // A file a payment already uses is no longer a loose draft; otherwise only a read in flight can block.
    if (await sql(db, "SELECT 1 AS ok FROM payment_files WHERE file_key=?", [draft.key]).first()) error(404, "draft_not_found");
    if (await sql(db, "SELECT 1 AS ok FROM slip_drafts WHERE id=? AND state='draft'", [draft.id]).first()) error(409, "draft_busy");
    error(404, "draft_not_found");
  }
  try {
    await bucket.delete(draft.key);
    const finished = await sql(
      db,
      "UPDATE slip_drafts SET state='deleted' WHERE id=? AND cleanup_token=? AND state='deleting' AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key)",
      [draft.id, token],
    ).run();
    if (!finished.meta.changes) throw new Error("discard_not_finished");
  } catch {
    // Put the row back so the file stays listed and can be tried again; nothing is left in 'deleting'.
    await sql(
      db,
      "UPDATE slip_drafts SET state='draft',cleanup_token=NULL WHERE id=? AND cleanup_token=? AND state='deleting'",
      [draft.id, token],
    ).run().catch(() => undefined);
    error(503, "draft_discard_failed");
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/portal-draft-discard.test.ts`
Expected: 7 tests pass. Then `npm test` stays green.

---

### Task 2: Route, error codes and messages

**Files:**
- Create: `src/pages/api/portal/slips/[id]/discard.ts`
- Modify: `src/lib/portal/http.ts` (the `errorCodes` set), `src/components/portal/Notice.astro` (the `errors` and `notices` maps)
- Test: `tests/portal-draft-discard.test.ts` (append)

**Interfaces:**
- Consumes: `discardEmailDraft` (Task 1), `portalMutation`, `successRedirect`, `PortalError`.
- Produces: `POST /api/portal/slips/{id}/discard` → 303 to `/portal?notice=draft_discarded` | `/portal?notice=draft_gone` | `/portal?error=<code>`. Codes `draft_busy`, `draft_discard_failed` (errors); `draft_discarded`, `draft_gone` (notices).

- [ ] **Step 1: Append the failing tests** to `tests/portal-draft-discard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/portal-draft-discard.test.ts`
Expected: the two new tests FAIL (file not found / missing codes); the first seven still pass.

- [ ] **Step 3: Implement**

Create `src/pages/api/portal/slips/[id]/discard.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { discardEmailDraft } from '../../../../../lib/portal/ocr';
import { successRedirect } from '../../../../../lib/portal/http';
import { portalMutation } from '../../../../../lib/portal/routes';
import { PortalError } from '../../../../../lib/portal/types';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(
  context, env, { back: '/portal' }, async actor => {
    try {
      await discardEmailDraft(env.DB, actor, env.SLIPS, context.params.id ?? '');
    } catch (error) {
      // Already gone (double click, a second tab, or it became part of a payment): say so, not an error.
      if (error instanceof PortalError && error.code === 'draft_not_found') return successRedirect('/portal', 'draft_gone');
      throw error;
    }
    return successRedirect('/portal', 'draft_discarded');
  },
);
```

In `src/lib/portal/http.ts`, change the `'draft_not_found','draft_expired','draft_limit',` line of `errorCodes` to:

```ts
  'draft_not_found','draft_expired','draft_limit','draft_busy','draft_discard_failed',
  'ocr_disabled','ocr_busy','ocr_limit',
```
(i.e. insert `'draft_busy','draft_discard_failed',` after `'draft_limit',` and keep the rest of that line's codes as they are).

In `src/components/portal/Notice.astro`, add to the `errors` map after the `draft_limit:` line:

```ts
  draft_busy: 'Se está leyendo ese archivo. Espera unos segundos y vuelve a intentarlo.',
  draft_discard_failed: 'No pudimos descartarlo ahora. Inténtalo otra vez; si se repite, escríbenos por WhatsApp.',
```

and to the `notices` map after the `drafts_cleaned:` line:

```ts
  draft_discarded: 'Comprobante descartado.',
  draft_gone: 'Ese comprobante ya no estaba en la lista.',
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/portal-draft-discard.test.ts tests/portal-plain-ux.test.ts` → all pass (the registry test now covers the new codes). Then `npm run check` → 0 errors.

---

### Task 3: Dashboard "Descartar"

**Files:**
- Create: `src/components/portal/DiscardDraft.astro`
- Modify: `src/pages/portal/index.astro` (import; three places in the emailed-files panels), `src/styles/portal-ux.css` (append)
- Test: `tests/portal-draft-discard.test.ts` (append)

**Interfaces:**
- Consumes: the route from Task 2; `.portal-quiet-action` and the layout's `form[data-confirm]` dialog (both exist).
- Produces: `<DiscardDraft id={string} label?={string} />`.

- [ ] **Step 1: Append the failing test**:

```ts
test("every emailed file on the dashboard offers a confirmed discard", () => {
  const page = read("src/pages/portal/index.astro");
  assert.equal((page.match(/<DiscardDraft /g) ?? []).length, 3, "list rows (finish), the single-file variant and list rows (nothing owed)");
  const component = read("src/components/portal/DiscardDraft.astro");
  assert.match(component, /action=\{`\/api\/portal\/slips\/\$\{encodeURIComponent\(id\)\}\/discard`\}/);
  assert.match(component, /method="post"/);
  assert.match(component, /data-confirm="¿Descartar este comprobante\? Se borra el archivo\. Si ya transferiste, tendrás que enviarlo otra vez para registrar el pago\."/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --import tsx --test tests/portal-draft-discard.test.ts` → the new test FAILS.

- [ ] **Step 3: Implement**

Create `src/components/portal/DiscardDraft.astro`:

```astro
---
interface Props { id: string; label?: string; }
const { id, label = 'Descartar' } = Astro.props;
---
<form class="portal-discard" action={`/api/portal/slips/${encodeURIComponent(id)}/discard`} method="post" data-confirm="¿Descartar este comprobante? Se borra el archivo. Si ya transferiste, tendrás que enviarlo otra vez para registrar el pago."><button class="portal-text-button portal-quiet-action" type="submit">{label}</button></form>
```

In `src/pages/portal/index.astro`:

1. Add after the `ChargesTable` import line: `import DiscardDraft from '../../components/portal/DiscardDraft.astro';`
2. In the actionable list (several files), replace
   `<a class="portal-link" href={`/portal/pagos/nuevo?correo=${encodeURIComponent(draft.id)}`} aria-label={`Terminar el comprobante recibido el ${dateTimeLabel(draft.createdAt)}`}>Terminar <span aria-hidden="true">→</span></a></li>`
   with
   `<div class="portal-draft-actions"><a class="portal-link" href={`/portal/pagos/nuevo?correo=${encodeURIComponent(draft.id)}`} aria-label={`Terminar el comprobante recibido el ${dateTimeLabel(draft.createdAt)}`}>Terminar <span aria-hidden="true">→</span></a><DiscardDraft id={draft.id} /></div></li>`
3. In the single-file variant, replace
   `Terminarlo ahora <span aria-hidden="true">→</span></a></div> : <ul class="portal-draft-list">`
   with
   `Terminarlo ahora <span aria-hidden="true">→</span></a><DiscardDraft id={emailDrafts[0].id} label="Descartarlo" /></div> : <ul class="portal-draft-list">`
4. In the "nothing owed" list, replace
   `<span>{fileKindLabel(draft.type)} · vence el {dayLabel(draft.expiresAt)}</span></div></li>)}</ul></details>`
   with
   `<span>{fileKindLabel(draft.type)} · vence el {dayLabel(draft.expiresAt)}</span></div><DiscardDraft id={draft.id} /></li>)}</ul></details>`

Append to `src/styles/portal-ux.css`:

```css

/* ── Discard: a quiet, full-height target beside (or under) the file's main action. ── */
.portal-discard { margin: 0; }
.portal-draft-actions { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; }
.portal-copy-row > .portal-discard { margin-left: 4px; }
```

- [ ] **Step 4: Run to verify**

Run: `node --import tsx --test tests/portal-draft-discard.test.ts` → pass. `npm run check` → 0 errors.
Visual check (dev server at :4400): seed three fake drafts for `demo-parent-a` and `demo-admin` into the local D1 (`slip_drafts` + `email_inbound`, ids prefixed `ui-test-`), open `/portal` as each at 390 px and 1440 px, press "Descartar" on one (the dialog must ask; "Volver" must keep the file), confirm "Comprobante descartado." appears and the row is gone. Then delete every `ui-test-` row and confirm none remain.

---

### Task 4: Email worker frees expired drafts

**Files:**
- Modify: `workers/email-inbound/src/index.ts` (import, one call before the draft insert, bounce text)
- Test: `tests/email-inbound.test.ts` (one new test, one assertion added)

**Interfaces:**
- Consumes: `cleanupOwnExpiredDrafts(db, actor, bucket, limit = 5, now = new Date())` from `src/lib/portal/ocr.ts` (existing; removes the actor's drafts that expired more than an hour ago).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**. Add after the test "draft budget reached bounces with instructions instead of throwing" in `tests/email-inbound.test.ts`, and change that test's `assert.match(rejected() ?? "", /sin registrar/);` line to also assert the new wording:

```ts
test("expired drafts no longer block a new email", async () => {
  const db = new SQLiteD1();
  const { env, objects } = fakeEnv(db);
  const past = new Date(Date.now() - 3 * 3600000).toISOString(); // expired beyond the one-hour grace
  for (let i = 0; i < 5; i++) {
    const key = `portal/drafts/old-${i}/original`;
    objects.set(key, new Uint8Array([1]));
    db.sqlite.prepare("INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`old-${i}`, "guardian-1", key, "image/png", 100, "f".repeat(64), past, past);
  }
  const { message, rejected } = fakeMessage("familia@example.cr", "msg-expired@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const states = db.sqlite.prepare("SELECT state, count(*) AS n FROM slip_drafts GROUP BY state ORDER BY state").all() as Array<{ state: string; n: number }>;
  assert.deepEqual(states.map((s) => [s.state, s.n]), [["deleted", 5], ["draft", 1]]);
  assert.equal([...objects.keys()].some((key) => key.includes("old-")), false, "the old files are gone from storage");
});
```

In the budget test, after `assert.match(rejected() ?? "", /sin registrar/);` add: `assert.match(rejected() ?? "", /descártalos/);`

- [ ] **Step 2: Run to verify they fail** — `node --import tsx --test tests/email-inbound.test.ts` → the new test and the changed assertion FAIL.

- [ ] **Step 3: Implement** in `workers/email-inbound/src/index.ts`:

1. Change the import line to `import { cleanupOwnExpiredDrafts, requestSlipExtraction, type OcrSuggestions } from "../../../src/lib/portal/ocr";`
2. Immediately before `const draftId = crypto.randomUUID();` add:

```ts
  // Expired drafts still count toward the five-draft budget until cleaned. A web upload cleans first,
  // so the email path does too. A failure here must never stop the email.
  await cleanupOwnExpiredDrafts(
    env.DB,
    { id: owner.id, email: sender, name: owner.name?.trim() || sender, isAdmin: isStaff, mode: "workos" },
    env.SLIPS,
  ).catch(() => undefined);
```
3. Change the `draft_limit` bounce text to: `"Ya tienes varios comprobantes guardados sin registrar. Entra a tu cuenta en el portal, regístralos o descártalos, y vuelve a enviar este archivo."`

- [ ] **Step 4: Run to verify they pass** — `node --import tsx --test tests/email-inbound.test.ts` → all pass; `npm test` green.

Note for the owner: this worker deploys on its own (`workers/email-inbound`); the change is live only after that deploy.

---

### Task 5: Docs and full verification

**Files:**
- Modify: `docs/PORTAL-UX-PASS-2026-10-17.md` (extend the "Emailed receipts on the dashboard" bullet), `docs/PAYSLIP-OCR.md` (drafts paragraph)

- [ ] **Step 1: Docs.** In the UX pass bullet, replace "Families still cannot discard a file; it simply expires (7 days for emailed ones). Each account holds at most five open drafts (`draft_limit`), so stuck files block new emailed slips until they expire." with: "Each file has a quiet \"Descartar\" (confirmed in a dialog) that deletes it and frees its slot (`POST /api/portal/slips/{id}/discard`, `discardEmailDraft` in `ocr.ts`). Each account holds at most five open drafts (`draft_limit`); the email worker now removes the sender's expired drafts before saving a new one, as web uploads already did, and its bounce text offers discarding." In `docs/PAYSLIP-OCR.md`, after the sentence about five open drafts and expiry, add: "Emailed drafts last seven days. A family can discard one from its dashboard, and the email worker removes the sender's expired drafts before saving a new one."
- [ ] **Step 2: Verify.** `npm test` (all pass), `npm run check` (0 errors, 0 warnings, 0 hints), `npm run test:portal` against the running dev server (exit 0), `npm run build` (succeeds), axe scan of `/portal` with seeded drafts (0 violations), then remove every `ui-test-` row.
- [ ] **Step 3: Migrations.** `npx wrangler d1 migrations list DB --local` and, read-only, `--remote --config wrangler.staging.jsonc` / `wrangler.production.jsonc`: "No migrations to apply" on all three (this feature adds none).
- [ ] **Step 4: Commit and push** (owner's instruction). Commit 1: spec, plan, Tasks 1–3 files and the discard docs. Commit 2: Task 4 files. `git push origin main`.
