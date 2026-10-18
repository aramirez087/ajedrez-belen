import PostalMime from "postal-mime";
import { emailButton, emailNote, emailParagraph, emailRows, emailShell, type EmailRow } from "../../../src/lib/email-layout";
import { money, monthLabel } from "../../../src/components/portal/format";
import {
  detailNamesOwnAthlete,
  findPaymentAwaitingCorrection,
  findRegisteredPayment,
  readAmountMinor,
  registerEmailedSlip,
  type EmailAllocation,
} from "../../../src/lib/portal/email-payment";
import { cleanupOwnExpiredDrafts, requestSlipExtraction, type OcrSuggestions } from "../../../src/lib/portal/ocr";
import { detectSlipType } from "../../../src/lib/prototype-policy";
import { PortalError, type Actor, type SlipMetadata } from "../../../src/lib/portal/types";

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
const PORTAL_URL = "https://ajedrezbelen.com";
const WHATSAPP_URL = "https://wa.me/50687686102";

function expiryLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

/** What was read from the slip, shown back to the family to check. */
export interface SlipReceiptReading {
  amount: string | null;
  transferDate: string | null;
  payerName: string | null;
  bankReference: string | null;
  description: string | null;
}

function readingFrom(suggestions: OcrSuggestions | null): SlipReceiptReading {
  return {
    amount: suggestions?.amount ?? null,
    transferDate: suggestions?.transferDate ?? null,
    payerName: suggestions?.payerName ?? null,
    bankReference: suggestions?.bankReference ?? null,
    description: suggestions?.description ?? null,
  };
}

function amountLabel(amount: string | null): string | null {
  const minor = readAmountMinor(amount);
  return minor ? money(minor) : null;
}

function transferDateLabel(value: string | null): string | null {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
  }).format(date);
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

/** One reply per saved or recognized message. Only `registered` means the payment exists. */
export type SlipReply =
  | { kind: "registered"; reading: SlipReceiptReading; paymentId: string; allocations: EmailAllocation[]; creditMinor: number }
  | { kind: "duplicate"; paymentId: string }
  | { kind: "missing"; reading: SlipReceiptReading; missing: Array<"amount" | "date">; draftId: string; expiresAt: Date }
  | { kind: "pdf" | "unsure" | "nothing_due" | "covered" | "staff"; reading: SlipReceiptReading; draftId: string; expiresAt: Date }
  | { kind: "correction"; reading: SlipReceiptReading; paymentId: string; draftId: string; expiresAt: Date };

interface ReplyCopy {
  /** Also the headline of the message. */
  subject: string;
  lead: string;
  lists?: Array<{ title: string; rows: EmailRow[] }>;
  body?: string[];
  links?: Array<{ label: string; url: string }>;
  expiresAt?: Date;
}

const MISSING_LABEL = { amount: "el monto", date: "la fecha" } as const;
const FINISH_LABEL = "Terminar el registro";

function paymentUrl(paymentId: string, draftId?: string): string {
  const query = draftId ? `?correo=${encodeURIComponent(draftId)}` : "";
  return `${PORTAL_URL}/portal/pagos/${encodeURIComponent(paymentId)}${query}`;
}

/** Opens Registrar un pago with this emailed file already chosen. */
function finishUrl(draftId: string, path = "/portal/pagos/nuevo"): string {
  return `${PORTAL_URL}${path}?correo=${encodeURIComponent(draftId)}`;
}

function readList(reading: SlipReceiptReading): Array<{ title: string; rows: EmailRow[] }> {
  const lines = detailLines(reading);
  return lines.length ? [{ title: "Esto es lo que leímos:", rows: lines }] : [];
}

function allocationRow(line: EmailAllocation): EmailRow {
  const month = monthLabel(line.period);
  return [`${month.charAt(0).toUpperCase()}${month.slice(1)} · ${line.athleteName}`, money(line.amountMinor)];
}

