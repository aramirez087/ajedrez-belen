import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleEmail, type InboundMessage } from "../workers/email-inbound/src/index";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(new URL("../migrations/0002_portal.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0003_ocr.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0005_email_inbound.sql", import.meta.url), "utf8"));
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
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function fakeMessage(from: string, messageId: string): { message: InboundMessage; rejected: () => string | null } {
  const mime = [
    `From: ${from}`, `To: pagos@recibir.ajedrezbelen.com`, `Subject: Comprobante`,
    `Message-ID: <${messageId}>`, "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"', "", "--b1",
    'Content-Type: text/plain; charset=utf-8', "", "Adjunto comprobante.", "--b1",
    "Content-Type: image/png", "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="comprobante.png"', "", PNG_B64, "--b1--", "",
  ].join("\r\n");
  let reason: string | null = null;
  const bytes = new TextEncoder().encode(mime);
  const message: InboundMessage = {
    from, to: "pagos@recibir.ajedrezbelen.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    headers: new Headers({ "message-id": `<${messageId}>` }),
    setReject(r: string) { reason = r; },
  };
  return { message, rejected: () => reason };
}

function fakeEnv(db: SQLiteD1) {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    env: {
      DB: db as unknown as D1Database,
      SLIPS: {
        async put(key: string, value: Uint8Array) { objects.set(key, value); },
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
): { message: InboundMessage; rejected: () => string | null } {
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
  const bytes = new TextEncoder().encode(mime);
  const message: InboundMessage = {
    from, to: "pagos@recibir.ajedrezbelen.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    headers: new Headers({ "message-id": `<${messageId}>` }),
    setReject(r: string) { reason = r; },
  };
  return { message, rejected: () => reason };
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
