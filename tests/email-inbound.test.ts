import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { money } from "../src/components/portal/format";
import { requestSlipExtraction } from "../src/lib/portal/ocr";
import { DEFAULT_GROQ_VISION_MODEL } from "../src/lib/portal/ocr-provider";
import { EMAIL_PAYMENT_NOTE } from "../src/lib/portal/email-payment";
import { handleEmail, mailAuthenticationFailed, type InboundMessage, type SlipReceiptReply } from "../workers/email-inbound/src/index";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const migration of ["0002_portal", "0003_ocr", "0004_financial_operations", "0005_email_inbound", "0006_self_registration", "0010_admin_invitations"]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
    const now = new Date().toISOString();
    this.sqlite.prepare("INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run("guardian-1", "familia@example.cr", "Familia Prueba", 1, now, now);
    this.sqlite.prepare("INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run("athlete-admin", "admin@example.cr", "Admin", 1, now, now);
    this.sqlite.prepare("INSERT INTO athletes(id,name,category,fee_minor,discount_minor,active,start_period,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?,?)")
      .run("ath-1", "Atleta Uno", "Avanzados", 1500000, "2027-01", now, now);
    this.sqlite.prepare("INSERT INTO guardian_links(user_id,athlete_id,linked_by,active,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run("guardian-1", "ath-1", "athlete-admin", 1, now, now);
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
      async run() {
        const result = database.sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1["prepare"]>>) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sqlite.exec("ROLLBACK");
      throw cause;
    }
  }
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function fakeMessage(from: string, messageId: string, extraHeaders?: Record<string, string>): { message: InboundMessage; rejected: () => string | null; replies: SlipReceiptReply[] } {
  const mime = [
    `From: ${from}`, `To: pagos@recibir.ajedrezbelen.com`, `Subject: Comprobante`,
    `Message-ID: <${messageId}>`, "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"', "", "--b1",
    'Content-Type: text/plain; charset=utf-8', "", "Adjunto comprobante.", "--b1",
    "Content-Type: image/png", "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="comprobante.png"', "", PNG_B64, "--b1--", "",
  ].join("\r\n");
  let reason: string | null = null;
  const replies: SlipReceiptReply[] = [];
  const bytes = new TextEncoder().encode(mime);
  const message: InboundMessage = {
    from, to: "pagos@recibir.ajedrezbelen.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    headers: new Headers({ "message-id": `<${messageId}>`, ...extraHeaders }),
    setReject(r: string) { reason = r; },
    async reply(body) { replies.push(body); },
  };
  return { message, rejected: () => reason, replies };
}

function paymentCount(db: SQLiteD1): number {
  return (db.sqlite.prepare("SELECT count(*) AS n FROM payments").get() as { n: number }).n;
}

function addCharge(db: SQLiteD1, id: string, period: string, athleteId = "ath-1"): void {
  db.sqlite.prepare(
    "INSERT INTO charges(id,athlete_id,period,due_date,base_minor,discount_minor,published_by,created_at) VALUES(?,?,?,?,1500000,0,'athlete-admin',?)",
  ).run(id, athleteId, period, `${period}-08`, new Date().toISOString());
}

/** Same PNG signature, different bytes: another screenshot of a transfer. */
const PNG_ALT_B64 = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.from("otra captura")]).toString("base64");

function fakeEnv(db: SQLiteD1) {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    env: {
      DB: db as unknown as D1Database,
      SLIPS: {
        async put(key: string, value: Uint8Array) { objects.set(key, value.slice()); },
        async get(key: string) {
          const bytes = objects.get(key);
          if (!bytes) return null;
          const copy = bytes.slice();
          return { size: copy.byteLength, arrayBuffer: async () => copy.buffer };
        },
        async delete(key: string) { objects.delete(key); },
      } as unknown as R2Bucket,
      ADMIN_USER_IDS: "",
    },
  };
}