function replyCopy(reply: SlipReply): ReplyCopy {
  switch (reply.kind) {
    case "registered":
      return {
        subject: "Registramos tu pago",
        lead: "No tienes que hacer nada más.",
        lists: [...readList(reply.reading), {
          title: "Lo aplicamos a:",
          rows: [
            ...reply.allocations.map(allocationRow),
            ...(reply.creditMinor > 0 ? [["A tu favor para el próximo mes", money(reply.creditMinor)] as EmailRow] : []),
          ],
        }],
        body: ["Queda en revisión hasta que la Asociación confirme el ingreso en el banco. El comprobante oficial llegará a este correo."],
        links: [{ label: "Ver el pago", url: paymentUrl(reply.paymentId) }],
      };
    case "duplicate":
      return {
        subject: "Ese comprobante ya está registrado",
        lead: "No lo registramos otra vez.",
        links: [{ label: "Ver el pago", url: paymentUrl(reply.paymentId) }],
      };
    case "missing":
      return {
        subject: "Falta un dato de tu comprobante",
        lead: `No pudimos leer ${reply.missing.map((key) => MISSING_LABEL[key]).join(" ni ")}. Todavía no está registrado.`,
        lists: readList(reply.reading),
        body: ["Responde a este correo con una foto más clara y lo registramos solo, o termínalo en el portal en un minuto:"],
        links: [{ label: FINISH_LABEL, url: finishUrl(reply.draftId) }],
        expiresAt: reply.expiresAt,
      };
    case "pdf":
      return {
        subject: "Envíanos una captura de tu comprobante",
        lead: "Recibimos tu PDF, pero por correo solo leemos fotos. Todavía no está registrado.",
        body: ["Responde a este correo con una captura de pantalla (JPG o PNG) y lo registramos solo, o termínalo en el portal en un minuto:"],
        links: [{ label: FINISH_LABEL, url: finishUrl(reply.draftId) }],
        expiresAt: reply.expiresAt,
      };
    case "unsure":
      return {
        subject: "Termina el registro de tu comprobante",
        lead: "Recibimos tu comprobante, pero no pudimos registrarlo solo. Todavía no está registrado.",
        lists: readList(reply.reading),
        body: ["Revisa los datos y termínalo en el portal en un minuto:"],
        links: [{ label: FINISH_LABEL, url: finishUrl(reply.draftId) }],
        expiresAt: reply.expiresAt,
      };
    case "nothing_due":
      return {
        subject: "Recibimos tu comprobante",
        lead: "Estás al día: no hay mensualidades pendientes donde registrarlo.",
        lists: readList(reply.reading),
        body: ["Si es un pago adelantado, escríbenos por WhatsApp y te ayudamos."],
        expiresAt: reply.expiresAt,
      };
    case "covered":
      return {
        subject: "Recibimos tu comprobante",
        lead: "Tus mensualidades pendientes ya tienen un pago en revisión. No lo registramos para no cobrarlo dos veces.",
        lists: readList(reply.reading),
        body: ["Si es otra transferencia, regístrala en el portal:"],
        links: [{ label: "Registrar el pago", url: finishUrl(reply.draftId) }],
        expiresAt: reply.expiresAt,
      };
    case "correction":
      return {
        subject: "Recibimos tu comprobante",
        lead: "No lo registramos como pago nuevo porque tienes un pago esperando una corrección.",
        lists: readList(reply.reading),
        body: ["Si es para ese pago, ábrelo y envía la corrección con este archivo. Si es otra transferencia, regístrala aparte."],
        links: [
          { label: "Corregir el pago", url: paymentUrl(reply.paymentId, reply.draftId) },
          { label: "Registrar otra transferencia", url: finishUrl(reply.draftId) },
        ],
        expiresAt: reply.expiresAt,
      };
    case "staff":
      return {
        subject: "Recibimos tu comprobante",
        lead: "Guardamos el comprobante en tu cuenta de administración.",
        lists: readList(reply.reading),
        body: ["Regístralo para la familia desde administración:"],
        links: [{ label: "Registrar pago", url: finishUrl(reply.draftId, "/admin/pagos/nuevo") }],
        expiresAt: reply.expiresAt,
      };
  }
}

