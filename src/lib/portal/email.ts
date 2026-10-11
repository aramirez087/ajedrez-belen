import { renderReceipt, validEmail, type RenderedReceipt } from './receipt.ts';
import { PortalError, type Actor, type ReceiptSnapshot } from './types.ts';

export interface PortalEmailEnvironment {
  EMAIL_MODE?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_TIMEOUT_MS?: string | number;
}
export type OutboxStatus = 'queued' | 'sending' | 'dry_run' | 'accepted' | 'blocked' | 'rejected' | 'unknown' | 'cancelled';
export interface EmailOutboxItem {
  id: string; receiptId: string; receiptNumber: string; recipientName: string; recipientEmail: string;
  kind: 'receipt' | 'receipt_void'; status: OutboxStatus; attempts: number; nextAttemptAt: string;
  lastErrorCode: string | null; providerMessageId: string | null; createdAt: string;
}
interface OutboxRow {
  id: string; receipt_id: string; number: string; recipient_id: string; recipient_name: string;
  recipient_email: string; kind: 'receipt' | 'receipt_void'; status: OutboxStatus; attempts: number;
  next_attempt_at: string; last_error_code: string | null; provider_message_id: string | null;
  created_at: string; snapshot_json: string; receipt_status: 'issued' | 'void';
  void_reason: string | null; voided_at: string | null;
}
export type PortalEmailAttemptResult =
  | { status: 'dry_run' }
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'blocked' | 'rejected' | 'unknown'; code: string; retryable: boolean; retryAfterSeconds?: number };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface EmailBatchOptions { now?: Date; fetcher?: Fetcher; limit?: number; receiptId?: string }
export interface EmailBatchResult {
  processed: number;
  remaining: number;
  dailyAttempts: number;
  results: Array<{ id: string; status: OutboxStatus; code?: string }>;
}

const OUTBOX_SELECT = `SELECT e.*,r.number,r.snapshot_json,r.status AS receipt_status,r.void_reason,r.voided_at
  FROM email_outbox e JOIN receipts r ON r.id=e.receipt_id`;
// This predicate is evaluated in the atomic UPDATE claim, not only before it.
const AUTHORIZED_RECIPIENT = `EXISTS (
  SELECT 1 FROM users u JOIN receipts r ON r.id=email_outbox.receipt_id
    JOIN payments p ON p.id=r.payment_id
  WHERE u.id=email_outbox.recipient_id AND u.active=1
    AND u.id=p.designated_user_id
    AND json_extract(r.snapshot_json,'$.designatedAdult.id')=u.id
    AND lower(u.email)=lower(email_outbox.recipient_email)
    AND ((email_outbox.kind='receipt' AND r.status='issued' AND p.status='verified')
      OR (email_outbox.kind='receipt_void' AND r.status='void' AND p.status='void'))
    AND NOT EXISTS (
      SELECT 1 FROM json_each(r.snapshot_json,'$.lines') line
      WHERE NOT EXISTS (SELECT 1 FROM guardian_links g
        WHERE g.user_id=u.id AND g.athlete_id=json_extract(line.value,'$.athleteId') AND g.active=1)
    )
)`;

function requireAdmin(actor: Actor, live = false): void {
  if (!actor.isAdmin || (live && actor.mode !== 'workos')) throw new PortalError(403, 'Se requiere una sesión de administración verificada para enviar correo.');
}
function timestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid email clock.');
  return date.toISOString();
}
function mapRow(row: OutboxRow): EmailOutboxItem {
  return { id: row.id, receiptId: row.receipt_id, receiptNumber: row.number,
    recipientName: row.recipient_name, recipientEmail: row.recipient_email, kind: row.kind,
    status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code, providerMessageId: row.provider_message_id, createdAt: row.created_at };
}
function configurationError(env: PortalEmailEnvironment): 'missing_configuration' | 'invalid_configuration' | null {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM || !env.EMAIL_FROM_NAME) return 'missing_configuration';
  const timeoutMs = Number(env.EMAIL_TIMEOUT_MS ?? 10_000);
  if (!validEmail(env.EMAIL_FROM) || !env.EMAIL_FROM_NAME.trim() || env.EMAIL_FROM_NAME.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(env.BREVO_API_KEY + env.EMAIL_FROM_NAME) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) return 'invalid_configuration';
  return null;
}
async function boundedProviderJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 16_384) { await reader.cancel(); return {}; }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function retryDelay(response: Response, now: Date): number {
  const value = response.headers.get('retry-after');
  const seconds = value && /^\d+$/.test(value) ? Number(value) : value ? (Date.parse(value) - now.getTime()) / 1000 : 3600;
  return Math.max(60, Math.min(86_400, Number.isFinite(seconds) ? Math.ceil(seconds) : 3600));
}