function fakeMessageWithParts(
  from: string,
  messageId: string,
  parts: Array<{ contentType: string; disposition: string; filename: string; b64: string }>,
): { message: InboundMessage; rejected: () => string | null; replies: SlipReceiptReply[] } {
  const body = parts.flatMap((part) => [
    "--b1", `Content-Type: ${part.contentType}`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${part.disposition}; filename="${part.filename}"`, "", part.b64,
  ]);
  const mime = [
    `From: ${from}`, `To: pagos@recibir.ajedrezbelen.com`, `Subject: Comprobante`,
    `Message-ID: <${messageId}>`, "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"', "", ...body, "--b1--", "",
  ].join("\r\n");
  let reason: string | null = null;
  const replies: SlipReceiptReply[] = [];
  const bytes = new TextEncoder().encode(mime);
  const message: InboundMessage = {
    from, to: "pagos@recibir.ajedrezbelen.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    headers: new Headers({ "message-id": `<${messageId}>` }),
    setReject(r: string) { reason = r; },
    async reply(body) { replies.push(body); },
  };
  return { message, rejected: () => reason, replies };
}

test("envelope from with a display name still matches the family account", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected } = fakeMessage("Familia Prueba <familia@example.cr>", "msg-named@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const mail = db.sqlite.prepare("SELECT sender_email, status FROM email_inbound").get() as { sender_email: string; status: string };
  assert.equal(mail.sender_email, "familia@example.cr");
  assert.equal(mail.status, "draft_created");
});

test("email from a linked guardian creates a seven-day draft ready for the portal form", async () => {
  const db = new SQLiteD1();
  const { env, objects } = fakeEnv(db);
  const { message, rejected } = fakeMessage("familia@example.cr", "msg-1@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const draft = db.sqlite.prepare("SELECT owner_id, file_type FROM slip_drafts").get() as { owner_id: string; file_type: string };
  assert.equal(draft.owner_id, "guardian-1");
  assert.equal(draft.file_type, "image/png");
  assert.equal(objects.size, 1);
  const mail = db.sqlite.prepare("SELECT status FROM email_inbound").get() as { status: string };
  assert.equal(mail.status, "draft_created");
});

test("an invited administrator can send a slip without a family link", async () => {
  const db = new SQLiteD1();
  const now = new Date().toISOString();
  db.sqlite.prepare(
    "INSERT INTO admin_grants(user_id,email,granted_by,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  ).run("athlete-admin", "admin@example.cr", "athlete-admin", now, now);
  const { env } = fakeEnv(db);
  const { message, rejected, replies } = fakeMessage("admin@example.cr", "msg-admin-grant@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const mail = db.sqlite.prepare("SELECT owner_id, status, draft_id FROM email_inbound").get() as { owner_id: string; status: string; draft_id: string };
  assert.equal(mail.owner_id, "athlete-admin");
  assert.equal(mail.status, "draft_created");
  assert.equal(paymentCount(db), 0);
  assert.match(replies[0]?.text ?? "", /cuenta de administración/);
  assert.ok((replies[0]?.text ?? "").includes(`https://ajedrezbelen.com/admin/pagos/nuevo?correo=${mail.draft_id}`));
});

test("unknown sender is rejected and duplicate delivery creates no second draft", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const unknown = fakeMessage("otra@example.cr", "msg-2@test");
  await handleEmail(unknown.message, env);
  assert.match(unknown.rejected() ?? "", /no vinculado/);
  const first = fakeMessage("familia@example.cr", "msg-3@test");
  await handleEmail(first.message, env);
  const again = fakeMessage("familia@example.cr", "msg-3@test");
  await handleEmail(again.message, env);
  const count = db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number };
  assert.equal(count.n, 1);
});

test("declared image type with non-image bytes is rejected by magic bytes, never stored", async () => {
  const db = new SQLiteD1();
  const { env, objects } = fakeEnv(db);
  const text = Buffer.from("esto no es una imagen aunque el correo lo declare").toString("base64");
  const { message, rejected } = fakeMessageWithParts("familia@example.cr", "msg-spoof@test", [
    { contentType: "image/png", disposition: "attachment", filename: "comprobante.png", b64: text },
  ]);
  await handleEmail(message, env);
  assert.match(rejected() ?? "", /Adjunta el comprobante/);
  assert.match(rejected() ?? "", /HEIC/);
  assert.equal(objects.size, 0);
  const count = db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number };
  assert.equal(count.n, 0);
  const mail = db.sqlite.prepare("SELECT status FROM email_inbound").get() as { status: string };
  assert.equal(mail.status, "rejected");
});