export function slipReplyCopy(reply: SlipReply): { subject: string; text: string; html: string } {
  const copy = replyCopy(reply);
  const until = copy.expiresAt ? `Guardamos el archivo hasta el ${expiryLabel(copy.expiresAt)}.` : null;
  const lists = copy.lists ?? [];
  const body = copy.body ?? [];
  const links = copy.links ?? [];
  const text = [
    copy.subject, "", copy.lead, "",
    ...lists.flatMap((list) => [list.title, ...list.rows.map(([label, value]) => `• ${label}: ${value}`), ""]),
    ...body.flatMap((paragraph) => [paragraph, ""]),
    ...links.flatMap((link) => [`${link.label}: ${link.url}`, ""]),
    ...(until ? [until, ""] : []),
    "¿Algo no está bien? Escríbenos por WhatsApp:",
    WHATSAPP_URL,
  ].join("\n");
  const html = emailShell({
    headline: copy.subject,
    preheader: copy.lead,
    body: [
      emailParagraph(copy.lead),
      ...lists.map((list) => emailRows(list.title, list.rows)),
      ...body.map(emailParagraph),
      ...links.map((link, index) => emailButton(link.label, link.url, index === 0)),
      ...(until ? [emailNote(until)] : []),
    ].join("\n"),
  });
  return { subject: copy.subject, text, html };
}

function canReply(message: InboundMessage): boolean {
  if (!message.reply) return false;
  const auto = message.headers.get("auto-submitted");
  if (auto && auto.toLowerCase() !== "no") return false;
  const from = senderAddress(message.to || "");
  return from.endsWith("@ajedrezbelen.com") || from.endsWith(".ajedrezbelen.com");
}

