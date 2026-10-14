import PostalMime from "postal-mime";
import { money } from "../../../src/components/portal/format";
import { requestSlipExtraction, type OcrSuggestions } from "../../../src/lib/portal/ocr";
import { detectSlipType } from "../../../src/lib/prototype-policy";
import { PortalError } from "../../../src/lib/portal/types";

export interface InboundEnv {
  DB: D1Database;
  SLIPS: R2Bucket;
  ADMIN_USER_IDS?: string;
  OCR_MODE?: string;
  GROQ_API_KEY?: string;
  GROQ_VISION_MODEL?: string;
  GROQ_TIMEOUT_MS?: string;
}

export interface SlipReceiptReply {
  from: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
}

export interface InboundMessage {
  from: string;
  to: string;
  raw: ReadableStream<Uint8Array>;
  headers: Headers;
  setReject(reason: string): void;
  /** Present on the platform message. Threading is added by `reply()`. */
  reply?(message: SlipReceiptReply): Promise<unknown>;
}

const MAX_SIZE = 3145728;
const MIN_SIZE = 8;
/** A 3 MB file travels as ~4 MB of base64; anything far beyond that cannot hold a valid slip. */
const MAX_RAW_SIZE = 8 * 1024 * 1024;
const DRAFT_TTL_MS = 7 * 24 * 3600000;

const REJECT_ATTACHMENT = "Adjunta el comprobante como imagen JPG o PNG, o como PDF (máximo 3 MB). Si tu teléfono guarda fotos HEIC, envía una captura de pantalla del comprobante.";
const REJECT_RETRY = "No pudimos guardar el archivo. Inténtalo de nuevo en unos minutos.";
const REJECT_AUTH = "No pudimos confirmar que este correo salió de tu cuenta. Envíalo otra vez desde el correo con el que entras al portal.";
const PORTAL_PAYMENT_URL = "https://ajedrezbelen.com/portal/pagos/nuevo";
const WHATSAPP_URL = "https://wa.me/50687686102";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function expiryLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

export interface SlipReceiptReading {
  /** read: a transferred amount was transcribed. amount_missing: other facts only. pdf and unreadable: nothing transcribed. */
  outcome: "read" | "amount_missing" | "pdf" | "unreadable";
  amount: string | null;
  transferDate: string | null;
  payerName: string | null;
  bankReference: string | null;
  description: string | null;
}

const UNREAD: SlipReceiptReading = {
  outcome: "unreadable", amount: null, transferDate: null, payerName: null, bankReference: null, description: null,
};

function amountLabel(amount: string | null): string | null {
  if (!amount || !/^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(amount)) return null;
  const [whole, fraction] = amount.split(".");
  const minor = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(minor) && minor > 0 ? money(minor) : null;
}

function transferDateLabel(value: string | null): string | null {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

function readingFrom(suggestions: OcrSuggestions): SlipReceiptReading {
  const amount = amountLabel(suggestions.amount) ? suggestions.amount : null;
  const reading: SlipReceiptReading = {
    outcome: amount ? "read" : "amount_missing",
    amount,
    transferDate: suggestions.transferDate,
    payerName: suggestions.payerName,
    bankReference: suggestions.bankReference,
    description: suggestions.description,
  };
  if (!amount && !transferDateLabel(reading.transferDate) && !reading.payerName && !reading.bankReference && !reading.description) {
    return { ...UNREAD };
  }
  return reading;
}

function detailLines(reading: SlipReceiptReading): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  const amount = amountLabel(reading.amount);
  const date = transferDateLabel(reading.transferDate);
  if (amount) lines.push(["Monto transferido", amount]);
  if (date) lines.push(["Fecha", date]);
  if (reading.bankReference) lines.push(["Referencia", reading.bankReference]);
  if (reading.payerName) lines.push(["Quien transfirió", reading.payerName]);
  if (reading.description) lines.push(["Detalle", reading.description]);
  return lines;
}

function followUp(reading: SlipReceiptReading): string {
  if (reading.outcome === "read") {
    return "Entra al portal, actualiza la página, elige «Archivos que nos enviaste por correo», revisa estos datos, elige las mensualidades y envía el formulario.";
  }
  if (reading.outcome === "pdf") {
    return "Guardamos el PDF. Entra al portal, actualiza la página, elige «Archivos que nos enviaste por correo» y completa el monto. Un PDF enviado por correo no se lee desde aquí.";
  }
  return "No pudimos leer el monto. Entra al portal, actualiza la página, elige «Archivos que nos enviaste por correo», escribe el monto y envía el formulario.";
}