test("real PNG labeled octet-stream is accepted under its detected type", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected } = fakeMessageWithParts("familia@example.cr", "msg-octet@test", [
    { contentType: "application/octet-stream", disposition: "attachment", filename: "archivo", b64: PNG_B64 },
  ]);
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const draft = db.sqlite.prepare("SELECT file_type FROM slip_drafts").get() as { file_type: string };
  assert.equal(draft.file_type, "image/png");
});

test("inline signature image never wins over the attached slip", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const slipBytes = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(600)]);
  const { message, rejected } = fakeMessageWithParts("familia@example.cr", "msg-inline@test", [
    { contentType: "image/png", disposition: "inline", filename: "logo.png", b64: PNG_B64 },
    { contentType: "image/png", disposition: "attachment", filename: "comprobante.png", b64: slipBytes.toString("base64") },
  ]);
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const draft = db.sqlite.prepare("SELECT file_size FROM slip_drafts").get() as { file_size: number };
  assert.equal(draft.file_size, slipBytes.length);
});

test("draft budget reached bounces with instructions instead of throwing", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const now = new Date().toISOString();
  for (let i = 0; i < 5; i++) {
    db.sqlite.prepare("INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(`draft-${i}`, "guardian-1", `portal/drafts/draft-${i}/original`, "image/png", 100, "f".repeat(64), now, now);
  }
  const { message, rejected } = fakeMessage("familia@example.cr", "msg-limit@test");
  await handleEmail(message, env);
  assert.match(rejected() ?? "", /sin registrar/);
  const count = db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number };
  assert.equal(count.n, 5);
});

test("a slip that cannot be read says what is missing and links the form with that file", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-reply@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  assert.equal(replies.length, 1);
  const reply = replies[0];
  assert.equal(reply?.from.email, "pagos@recibir.ajedrezbelen.com");
  assert.equal(reply?.from.name, "Ajedrez Belén");
  assert.equal(reply?.subject, "Falta un dato de tu comprobante");
  assert.match(reply?.text ?? "", /No pudimos leer el monto ni la fecha\. Todavía no está registrado\./);
  assert.match(reply?.text ?? "", /Guardamos el archivo hasta el /);
  const draft = db.sqlite.prepare("SELECT id FROM slip_drafts").get() as { id: string };
  assert.ok((reply?.text ?? "").includes(`https://ajedrezbelen.com/portal/pagos/nuevo?correo=${draft.id}`));
  assert.doesNotMatch(reply?.text ?? "", /Archivo:|Tamaño:|foto PNG|referencia|₡/i);
  assert.match(reply?.html ?? "", /No pudimos leer el monto/);
  assert.doesNotMatch(reply?.html ?? "", /foto PNG|Tamaño/);
  assert.equal(paymentCount(db), 0);
});

test("a rejected slip and a duplicate delivery do not send a receipt reply", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const unknown = fakeMessage("otra@example.cr", "msg-reply-unknown@test");
  await handleEmail(unknown.message, env);
  assert.equal(unknown.replies.length, 0);
  const first = fakeMessage("familia@example.cr", "msg-reply-once@test");
  await handleEmail(first.message, env);
  const again = fakeMessage("familia@example.cr", "msg-reply-once@test");
  await handleEmail(again.message, env);
  assert.equal(first.replies.length, 1);
  assert.equal(again.replies.length, 0);
});

test("a failed receipt reply leaves the saved draft and does not bounce", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected } = fakeMessage("familia@example.cr", "msg-reply-fail@test");
  message.reply = async () => { throw new Error("dmarc"); };
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const count = db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number };
  assert.equal(count.n, 1);
});

