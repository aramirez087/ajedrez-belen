import PostalMime from "postal-mime";

export interface InboundEnv {
  DB: D1Database;
  SLIPS: R2Bucket;
  ADMIN_USER_IDS?: string;
}

export interface InboundMessage {
  from: string;
  to: string;
  raw: ReadableStream<Uint8Array>;
  headers: Headers;
  setReject(reason: string): void;
}

const ALLOWED = new Set(["image/png", "image/jpeg", "application/pdf"]);
const MAX_SIZE = 3145728;
const MIN_SIZE = 8;
const DRAFT_TTL_MS = 7 * 24 * 3600000;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleEmail(message: InboundMessage, env: InboundEnv): Promise<void> {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const parsed = await PostalMime.parse(raw.buffer as ArrayBuffer);
  const sender = (message.from || "").trim().toLowerCase();
  const messageId = message.headers.get("message-id") || `sha256:${await sha256Hex(raw)}`;

  const owner = await env.DB.prepare(
    "SELECT id FROM users WHERE lower(email)=? AND active=1",
  ).bind(sender).first<{ id: string }>();
  if (!owner) {
    message.setReject("Remitente no vinculado a una cuenta familiar. Escribe desde el correo registrado en el portal.");
    return;
  }
  const admins = new Set((env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!admins.has(owner.id)) {
    const link = await env.DB.prepare(
      "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND active=1 LIMIT 1",
    ).bind(owner.id).first();
    if (!link) {
      message.setReject("Tu cuenta aún no está vinculada a un atleta. Solicita una invitación a la Asociación.");
      return;
    }
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM email_inbound WHERE message_id=?",
  ).bind(messageId).first();
  if (existing) return; // Duplicate delivery: keep the first draft, drop silently.

  const attachment = (parsed.attachments || []).find((a) => ALLOWED.has(a.mimeType));
  const rawContent: unknown = attachment?.content;
  const bytes = rawContent instanceof Uint8Array ? rawContent
    : rawContent instanceof ArrayBuffer ? new Uint8Array(rawContent) : null;
  if (!attachment || !bytes || bytes.length < MIN_SIZE || bytes.length > MAX_SIZE) {
    await env.DB.prepare(
      "INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,NULL,'rejected',?)",
    ).bind(crypto.randomUUID(), messageId, sender, owner.id, new Date().toISOString()).run();
    message.setReject("Adjunta el comprobante como imagen JPG o PNG, o como PDF (máximo 3 MB).");
    return;
  }

  const draftId = crypto.randomUUID();
  const key = `portal/drafts/${draftId}/original`;
  const now = new Date();
  const sha256 = await sha256Hex(bytes);
  await env.DB.prepare(
    "INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(draftId, owner.id, key, attachment.mimeType, bytes.length, sha256, now.toISOString(),
    new Date(now.getTime() + DRAFT_TTL_MS).toISOString()).run();
  try {
    await env.SLIPS.put(key, bytes, {
      httpMetadata: { contentType: attachment.mimeType },
      customMetadata: { sha256 },
    });
  } catch {
    await env.DB.prepare("DELETE FROM slip_drafts WHERE id=?").bind(draftId).run();
    message.setReject("No pudimos guardar el archivo. Inténtalo de nuevo en unos minutos.");
    return;
  }
  await env.DB.prepare(
    "INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,?,'draft_created',?)",
  ).bind(crypto.randomUUID(), messageId, sender, owner.id, draftId, now.toISOString()).run();
}

export default {
  async email(message: InboundMessage, env: InboundEnv): Promise<void> {
    await handleEmail(message, env);
  },
};