/** Exactly one provider request; recipient and UUID come from a claimed immutable outbox row. */
export async function sendOutboxReceipt(
  env: PortalEmailEnvironment,
  message: { recipientEmail: string; recipientName: string; idempotencyKey: string; snapshot: ReceiptSnapshot; voidedAt?: string | null; voidReason?: string | null },
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<PortalEmailAttemptResult> {
  let rendered: RenderedReceipt;
  try {
    rendered = renderReceipt(message.snapshot, { voidedAt: message.voidedAt, voidReason: message.voidReason });
    if (!validEmail(message.recipientEmail) || !message.recipientName.trim() || message.recipientName.length > 160 ||
        /[\u0000-\u001f\u007f]/.test(message.recipientName) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.idempotencyKey)) {
      return { status: 'blocked', code: 'invalid_message', retryable: false };
    }
  } catch { return { status: 'blocked', code: 'invalid_message', retryable: false }; }
  if (env.EMAIL_MODE !== 'live') return { status: 'dry_run' };
  // Demo receipts cannot leave the local lab, even if live is accidentally selected.
  if (message.snapshot.demo) return { status: 'blocked', code: 'demo_receipt', retryable: false };
  const configError = configurationError(env);
  if (configError) return { status: 'blocked', code: configError, retryable: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.EMAIL_TIMEOUT_MS ?? 10_000));
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': env.BREVO_API_KEY! },
      body: JSON.stringify({ sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
        to: [{ email: message.recipientEmail, name: message.recipientName }], subject: rendered.subject,
        htmlContent: rendered.html, textContent: rendered.text,
        headers: { idempotencyKey: message.idempotencyKey }, tags: ['association-receipt'] }),
    });
    const body = await boundedProviderJson(response);
    if (response.status === 201) {
      if (typeof body.messageId !== 'string' || !body.messageId || body.messageId.length > 512 ||
          /[\u0000-\u001f\u007f]/.test(body.messageId)) {
        return { status: 'unknown', code: 'invalid_provider_response', retryable: false };
      }
      return { status: 'accepted', providerMessageId: body.messageId };
    }
    if (body.code === 'duplicate_parameter') return { status: 'unknown', code: 'duplicate_request', retryable: false };
    if (response.status === 429) return { status: 'rejected', code: 'provider_limit', retryable: true,
      retryAfterSeconds: retryDelay(response, now) };
    if (response.status === 401 || response.status === 403) return { status: 'rejected', code: 'provider_auth', retryable: true };
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return { status: 'rejected', code: 'provider_rejected', retryable: false };
    }
    return { status: 'unknown', code: 'provider_error', retryable: false };
  } catch { return { status: 'unknown', code: 'network_or_timeout', retryable: false }; }
  finally { clearTimeout(timer); }
}

export async function listEmailOutbox(db: D1Database, actor: Actor, limit = 100): Promise<EmailOutboxItem[]> {
  requireAdmin(actor);
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 100));
  const unresolved = "e.status IN ('queued','sending','blocked','rejected','unknown')";
  // Recent successful history must not push older unresolved mail out of view.
  const rows = await db.prepare(`${OUTBOX_SELECT} ORDER BY
    CASE WHEN ${unresolved} THEN 0 ELSE 1 END,
    CASE WHEN ${unresolved} THEN e.created_at END ASC,
    CASE WHEN NOT (${unresolved}) THEN e.created_at END DESC,
    e.id LIMIT ?`).bind(boundedLimit).all<OutboxRow>();
  return rows.results.map(mapRow);
}