test("a Cloudflare authentication failure stores no draft; a pass still does", async () => {
  assert.equal(mailAuthenticationFailed(new Headers()), false);
  assert.equal(mailAuthenticationFailed(new Headers({ "arc-authentication-results": "i=1; mx.cloudflare.net; arc=none" })), false);
  assert.equal(mailAuthenticationFailed(new Headers({ "authentication-results": "evil.example; spf=fail; dkim=fail; dmarc=fail" })), false);
  const db = new SQLiteD1();
  const { env, objects } = fakeEnv(db);
  const failed = fakeMessage("familia@example.cr", "msg-auth-fail@test", {
    "authentication-results": "mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail",
  });
  await handleEmail(failed.message, env);
  assert.match(failed.rejected() ?? "", /confirmar que este correo/);
  assert.equal(failed.replies.length, 0);
  assert.equal(objects.size, 0);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 0);
  assert.equal((db.sqlite.prepare("SELECT status FROM email_inbound").get() as { status: string }).status, "rejected");
  const dmarc = fakeMessage("familia@example.cr", "msg-auth-dmarc@test", {
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=fail",
  });
  await handleEmail(dmarc.message, env);
  assert.match(dmarc.rejected() ?? "", /confirmar que este correo/);
  const passed = fakeMessage("familia@example.cr", "msg-auth-pass@test", {
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
  });
  await handleEmail(passed.message, env);
  assert.equal(passed.rejected(), null);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 1);
});

test("an automatic incoming message is saved without a receipt reply", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-auto@test", { "auto-submitted": "auto-replied" });
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  assert.equal(replies.length, 0);
  const count = db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number };
  assert.equal(count.n, 1);
});

function groqReply(content: unknown) {
  return Response.json({
    model: DEFAULT_GROQ_VISION_MODEL,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
  });
}

test("a read photo replies with the transferred amount and keeps that reading for the portal", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return groqReply({
      amount: "12000.00", currency: "CRC", transferDate: "2026-10-08",
      payerName: "Ana <b>", bankReference: "000020261010283002453950810",
      description: "Timothy Ramírez", warnings: [],
    });
  };
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-ocr@test");
  await handleEmail(message, { ...env, OCR_MODE: "groq", GROQ_API_KEY: "test-key" }, { fetcher });
  assert.equal(rejected(), null);
  assert.equal(calls, 1);
  const reply = replies[0];
  assert.match(reply?.text ?? "", new RegExp(money(1_200_000).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(reply?.text ?? "", /8 de octubre de 2026/);
  assert.match(reply?.text ?? "", /Referencia: 000020261010283002453950810/);
  assert.match(reply?.text ?? "", /Quien transfirió: Ana <b>/);
  assert.match(reply?.text ?? "", /Detalle: Timothy Ramírez/);
  assert.equal(reply?.subject, "Recibimos tu comprobante");
  assert.match(reply?.text ?? "", /estás al día/);
  assert.equal(paymentCount(db), 0);
  assert.doesNotMatch(reply?.text ?? "", /Archivo:|Tamaño:|foto PNG/);
  assert.match(reply?.html ?? "", /Ana &lt;b&gt;/);
  assert.doesNotMatch(reply?.html ?? "", /Ana <b>/);
  const row = db.sqlite.prepare("SELECT status, suggestions_json FROM slip_extractions").get() as { status: string; suggestions_json: string };
  assert.equal(row.status, "ready");
  assert.match(row.suggestions_json, /12000\.00/);
  const draft = db.sqlite.prepare("SELECT id FROM slip_drafts").get() as { id: string };
  await requestSlipExtraction(env.DB, {
    id: "guardian-1", email: "familia@example.cr", name: "Familia Prueba", isAdmin: false, mode: "workos",
  }, draft.id, { ...env, OCR_MODE: "groq", GROQ_API_KEY: "test-key" }, { fetcher });
  assert.equal(calls, 1);
});