/** What the family can check: the transferred amount and the other facts read from the slip. */
export function slipReceiptCopy(expiresAt: Date, reading: SlipReceiptReading): { subject: string; text: string; html: string } {
  const until = expiryLabel(expiresAt);
  const lines = detailLines(reading);
  const next = followUp(reading);
  const subject = "Recibimos tu comprobante";
  const text = [
    "Recibimos tu comprobante.",
    "",
    ...(lines.length ? ["Esto es lo que leímos:", ...lines.map(([label, value]) => `• ${label}: ${value}`), ""] : []),
    `Este mensaje no registra el pago. ${next}`,
    "",
    `Disponible en tu cuenta hasta el ${until}`,
    "",
    PORTAL_PAYMENT_URL,
    "",
    "Las respuestas a este mensaje no se atienden. Para consultas, escríbenos por WhatsApp:",
    WHATSAPP_URL,
  ].join("\n");
  const html = [
    "<p>Recibimos tu comprobante.</p>",
    ...(lines.length ? [
      "<p>Esto es lo que leímos:</p><ul>",
      ...lines.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`),
      "</ul>",
    ] : []),
    `<p><strong>Este mensaje no registra el pago.</strong> ${escapeHtml(next)}</p>`,
    `<p>Disponible en tu cuenta hasta el ${escapeHtml(until)}</p>`,
    `<p><a href="${PORTAL_PAYMENT_URL}">Registrar el pago</a></p>`,
    `<p>Las respuestas a este mensaje no se atienden. Para consultas, escríbenos por <a href="${WHATSAPP_URL}">WhatsApp</a>.</p>`,
  ].join("");
  return { subject, text, html };
}

function canReply(message: InboundMessage): boolean {
  if (!message.reply) return false;
  const auto = message.headers.get("auto-submitted");
  if (auto && auto.toLowerCase() !== "no") return false;
  const from = senderAddress(message.to || "");
  return from.endsWith("@ajedrezbelen.com") || from.endsWith(".ajedrezbelen.com");
}

async function confirmReceipt(message: InboundMessage, expiresAt: Date, reading: SlipReceiptReading): Promise<void> {
  if (!canReply(message) || !message.reply) return;
  const copy = slipReceiptCopy(expiresAt, reading);
  try {
    await message.reply({
      from: { name: "Ajedrez Belén", email: senderAddress(message.to) },
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
    });
  } catch { /* The draft is already saved. A failed reply must not bounce it. */ }
}

/**
 * Read a stored JPG or PNG with the same Groq transcription the portal uses.
 * A PDF stays unread: the mail worker cannot render its first page. A failed
 * or skipped read still leaves the draft, and the reply says the amount has
 * to be typed in the portal.
 */
async function readEmailedSlip(
  env: InboundEnv,
  ownerId: string,
  sender: string,
  isAdmin: boolean,
  draftId: string,
  fileType: string,
  options: { fetcher?: typeof fetch; now?: Date },
): Promise<SlipReceiptReading> {
  if (fileType === "application/pdf") return { ...UNREAD, outcome: "pdf" };
  if (fileType !== "image/jpeg" && fileType !== "image/png") return { ...UNREAD };
  if (env.OCR_MODE !== "groq" || !env.GROQ_API_KEY?.trim()) return { ...UNREAD };
  try {
    const extraction = await requestSlipExtraction(env.DB, {
      id: ownerId, email: sender, name: sender, isAdmin, mode: "workos",
    }, draftId, env, { fetcher: options.fetcher, now: options.now });
    if (extraction.status !== "ready" || !extraction.suggestions) return { ...UNREAD };
    return readingFrom(extraction.suggestions);
  } catch (cause) {
    const code = cause instanceof PortalError ? cause.code : "read_failed";
    console.log(JSON.stringify({ event: "slip_read_failed", code }));
    return { ...UNREAD };
  }
}

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

/**
 * Cloudflare's MX already requires SPF or DKIM, and Email Routing often
 * delivers to a Worker with no Authentication-Results header (workerd #6740).
 * Reject only a verdict stamped by mx.cloudflare.net that failed. A missing
 * header is not treated as failure, and a header from any other host is ignored.
 */
export function mailAuthenticationFailed(headers: Headers): boolean {
  const raw = [headers.get("authentication-results"), headers.get("arc-authentication-results")]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  let failed = false;
  for (const segment of raw.split(/\n+/)) {
    if (!/mx\.cloudflare\.net/i.test(segment)) continue;
    const verdict = segment.toLowerCase();
    if (/\bdmarc\s*=\s*fail\b/.test(verdict)) return true;
    if (/\b(?:spf|dkim)\s*=/.test(verdict) && !/\b(?:spf|dkim)\s*=\s*pass\b/.test(verdict)) failed = true;
  }
  return failed;
}

export async function handleEmail(
  message: InboundMessage,
  env: InboundEnv,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<void> {
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
  let staffGrant = false;
  if (!admins.has(owner.id)) {
    try {
      staffGrant = Boolean(await env.DB.prepare(
        "SELECT 1 AS ok FROM admin_grants WHERE user_id=? AND active=1",
      ).bind(owner.id).first());
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (!/no such table/i.test(text)) throw error;
    }
  }
  if (!admins.has(owner.id) && !staffGrant) {
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

  if (mailAuthenticationFailed(message.headers)) {
    await recordRejected(env, messageId, sender, owner.id);
    message.setReject(REJECT_AUTH);
    return;
  }

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
    // Any other failure must bounce. A saved draft replies with a summary instead.
    await env.DB.prepare("DELETE FROM slip_drafts WHERE id=?").bind(draftId).run().catch(() => {});
    try { await env.SLIPS.delete(key); } catch { /* The draft row is already gone. */ }
    if (!/unique constraint failed/i.test(errorText(cause))) message.setReject(REJECT_RETRY);
    return;
  }
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
  const reading = await readEmailedSlip(env, owner.id, sender, admins.has(owner.id), draftId, slip.type, options);
  await confirmReceipt(message, expiresAt, reading);
}

export default {
  async email(message: InboundMessage, env: InboundEnv): Promise<void> {
    await handleEmail(message, env);
  },
};
