import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { money } from "../src/components/portal/format";
import { requestSlipExtraction } from "../src/lib/portal/ocr";
import { DEFAULT_GROQ_VISION_MODEL } from "../src/lib/portal/ocr-provider";
import { handleEmail, mailAuthenticationFailed, type InboundMessage, type SlipReceiptReply } from "../workers/email-inbound/src/index";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../migrations/0002_portal.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0003_ocr.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0005_email_inbound.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0010_admin_invitations.sql", import.meta.url), "utf8"));
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
  const { message, rejected } = fakeMessage("admin@example.cr", "msg-admin-grant@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  const mail = db.sqlite.prepare("SELECT owner_id, status FROM email_inbound").get() as { owner_id: string; status: string };
  assert.equal(mail.owner_id, "athlete-admin");
  assert.equal(mail.status, "draft_created");
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

test("a saved slip replies without a reading and does not claim the payment", async () => {
  const db = new SQLiteD1();
  const { env } = fakeEnv(db);
  const { message, rejected, replies } = fakeMessage("familia@example.cr", "msg-reply@test");
  await handleEmail(message, env);
  assert.equal(rejected(), null);
  assert.equal(replies.length, 1);
  const reply = replies[0];
  assert.equal(reply?.from.email, "pagos@recibir.ajedrezbelen.com");
  assert.equal(reply?.from.name, "Ajedrez Belén");
  assert.equal(reply?.subject, "Recibimos tu comprobante");
  assert.match(reply?.text ?? "", /No pudimos leer el monto/);
  assert.match(reply?.text ?? "", /Disponible en tu cuenta hasta el /);
  assert.match(reply?.text ?? "", /no registra el pago/);
  assert.match(reply?.text ?? "", /https:\/\/ajedrezbelen.com\/portal\/pagos\/nuevo/);
  assert.doesNotMatch(reply?.text ?? "", /Archivo:|Tamaño:|foto PNG|referencia|₡/i);
  assert.match(reply?.html ?? "", /No pudimos leer el monto/);
  assert.match(reply?.html ?? "", /no registra el pago/);
  assert.doesNotMatch(reply?.html ?? "", /foto PNG|Tamaño/);
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
  assert.match(reply?.text ?? "", /no registra el pago/);
  assert.match(reply?.text ?? "", /revisa estos datos/);
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
  assert.match(mailed.replies[0]?.text ?? "", /Guardamos el PDF/);
  assert.match(mailed.replies[0]?.text ?? "", /no se lee desde aquí/);
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