test("a photo whose amount cannot be read still saves the draft and omits a made-up amount", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const fetcher: typeof fetch = async () => groqReply({
    amount: null, currency: null, transferDate: null, payerName: null,
    bankReference: "000020261010283002453950810", description: null, warnings: [],
  });
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-ocr-partial@test");
  await handleEmail(message, { ...env, OCR_MODE: "groq", GROQ_API_KEY: "test-key" }, { fetcher });
  assert.equal(rejected(), null);
  const text = replies[0]?.text ?? "";
  assert.match(text, /Referencia: 000020261010283002453950810/);
  assert.match(text, /No pudimos leer el monto/);
  assert.doesNotMatch(text, /Monto transferido|₡/);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 1);
});

test("a failed read and a PDF leave the draft and do not invent an amount", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response("no", { status: 500 });
  };
  const failed = fakeMessage("familia@example.cr", "msg-ocr-fail@test");
  await handleEmail(failed.message, { ...env, OCR_MODE: "groq", GROQ_API_KEY: "test-key" }, { fetcher });
  assert.equal(failed.rejected(), null);
  assert.equal(calls, 1);
  assert.match(failed.replies[0]?.text ?? "", /No pudimos leer el monto/);
  assert.doesNotMatch(failed.replies[0]?.text ?? "", /Monto transferido|₡/);
  assert.equal((db.sqlite.prepare("SELECT status FROM slip_extractions").get() as { status: string }).status, "failed");
  const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
  const mailed = fakeMessageWithParts("familia@example.cr", "msg-pdf@test", [
    { contentType: "application/pdf", disposition: "attachment", filename: "comprobante.pdf", b64: pdf },
  ]);
  await handleEmail(mailed.message, { ...env, OCR_MODE: "groq", GROQ_API_KEY: "test-key" }, { fetcher });
  assert.equal(mailed.rejected(), null);
  assert.equal(calls, 1);
  assert.equal(mailed.replies[0]?.subject, "Envíanos una captura de tu comprobante");
  assert.match(mailed.replies[0]?.text ?? "", /por correo solo leemos fotos/);
  assert.match(mailed.replies[0]?.text ?? "", /captura de pantalla \(JPG o PNG\)/);
  assert.doesNotMatch(mailed.replies[0]?.text ?? "", /Monto transferido|₡|Tamaño:/);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 2);
});

test("reading stays off when the Groq key is missing, without spending a read", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-ocr-off@test");
  await handleEmail(message, { ...env, OCR_MODE: "groq" });
  assert.equal(rejected(), null);
  assert.match(replies[0]?.text ?? "", /No pudimos leer el monto/);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_extractions").get() as { n: number }).n, 0);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 1);
});

const NOW = new Date("2026-10-17T18:00:00Z");
const OCR = { OCR_MODE: "groq", GROQ_API_KEY: "test-key" };
const FULL_READ = { amount: "20000.00", currency: "CRC", transferDate: "2026-10-08", payerName: "Ana Mora", bankReference: "123456" };

function reads(content: Record<string, unknown>): typeof fetch {
  return async () => groqReply({
    amount: null, currency: null, transferDate: null, payerName: null, bankReference: null, description: null, warnings: [],
    ...content,
  });
}

function altMessage(messageId: string) {
  return fakeMessageWithParts("familia@example.cr", messageId, [
    { contentType: "image/png", disposition: "attachment", filename: "captura.png", b64: PNG_ALT_B64 },
  ]);
}

