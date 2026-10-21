import type { APIContext } from 'astro';
import { readBoundedBody, MAX_SLIP_BYTES, detectSlipType } from '../prototype-policy';
import { moneyMinor } from './money-input';
import { MAX_ADVANCE_MONTHS } from './advance';

export function portalResponse(body: BodyInit | null, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(body, { status, headers });
}

export class InputError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

function escapeMessageHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Designed standalone message page for browser navigations that cannot render the portal shell. */
export function portalMessagePage(title: string, message: string, status = 400, backHref = '/portal', backLabel = 'Volver a mi cuenta'): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeMessageHtml(title)} · Ajedrez Belén</title>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f7f4ec;color:#23281f;font-family:'DM Sans',Arial,sans-serif;line-height:1.65}main{width:100%;max-width:580px;padding:clamp(26px,6vw,44px);border:1px solid #d8d3c2;border-top:4px solid #8c302f;background:#fffdf7}.brand{margin:0 0 34px;font-size:15px;font-weight:700;letter-spacing:-.02em}.eyebrow{margin:0 0 12px;color:#8c302f;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:clamp(30px,6vw,42px);font-weight:600;line-height:1.12;letter-spacing:-.04em;text-wrap:balance}p{margin:18px 0 0;font-size:15.5px;color:#39402f}.actions{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:center;margin-top:30px}.action{display:inline-flex;align-items:center;justify-content:center;gap:18px;min-height:50px;padding:13px 20px;border:1px solid #8c302f;background:#8c302f;color:#f7f4ec;font-size:14px;font-weight:600;text-decoration:none;box-shadow:5px 5px 0 rgb(35 40 31/.9)}.action:hover{background:#6e2422}.help{color:#8c302f;font-size:13px;font-weight:600}a:focus-visible{outline:3px solid #8c302f;outline-offset:4px}@media(max-width:380px){body{padding:16px}.action{width:100%}}</style></head>
<body><main><p class="brand">Ajedrez Belén</p><p class="eyebrow">Portal de pagos</p><h1>${escapeMessageHtml(title)}</h1><p>${escapeMessageHtml(message)}</p><div class="actions"><a class="action" href="${escapeMessageHtml(backHref)}">${escapeMessageHtml(backLabel)} <span aria-hidden="true">→</span></a><a class="help" href="https://wa.me/50687686102">Consultar por WhatsApp ↗</a></div></main></body></html>`;
  return portalResponse(html, status, { 'Content-Type': 'text/html; charset=utf-8' });
}

/** A setup hold is temporary and must not expose configured account details. */
export function businessConfigurationUnavailable(request: Request): Response {
  return request.headers.get('accept')?.includes('application/json')
    ? portalResponse(JSON.stringify({ error: 'business_setup_required' }), 503, { 'Content-Type': 'application/json; charset=utf-8' })
    : portalMessagePage('El registro de pagos está en pausa.', 'El registro y la confirmación de nuevos pagos no están disponibles por el momento. Tu cuenta, tus mensualidades y tus comprobantes siguen disponibles. Contacta a la Asociación para confirmar la configuración de cobro.', 503);
}

export async function readPortalForm(request: Request, upload = false): Promise<FormData> {
  try {
    const bytes = await readBoundedBody(request, upload ? MAX_SLIP_BYTES + 65_536 : 32_768);
    return await new Response(bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
  } catch (error) {
    throw new InputError(error instanceof RangeError ? 'too_large' : 'invalid_form', error instanceof RangeError ? 413 : 400);
  }
}

/** Declared transfer reference. Empty is valid: OCR fills it and the registration field is read-only. */
export function formBankReference(form: FormData): string {
  const raw = form.get('bankReference');
  if (typeof raw !== 'string' || !raw.trim()) return '';
  return formText(form, 'bankReference', 128);
}

export function formText(form: FormData, key: string, max = 160, optional = false): string {
  const raw = form.get(key);
  const entry = typeof raw==='string' && ['reason','note','auditReason','discountReason'].includes(key)
    ? raw.replace(/\r?\n/g,' ') : raw;
  if (optional && (entry === null || entry === '')) return '';
  if (typeof entry !== 'string' || !entry.trim() || entry.length > max || /[\u0000-\u001f\u007f]/.test(entry)) {
    throw new InputError('invalid_fields');
  }
  return entry.trim();
}

/** Shared grammar with the browser: see money-input.ts. */
export function parseMoney(value: FormDataEntryValue | null, allowZero = false): number {
  const amount = moneyMinor(value, allowZero);
  if (amount === null) throw new InputError('invalid_amount');
  return amount;
}

export function parseAllocations(form: FormData): Array<{chargeId: string; amountMinor: number}> {
  const ids = form.getAll('allocationChargeId[]');
  const amounts = form.getAll('allocationAmount[]');
  if (ids.length !== amounts.length || ids.length > 48) throw new InputError('invalid_allocations');
  const allocations: Array<{chargeId: string; amountMinor: number}> = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const chargeId=ids[i];
    if (typeof chargeId !== 'string' || !chargeId || chargeId.length > 80 || seen.has(chargeId)) throw new InputError('invalid_allocations');
    seen.add(chargeId);
    const value = amounts[i];
    if (value === '') continue;
    const amountMinor = parseMoney(value, true);
    if (amountMinor === 0) continue;
    allocations.push({ chargeId, amountMinor });
  }
  return allocations;
}

/** Months the family chose to pay ahead: whole months from 0 to 12; absent or empty means none. */
export function parseAdvanceMonths(form: FormData): number {
  const value = form.get('advanceMonths');
  if (value === null || value === '') return 0;
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) throw new InputError('invalid_fields');
  const months = Number(value);
  if (months > MAX_ADVANCE_MONTHS) throw new InputError('invalid_fields');
  return months;
}

export async function readSlip(form: FormData, optional = false) {
  const file = form.get('slip');
  if (optional && (!(file instanceof File) || file.size === 0)) return null;
  if (!(file instanceof File) || file.size < 8 || file.size > MAX_SLIP_BYTES) throw new InputError('invalid_file');
  const bytes = await file.arrayBuffer();
  const contentType = detectSlipType(new Uint8Array(bytes));
  if (!contentType || (file.type && file.type !== contentType)) throw new InputError('invalid_file');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { bytes, contentType, size: file.size, sha256 };
}

const errorCodes = new Set([
  'too_large','invalid_form','invalid_fields','invalid_amount','invalid_allocations','invalid_file',
  'forbidden','not_found','conflict','duplicate_transfer','overallocated','already_verified',
  'invalid_period','invalid_discount','invalid_invitation','invitation_expired','email_mismatch',
  'recipient_missing','recipient_pending','existing_receipt_email',
  'bank_check_required','inactive_user','limit_reached','no_changes','not_retryable','setup_required',
  'invalid_request','limit','invitation_invalid','already_admin','bank_unconfirmed','allocation_exceeds_balance',
  'draft_not_found','draft_expired','draft_limit','draft_busy','draft_discard_failed',
  'ocr_disabled','ocr_busy','ocr_limit',
  'ocr_pdf_preview_required','invalid_image','original_missing','draft_mismatch',
  'invalid_event','invalid_recurrence','invalid_location','invalid_event_image','registration_limit',
]);

export function mutationError(context: APIContext, error: unknown, back: string): Response {
  const candidate = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const code = errorCodes.has(candidate) ? candidate : 'operation_failed';
  const status = error && typeof error === 'object' && 'status' in error && Number.isInteger(error.status)
    ? Number(error.status) : 400;
  if (context.request.headers.get('accept')?.includes('application/json')) {
    return portalResponse(JSON.stringify({ error: code }), status, { 'Content-Type': 'application/json' });
  }
  return portalResponse(null, 303, { Location: `${back}${back.includes('?') ? '&' : '?'}error=${code}` });
}

export function successRedirect(path: string, notice: string): Response {
  return portalResponse(null, 303, { Location: `${path}${path.includes('?') ? '&' : '?'}notice=${encodeURIComponent(notice)}` });
}

/** The administrator's decision on a pending registration: approve (optionally correcting the group) or reject with a reason. */
export function parseRegistrationReview(form: FormData): { action: 'approve'; category?: string } | { action: 'reject'; reason: string } {
  const action = formText(form, 'action', 20);
  if (action === 'approve') {
    const category = formText(form, 'category', 40, true);
    return category ? { action, category } : { action };
  }
  if (action === 'reject') return { action, reason: formText(form, 'reason', 300) };
  throw new InputError('invalid_fields');
}