async function confirmReceipt(message: InboundMessage, reply: SlipReply): Promise<void> {
  if (!canReply(message) || !message.reply) return;
  const copy = slipReplyCopy(reply);
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
 * or skipped read still leaves the draft, and the reply names what is missing.
 */
async function readEmailedSlip(
  env: InboundEnv,
  actor: Actor,
  draftId: string,
  fileType: string,
  options: { fetcher?: typeof fetch; now?: Date },
): Promise<OcrSuggestions | null> {
  if (fileType !== "image/jpeg" && fileType !== "image/png") return null;
  if (env.OCR_MODE !== "groq" || !env.GROQ_API_KEY?.trim()) return null;
  try {
    const extraction = await requestSlipExtraction(env.DB, actor, draftId, env, { fetcher: options.fetcher, now: options.now });
    return extraction.status === "ready" ? extraction.suggestions : null;
  } catch (cause) {
    const code = cause instanceof PortalError ? cause.code : "read_failed";
    console.log(JSON.stringify({ event: "slip_read_failed", code }));
    return null;
  }
}

/**
 * Staff files (unless the detail names the administrator's own athlete) and
 * possible corrections wait for a person; a PDF cannot be read here. Everything
 * else registers itself when the amount and date were read. Any failure after
 * the draft is saved falls back to finishing by hand.
 */
async function replyForSavedSlip(
  env: InboundEnv,
  actor: Actor,
  isStaff: boolean,
  draft: { id: string; file: SlipMetadata },
  suggestions: OcrSuggestions | null,
  expiresAt: Date,
  now: Date,
): Promise<SlipReply> {
  const reading = readingFrom(suggestions);
  const saved = { reading, draftId: draft.id, expiresAt };
  try {
    if (isStaff && !(await detailNamesOwnAthlete(env.DB, actor.id, suggestions?.description ?? null))) {
      return { kind: "staff", ...saved };
    }
    const correction = await findPaymentAwaitingCorrection(env.DB, actor.id);
    if (correction) return { kind: "correction", paymentId: correction, ...saved };
    if (draft.file.type === "application/pdf") return { kind: "pdf", ...saved };
    const result = await registerEmailedSlip(env.DB, actor, draft, suggestions, now);
    switch (result.kind) {
      case "registered":
        return { kind: "registered", reading, paymentId: result.paymentId, allocations: result.allocations, creditMinor: result.creditMinor };
      case "duplicate":
        return { kind: "duplicate", paymentId: result.paymentId };
      case "incomplete":
        return { kind: "missing", missing: result.missing, ...saved };
      default:
        return { kind: result.kind, ...saved };
    }
  } catch (cause) {
    const code = cause instanceof PortalError ? cause.code : "register_failed";
    console.log(JSON.stringify({ event: "slip_register_failed", code }));
    return { kind: isStaff ? "staff" : "unsure", ...saved };
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

/** False when the row could not be written, usually because a redelivery already recorded it. */
async function recordInbound(
  env: InboundEnv, messageId: string, sender: string, ownerId: string, status: "rejected" | "duplicate" = "rejected",
): Promise<boolean> {
  try {
    await env.DB.prepare(
      "INSERT INTO email_inbound(id,message_id,sender_email,owner_id,draft_id,status,created_at) VALUES(?,?,?,?,NULL,?,?)",
    ).bind(crypto.randomUUID(), messageId, sender, ownerId, status, new Date().toISOString()).run();
    return true;
  } catch { /* A duplicate record must never mask the bounce reason. */ }
  return false;
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
    "SELECT id, name FROM users WHERE lower(email)=? AND active=1",
  ).bind(sender).first<{ id: string; name: string | null }>();
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
  const isStaff = admins.has(owner.id) || staffGrant;
  if (!isStaff) {
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
    await recordInbound(env, messageId, sender, owner.id);
    message.setReject(REJECT_AUTH);
    return;
  }

  const slip = pickSlip(parsed.attachments || []);
  if (!slip) {
    await recordInbound(env, messageId, sender, owner.id);
    message.setReject(REJECT_ATTACHMENT);
    return;
  }

  const sha256 = await sha256Hex(slip.bytes);
  // The same file already belongs to a live payment: say so instead of keeping a second copy.
  if (!isStaff) {
    const registered = await findRegisteredPayment(env.DB, owner.id, { sha256 });
    if (registered) {
      if (await recordInbound(env, messageId, sender, owner.id, "duplicate")) {
        await confirmReceipt(message, { kind: "duplicate", paymentId: registered });
      }
      return;
    }
  }

  // Expired drafts still count toward the five-draft budget until cleaned. A web upload cleans first,
  // so the email path does too. A failure here must never stop the email.
  await cleanupOwnExpiredDrafts(
    env.DB,
    { id: owner.id, email: sender, name: owner.name?.trim() || sender, isAdmin: isStaff, mode: "workos" },
    env.SLIPS,
  ).catch(() => undefined);

  const draftId = crypto.randomUUID();
  const key = `portal/drafts/${draftId}/original`;
  const now = new Date();
  try {
    await env.DB.prepare(
      "INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(draftId, owner.id, key, slip.type, slip.bytes.length, sha256, now.toISOString(),
      new Date(now.getTime() + DRAFT_TTL_MS).toISOString()).run();
  } catch (cause) {
    // The draft budget trigger (five live drafts per account) must bounce with
    // instructions, not vanish as an unhandled Worker error.
    if (/draft_limit/.test(errorText(cause))) {
      await recordInbound(env, messageId, sender, owner.id);
      message.setReject("Ya tienes varios comprobantes guardados sin registrar. Entra a tu cuenta en el portal, regístralos o descártalos, y vuelve a enviar este archivo.");
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
  const actor: Actor = { id: owner.id, email: sender, name: owner.name?.trim() || sender, isAdmin: admins.has(owner.id), mode: "workos" };
  const suggestions = await readEmailedSlip(env, actor, draftId, slip.type, options);
  const draft = { id: draftId, file: { key, type: slip.type, size: slip.bytes.length, sha256 } };
  await confirmReceipt(message, await replyForSavedSlip(env, actor, isStaff, draft, suggestions, expiresAt, options.now ?? now));
}

export default {
  async email(message: InboundMessage, env: InboundEnv): Promise<void> {
    await handleEmail(message, env);
  },
};