test("a fully read slip registers itself as a pending payment and says nothing else is needed", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-09", "2026-09");
  addCharge(db, "charge-10", "2026-10");
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-auto@test");
  await handleEmail(message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  assert.equal(rejected(), null);
  const payment = db.sqlite.prepare(
    "SELECT id, status, amount_minor AS amount, transfer_date AS date, bank_reference AS reference, payer_name AS payer, submitted_by AS submitter, designated_user_id AS designated FROM payments",
  ).get() as Record<string, unknown>;
  assert.deepEqual({ ...payment, id: undefined }, {
    id: undefined, status: "pending", amount: 2_000_000, date: "2026-10-08", reference: "123456",
    payer: "Ana Mora", submitter: "guardian-1", designated: "guardian-1",
  });
  const requested = db.sqlite.prepare(
    "SELECT charge_id AS chargeId, amount_minor AS amount FROM payment_requested_allocations ORDER BY charge_id",
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(requested, [{ chargeId: "charge-09", amount: 1_500_000 }, { chargeId: "charge-10", amount: 500_000 }]);
  assert.equal((db.sqlite.prepare("SELECT note FROM payment_revisions").get() as { note: string }).note, EMAIL_PAYMENT_NOTE);
  assert.equal((db.sqlite.prepare("SELECT state FROM slip_drafts").get() as { state: string }).state, "attached");
  const text = replies[0]?.text ?? "";
  assert.equal(replies[0]?.subject, "Registramos tu pago");
  assert.match(text, /No tienes que hacer nada más/);
  assert.match(text, /Septiembre de 2026 · Atleta Uno: /);
  assert.match(text, /Octubre de 2026 · Atleta Uno: /);
  assert.ok(text.includes(`https://ajedrezbelen.com/portal/pagos/${payment.id}`));
  assert.doesNotMatch(text, /A tu favor|correo=|Guardamos el archivo/);
});

test("an amount above what is due is registered with the rest as credit", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const { message, replies } = fakeMessage("familia@example.cr", "msg-credit@test");
  await handleEmail(message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  assert.equal(paymentCount(db), 1);
  assert.match(replies[0]?.text ?? "", new RegExp(`A tu favor para el próximo mes: ${money(500_000).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a slip without a readable date stays unregistered and asks only for the date", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const { message, replies } = fakeMessage("familia@example.cr", "msg-no-date@test");
  await handleEmail(message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ amount: "15000.00", currency: "CRC" }) });
  assert.equal(paymentCount(db), 0);
  const draft = db.sqlite.prepare("SELECT id, state FROM slip_drafts").get() as { id: string; state: string };
  assert.equal(draft.state, "draft");
  const text = replies[0]?.text ?? "";
  assert.equal(replies[0]?.subject, "Falta un dato de tu comprobante");
  assert.match(text, /No pudimos leer la fecha\. Todavía no está registrado\./);
  assert.match(text, /Monto transferido: /);
  assert.ok(text.includes(`https://ajedrezbelen.com/portal/pagos/nuevo?correo=${draft.id}`));
});

test("emailing a slip that is already registered says so and keeps no second copy", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const first = fakeMessage("familia@example.cr", "msg-first@test");
  await handleEmail(first.message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  const again = fakeMessage("familia@example.cr", "msg-again@test");
  await handleEmail(again.message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  assert.equal(again.rejected(), null);
  assert.equal(paymentCount(db), 1);
  assert.equal((db.sqlite.prepare("SELECT count(*) AS n FROM slip_drafts").get() as { n: number }).n, 1);
  const paymentId = (db.sqlite.prepare("SELECT id FROM payments").get() as { id: string }).id;
  assert.equal(again.replies[0]?.subject, "Ese comprobante ya está registrado");
  assert.ok((again.replies[0]?.text ?? "").includes(`https://ajedrezbelen.com/portal/pagos/${paymentId}`));
  const status = db.sqlite.prepare("SELECT status FROM email_inbound WHERE message_id=?").get("<msg-again@test>") as { status: string };
  assert.equal(status.status, "duplicate");
});

test("another screenshot with an already registered reference is not registered twice", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const first = fakeMessage("familia@example.cr", "msg-ref-1@test");
  await handleEmail(first.message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  const second = altMessage("msg-ref-2@test");
  await handleEmail(second.message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  assert.equal(paymentCount(db), 1);
  assert.equal(second.replies[0]?.subject, "Ese comprobante ya está registrado");
});

test("a doubtful reading is not registered and asks the family to finish it", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const { message, replies } = fakeMessage("familia@example.cr", "msg-doubt@test");
  await handleEmail(message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ ...FULL_READ, warnings: ["not_transfer"] }) });
  assert.equal(paymentCount(db), 0);
  assert.equal(replies[0]?.subject, "Falta un dato de tu comprobante");
  assert.match(replies[0]?.text ?? "", /portal\/pagos\/nuevo\?correo=/);
});

test("a payment the portal refuses falls back to finishing it by hand", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  db.sqlite.exec("CREATE TRIGGER refuse_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'pending_payment_limit'); END;");
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-refused@test");
  await handleEmail(message, { ...env, ...OCR }, { now: NOW, fetcher: reads(FULL_READ) });
  assert.equal(rejected(), null);
  assert.equal(paymentCount(db), 0);
  assert.equal((db.sqlite.prepare("SELECT state FROM slip_drafts").get() as { state: string }).state, "draft");
  assert.equal(replies[0]?.subject, "Termina el registro de tu comprobante");
  assert.match(replies[0]?.text ?? "", /Monto transferido: /);
  assert.match(replies[0]?.text ?? "", /portal\/pagos\/nuevo\?correo=/);
});

