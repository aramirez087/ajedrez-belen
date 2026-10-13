import PostalMime from "postal-mime";
import { detectSlipType } from "../../../src/lib/prototype-policy";

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

const MAX_SIZE = 3145728;
const MIN_SIZE = 8;
/** A 3 MB file travels as ~4 MB of base64; anything far beyond that cannot hold a valid slip. */
const MAX_RAW_SIZE = 8 * 1024 * 1024;
const DRAFT_TTL_MS = 7 * 24 * 3600000;

const REJECT_ATTACHMENT = "Adjunta el comprobante como imagen JPG o PNG, o como PDF (máximo 3 MB). Si tu teléfono guarda fotos HEIC, envía una captura de pantalla del comprobante.";
const REJECT_RETRY = "No pudimos guardar el archivo. Inténtalo de nuevo en unos minutos.";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy the view. Hashing bytes.buffer would include bytes outside the attachment
  // when the array is a slice, and the portal later rejects that checksum.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Envelope From is usually a bare address; some relays send `Name <addr>`. */
export function senderAddress(from: string): string {
  const trimmed = from.trim().toLowerCase();
  const wrapped = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (wrapped?.[1]) return wrapped[1];
  const bare = trimmed.match(/[^\s<>]+@[^\s<>]+/);
  return bare?.[0] ?? trimmed;
}

function errorText(cause: unknown): string {
  if (cause instanceof Error) {
    const nested = cause.cause instanceof Error ? cause.cause.message : "";
    return `${cause.message} ${nested}`;
  }
  return String(cause ?? "");
}

function attachmentBytes(attachment: { content: unknown; encoding?: string }): Uint8Array | null {
  const content = attachment.content;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") {
    if (attachment.encoding === "base64") {
      try {
        const binary = atob(content.replace(/\s/g, ""));
        return Uint8Array.from(binary, (c) => c.charCodeAt(0));
      } catch {
        return null;
      }
    }
    return new TextEncoder().encode(content);
  }
  return null;
}

interface SlipCandidate { bytes: Uint8Array; type: string; rank: number }

/**
 * The declared MIME type is not evidence: mail clients label slips as
 * octet-stream and signatures as image/png. Trust the magic bytes (the same
 * check the portal upload applies), prefer real attachments over inline or
 * HTML-referenced images (logos, tracking pixels), and take the largest file
 * in the winning class — a bank slip is never the smallest image in the mail.
 */
export function pickSlip(attachments: Array<{
  disposition?: string | null; related?: boolean; content: unknown; encoding?: string;
}>): SlipCandidate | null {
  const candidates: SlipCandidate[] = [];
  for (const attachment of attachments) {
    const bytes = attachmentBytes(attachment);
    if (!bytes || bytes.length < MIN_SIZE || bytes.length > MAX_SIZE) continue;
    const type = detectSlipType(bytes);
    if (!type) continue;
    const rank = attachment.disposition === "attachment" ? 0 : attachment.related ? 2 : 1;
    candidates.push({ bytes, type, rank });
  }
  candidates.sort((a, b) => a.rank - b.rank || b.bytes.length - a.bytes.length);
  return candidates[0] ?? null;
}

async function recordRejected(env: InboundEnv, messageId: string, sender: string, ownerId: string): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,NULL,'rejected',?)",
    ).bind(crypto.randomUUID(), messageId, sender, ownerId, new Date().toISOString()).run();
  } catch { /* A duplicate record must never mask the bounce reason. */ }
}

export async function handleEmail(message: InboundMessage, env: InboundEnv): Promise<void> {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  if (raw.length > MAX_RAW_SIZE) {
    message.setReject(REJECT_ATTACHMENT);
    return;
  }
  let parsed;
  try {
    parsed = await PostalMime.parse(raw.buffer as ArrayBuffer);
  } catch {
    message.setReject("No pudimos leer el correo. Vuelve a enviar el comprobante como archivo adjunto JPG, PNG o PDF.");
    return;
  }
  const sender = senderAddress(message.from || "");
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

  const slip = pickSlip(parsed.attachments || []);
  if (!slip) {
    await recordRejected(env, messageId, sender, owner.id);
    message.setReject(REJECT_ATTACHMENT);
    return;
  }

  const draftId = crypto.randomUUID();
  const key = `portal/drafts/${draftId}/original`;
  const now = new Date();
  const sha256 = await sha256Hex(slip.bytes);
  try {
    await env.DB.prepare(
      "INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(draftId, owner.id, key, slip.type, slip.bytes.length, sha256, now.toISOString(),
      new Date(now.getTime() + DRAFT_TTL_MS).toISOString()).run();
  } catch (cause) {
    // The draft budget trigger (five live drafts per account) must bounce with
    // instructions, not vanish as an unhandled Worker error.
    if (/draft_limit/.test(errorText(cause))) {
      await recordRejected(env, messageId, sender, owner.id);
      message.setReject("Ya tienes varios comprobantes guardados sin registrar. Entra a tu cuenta en el portal, regístralos y vuelve a enviar este archivo.");
    } else {
      message.setReject(REJECT_RETRY);
    }
    return;
  }
  try {
    await env.SLIPS.put(key, slip.bytes, {
      httpMetadata: { contentType: slip.type },
      customMetadata: { sha256 },
    });
  } catch {
    await env.DB.prepare("DELETE FROM slip_drafts WHERE id=?").bind(draftId).run();
    message.setReject(REJECT_RETRY);
    return;
  }
  try {
    await env.DB.prepare(
      "INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,?,'draft_created',?)",
    ).bind(crypto.randomUUID(), messageId, sender, owner.id, draftId, now.toISOString()).run();
  } catch (cause) {
    // A concurrent redelivery won the message_id race: remove this copy so the
    // family never sees two drafts (or an unlisted one eating the draft budget).
    // Any other failure must bounce; silence means the file is waiting in the portal.
    await env.DB.prepare("DELETE FROM slip_drafts WHERE id=?").bind(draftId).run().catch(() => {});
    try { await env.SLIPS.delete(key); } catch { /* The draft row is already gone. */ }
    if (!/unique constraint failed/i.test(errorText(cause))) message.setReject(REJECT_RETRY);
  }
}

export default {
  async email(message: InboundMessage, env: InboundEnv): Promise<void> {
    await handleEmail(message, env);
  },
};