/** A deliberate admin action sends at most five rows; obsolete queued recipients are cancelled first. */
export async function sendOutboxBatch(
  db: D1Database, actor: Actor, env: PortalEmailEnvironment, options: EmailBatchOptions = {},
): Promise<EmailBatchResult> {
  const live = env.EMAIL_MODE === 'live';
  requireAdmin(actor, live);
  const now = options.now ?? new Date();
  const at = timestamp(now);
  const day = at.slice(0, 10);
  const limit = Math.max(1, Math.min(5, Math.trunc(options.limit ?? 5) || 5));
  if (options.receiptId !== undefined && (!options.receiptId || options.receiptId.length > 128 || /[\u0000-\u001f\u007f]/.test(options.receiptId))) {
    throw new PortalError(400, 'Comprobante inválido para enviar correo.');
  }
  // A crashed or interrupted claim may already have reached Brevo. Never reset it to queued.
  await db.prepare(`UPDATE email_outbox SET status='unknown',last_error_code='interrupted_attempt',updated_at=?
    WHERE status='sending' AND claimed_at<?`).bind(at, new Date(now.getTime() - 300_000).toISOString()).run();
  // Self-service targets the original uploader; staff-assisted targets the designated adult.
  // Remove obsolete guardian/staff copies without retargeting immutable destinations.
  // Already accepted/ambiguous/in-flight history is preserved.
  const cancelled = await db.prepare(`UPDATE email_outbox SET status='cancelled',last_error_code='recipient_or_receipt_changed',updated_at=?
    WHERE status='queued' AND NOT (${AUTHORIZED_RECIPIENT})
    ${options.receiptId ? 'AND receipt_id=?' : ''} RETURNING id`)
    .bind(...[at, ...(options.receiptId ? [options.receiptId] : [])]).all<{ id: string }>();
  // Validate immutable addresses in JavaScript with the same strict validator used for delivery.
  // This also cancels invalid legacy rows whose scheduled attempt is still in the future.
  const queuedAddresses = await db.prepare(`SELECT id,recipient_email FROM email_outbox WHERE status='queued'
    ${options.receiptId ? 'AND receipt_id=?' : ''}`)
    .bind(...(options.receiptId ? [options.receiptId] : [])).all<{ id: string; recipient_email: string }>();
  for (const row of queuedAddresses.results) if (!validEmail(row.recipient_email)) {
    const result = await db.prepare(`UPDATE email_outbox SET status='cancelled',last_error_code='recipient_or_receipt_changed',updated_at=?
      WHERE id=? AND status='queued'`).bind(at, row.id).run();
    if (result.meta.changes) cancelled.results.push({ id: row.id });
  }
  const rows = await db.prepare(`${OUTBOX_SELECT} WHERE e.status='queued' AND e.next_attempt_at<=?
    ${options.receiptId ? 'AND e.receipt_id=?' : ''}
    ORDER BY e.next_attempt_at,e.created_at,e.id LIMIT ?`)
    .bind(...[at, ...(options.receiptId ? [options.receiptId] : []), limit]).all<OutboxRow>();
  const results: EmailBatchResult['results'] = cancelled.results.map(row => ({ id: row.id, status: 'cancelled', code: 'recipient_or_receipt_changed' }));
  for (const row of rows.results) {
    // Recheck eligibility if it changed after the batch scan.
    const cancellation = await db.prepare(`UPDATE email_outbox SET status='cancelled',last_error_code='recipient_or_receipt_changed',updated_at=?
      WHERE id=? AND status='queued' AND (NOT (${AUTHORIZED_RECIPIENT}) OR ?=0)`).bind(at, row.id, validEmail(row.recipient_email) ? 1 : 0).run();
    if (cancellation.meta.changes) { results.push({ id: row.id, status: 'cancelled', code: 'recipient_or_receipt_changed' }); continue; }
    const token = crypto.randomUUID();
    const budgeted = live && !configurationError(env);
    const statements: D1PreparedStatement[] = [];
    if (budgeted) statements.push(db.prepare('INSERT INTO portal_email_daily_budget(day,attempts) VALUES(?,0) ON CONFLICT(day) DO NOTHING').bind(day));
    statements.push(db.prepare(`UPDATE email_outbox SET status='sending',claim_token=?,claimed_at=?,attempts=attempts+1,updated_at=?
      WHERE id=? AND status='queued' AND next_attempt_at<=? AND ?=1 AND (${AUTHORIZED_RECIPIENT})
      ${budgeted ? 'AND (SELECT attempts FROM portal_email_daily_budget WHERE day=?)<250' : ''}`)
      .bind(...[token, at, at, row.id, at, validEmail(row.recipient_email) ? 1 : 0, ...(budgeted ? [day] : [])]));
    if (budgeted) statements.push(db.prepare(`UPDATE portal_email_daily_budget SET attempts=attempts+1 WHERE day=?
      AND EXISTS(SELECT 1 FROM email_outbox WHERE id=? AND status='sending' AND claim_token=?)`).bind(day, row.id, token));
    const claim = await db.batch(statements);
    if (!claim[budgeted ? 1 : 0]?.meta.changes) continue;
    let outcome: PortalEmailAttemptResult;
    try {
      outcome = await sendOutboxReceipt(env, { recipientEmail: row.recipient_email,
        recipientName: row.recipient_name, idempotencyKey: row.id,
        snapshot: JSON.parse(row.snapshot_json) as ReceiptSnapshot,
        voidedAt: row.kind === 'receipt_void' ? row.voided_at : undefined,
        voidReason: row.kind === 'receipt_void' ? row.void_reason : undefined }, options.fetcher, now);
    } catch { outcome = { status: 'blocked', code: 'invalid_message', retryable: false }; }
    const errorCode = 'code' in outcome ? outcome.code : null;
    const delay = 'retryAfterSeconds' in outcome ? outcome.retryAfterSeconds ?? 60 : 60;
    const retryAt = new Date(now.getTime() + delay * 1000).toISOString();
    // If persistence fails, retain sending: the next action marks it unknown, never retries blindly.
    await db.prepare(`UPDATE email_outbox SET status=?,last_error_code=?,provider_message_id=?,next_attempt_at=?,updated_at=?
      WHERE id=? AND status='sending' AND claim_token=?`)
      .bind(outcome.status, errorCode, 'providerMessageId' in outcome ? outcome.providerMessageId : null,
        retryAt, at, row.id, token).run();
    results.push({ id: row.id, status: outcome.status, ...(errorCode ? { code: errorCode } : {}) });
  }
  const remaining = await db.prepare(`SELECT count(*) AS count FROM email_outbox WHERE status='queued'
    ${options.receiptId ? 'AND receipt_id=?' : ''}`).bind(...(options.receiptId ? [options.receiptId] : [])).first<{count: number}>();
  const budget = await db.prepare('SELECT attempts FROM portal_email_daily_budget WHERE day=?').bind(day).first<{attempts: number}>();
  return { processed: results.length, remaining: remaining?.count ?? 0, dailyAttempts: budget?.attempts ?? 0, results };
}