test("months already covered by a payment in review are not charged twice", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-10", "2026-10");
  const first = fakeMessage("familia@example.cr", "msg-cover-1@test");
  await handleEmail(first.message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ ...FULL_READ, amount: "15000.00" }) });
  const second = altMessage("msg-cover-2@test");
  await handleEmail(second.message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ ...FULL_READ, bankReference: "999999" }) });
  assert.equal(paymentCount(db), 1);
  assert.match(second.replies[0]?.text ?? "", /ya tienen un pago en revisión/);
});

test("a family with a payment awaiting correction is sent to that payment, not given a new one", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  addCharge(db, "charge-09", "2026-09");
  addCharge(db, "charge-10", "2026-10");
  const first = fakeMessage("familia@example.cr", "msg-fix-1@test");
  await handleEmail(first.message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ ...FULL_READ, amount: "15000.00" }) });
  const paymentId = (db.sqlite.prepare("SELECT id FROM payments").get() as { id: string }).id;
  db.sqlite.prepare("UPDATE payments SET status='needs_info', review_note='Falta la referencia' WHERE id=?").run(paymentId);
  const second = altMessage("msg-fix-2@test");
  await handleEmail(second.message, { ...env, ...OCR }, { now: NOW, fetcher: reads({ ...FULL_READ, bankReference: "777777" }) });
  assert.equal(paymentCount(db), 1);
  const draftId = (db.sqlite.prepare("SELECT draft_id FROM email_inbound WHERE message_id=?").get("<msg-fix-2@test>") as { draft_id: string }).draft_id;
  assert.match(second.replies[0]?.text ?? "", /esperando una corrección/);
  assert.ok((second.replies[0]?.text ?? "").includes(`https://ajedrezbelen.com/portal/pagos/${paymentId}?correo=${draftId}`));
});

test("an administrator's slip naming their own athlete registers for their own family", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const now = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO guardian_links(user_id,athlete_id,linked_by,active,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("athlete-admin", "ath-1", "athlete-admin", 1, now, now);
  addCharge(db, "charge-10", "2026-10");
  const { message, replies } = fakeMessage("admin@example.cr", "msg-admin-own@test");
  await handleEmail(message, { ...env, ...OCR, ADMIN_USER_IDS: "athlete-admin" }, {
    now: NOW, fetcher: reads({ ...FULL_READ, amount: "15000.00", description: "Mensualidad Atleta Uno" }),
  });
  const payment = db.sqlite.prepare("SELECT status, submitted_by AS submitter, designated_user_id AS designated FROM payments").get() as Record<string, unknown>;
  assert.deepEqual({ ...payment }, { status: "pending", submitter: "athlete-admin", designated: "athlete-admin" });
  assert.equal(replies[0]?.subject, "Registramos tu pago");
});

test("an administrator's slip for another family stays a staff file", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const now = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO guardian_links(user_id,athlete_id,linked_by,active,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("athlete-admin", "ath-1", "athlete-admin", 1, now, now);
  addCharge(db, "charge-10", "2026-10");
  const { message, replies } = fakeMessage("admin@example.cr", "msg-admin-other@test");
  await handleEmail(message, { ...env, ...OCR, ADMIN_USER_IDS: "athlete-admin" }, {
    now: NOW, fetcher: reads({ ...FULL_READ, description: "Mensualidad Sofía Vargas" }),
  });
  assert.equal(paymentCount(db), 0);
  assert.match(replies[0]?.text ?? "", /cuenta de administración/);
});