/** Deliberately prepare the first email after a held recipient is repaired; never send or retarget here. */
export async function prepareReceiptEmail(
  db: D1Database, actor: Actor, receiptId: string, now = new Date(),
): Promise<{ outboxId: string; created: boolean }> {
  requireAdmin(actor);
  if (!receiptId || receiptId.length > 128 || /[\u0000-\u001f\u007f]/.test(receiptId)) {
    throw new PortalError(400, 'Comprobante inválido.', 'invalid_fields');
  }
  const at = timestamp(now);
  const activeActor = await db.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(actor.id).first<{id:string}>();
  if (!activeActor) throw new PortalError(403, 'La cuenta administrativa no está activa.', 'forbidden');
  const target = await db.prepare(`SELECT r.status AS receiptStatus,p.status AS paymentStatus,u.email
    FROM receipts r JOIN payments p ON p.id=r.payment_id LEFT JOIN users u ON u.id=p.designated_user_id
    WHERE r.id=?`).bind(receiptId).first<{receiptStatus:string;paymentStatus:string;email:string|null}>();
  if (!target) throw new PortalError(404, 'No se encontró el comprobante.', 'not_found');
  if (target.receiptStatus !== 'issued' || target.paymentStatus !== 'verified') {
    throw new PortalError(409, 'El comprobante no está emitido y vigente.', 'conflict');
  }
  const existingResult = async () => {
    const existing = await db.prepare(`SELECT e.id,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity_type='receipt'
      AND a.entity_id=e.receipt_id AND a.action='prepare_email' AND json_extract(a.detail_json,'$.outboxId')=e.id) AS prepared
      FROM email_outbox e WHERE e.receipt_id=? AND e.kind='receipt'`).bind(receiptId).all<{id:string;prepared:number}>();
    if (!existing.results.length) return null;
    // A repeated/lost-response request returns its existing preparation without changing its current status.
    if (existing.results.length === 1 && existing.results[0]!.prepared === 1) {
      return {outboxId:existing.results[0]!.id,created:false};
    }
    throw new PortalError(409, 'El comprobante ya tiene un correo registrado; no se cambia su destinatario.', 'existing_receipt_email');
  };
  const previous = await existingResult();
  if (previous) return previous;
  if (!validEmail(target.email)) throw new PortalError(409, 'Revisa la cuenta y el correo de la persona responsable.', 'recipient_pending');
  const outboxId = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,next_attempt_at,created_at,updated_at)
      SELECT ?,r.id,u.id,u.email,u.name,'receipt','queued',?,?,? FROM receipts r JOIN payments p ON p.id=r.payment_id
      JOIN users u ON u.id=p.designated_user_id AND u.active=1
      WHERE r.id=? AND r.status='issued' AND p.status='verified' AND u.email=?
        AND json_extract(r.snapshot_json,'$.designatedAdult.id')=u.id
        AND EXISTS(SELECT 1 FROM users staff WHERE staff.id=? AND staff.active=1)
        AND NOT EXISTS(SELECT 1 FROM email_outbox e WHERE e.receipt_id=r.id AND e.kind='receipt')
        AND NOT EXISTS(SELECT 1 FROM json_each(r.snapshot_json,'$.lines') line
          WHERE NOT EXISTS(SELECT 1 FROM guardian_links g WHERE g.user_id=u.id
            AND g.athlete_id=json_extract(line.value,'$.athleteId') AND g.active=1))`)
      .bind(outboxId,at,at,at,receiptId,target.email,actor.id),
    db.prepare(`INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at)
      SELECT ?,?,'receipt',e.receipt_id,'prepare_email',json_object('outboxId',e.id,'emailRecipientUserId',e.recipient_id,
        'emailRecipientPolicy',CASE WHEN p.submitted_by=p.designated_user_id THEN 'uploader_only' ELSE 'designated_adult' END,
        'emailRecipientPending',json('false')) ,? FROM email_outbox e JOIN receipts r ON r.id=e.receipt_id
      JOIN payments p ON p.id=r.payment_id WHERE e.id=?`)
      .bind(crypto.randomUUID(),actor.id,at,outboxId),
  ]);
  if (result[0]?.meta.changes) return {outboxId,created:true};
  const concurrent = await existingResult();
  if (concurrent) return concurrent;
  throw new PortalError(409, 'El comprobante o la cuenta responsable cambió; revisa sus datos y permisos.', 'recipient_pending');
}

/** Explicit safe retry. Reuse the existing UUID; ambiguous and accepted sends are never eligible. */
export async function retryEmailOutbox(db: D1Database, actor: Actor, id: string, now = new Date()): Promise<boolean> {
  requireAdmin(actor);
  const at = timestamp(now);
  const recipient = await db.prepare('SELECT recipient_email FROM email_outbox WHERE id=?').bind(id).first<{ recipient_email: string }>();
  const eligibleAddress = validEmail(recipient?.recipient_email) ? 1 : 0;
  await db.prepare(`UPDATE email_outbox SET status='cancelled',last_error_code='recipient_or_receipt_changed',updated_at=?
    WHERE id=? AND status IN ('queued','dry_run','blocked','rejected') AND (NOT (${AUTHORIZED_RECIPIENT}) OR ?=0)`).bind(at, id, eligibleAddress).run();
  const result = await db.prepare(`UPDATE email_outbox SET status='queued',claim_token=NULL,claimed_at=NULL,last_error_code=NULL,updated_at=?
    WHERE id=? AND next_attempt_at<=? AND (status='dry_run'
      OR (status='blocked' AND last_error_code IN ('missing_configuration','invalid_configuration'))
      OR (status='rejected' AND last_error_code IN ('provider_auth','provider_limit')))
    AND ?=1 AND (${AUTHORIZED_RECIPIENT})`).bind(at, id, at, eligibleAddress).run();
  return !!result.meta.changes;
}
