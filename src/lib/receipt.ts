/** Frozen receipt values, stored at issuance rather than read from mutable profiles. */
export interface ReceiptData {
  receiptNumber: string;
  payerName: string;
  athleteName: string;
  period: string;
  /** Amount actually paid, in CRC minor units (12,000 colones = 1,200,000). */
  amountMinor: number;
  /** An explicit, manually approved adjustment; never calculated from siblings. */
  discountMinor: number;
  bankReference: string;
  transferDate: string;
  issuedAt: string;
}

export type ReceiptSnapshot = Readonly<ReceiptData>;

export const PROTOTYPE_RECEIPT_NOTICE =
  'PRUEBA — Datos ficticios. No acredita un pago real ni constituye un comprobante de la Asociación.';

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The copy is shallow-frozen; every field is a primitive, so no mutable children remain. */
export function createReceiptSnapshot(input: ReceiptData): ReceiptSnapshot {
  if (!input || !boundedText(input.receiptNumber, 64) ||
      !/^[A-Za-z0-9-]+$/.test(input.receiptNumber) ||
      !boundedText(input.payerName, 160) || !boundedText(input.athleteName, 160) ||
      !boundedText(input.bankReference, 128) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) ||
      !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
      !Number.isSafeInteger(input.discountMinor) || input.discountMinor < 0 ||
      !Number.isSafeInteger(input.amountMinor + input.discountMinor) ||
      !validDate(input.transferDate) || typeof input.issuedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$/.test(input.issuedAt) ||
      !validDate(input.issuedAt.slice(0, 10)) || !Number.isFinite(Date.parse(input.issuedAt))) {
    throw new Error('Invalid receipt snapshot.');
  }

  // Pick only the immutable receipt fields; never copy a slip URL or authentication data.
  return Object.freeze({
    receiptNumber: input.receiptNumber,
    payerName: input.payerName,
    athleteName: input.athleteName,
    period: input.period,
    amountMinor: input.amountMinor,
    discountMinor: input.discountMinor,
    bankReference: input.bankReference,
    transferDate: input.transferDate,
    issuedAt: input.issuedAt,
  });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

const money = new Intl.NumberFormat('es-CR', {
  style: 'currency', currency: 'CRC', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat('es-CR', {
  dateStyle: 'long', timeZone: 'America/Costa_Rica',
});
const month = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function receiptRows(data: ReceiptSnapshot): ReadonlyArray<readonly [string, string]> {
  return [
    ['Número de prueba', data.receiptNumber],
    ['Pagado por', data.payerName],
    ['Atleta', data.athleteName],
    ['Mensualidad', month.format(new Date(`${data.period}-01T12:00:00.000Z`))],
    ['Monto del pago (CRC)', money.format(data.amountMinor / 100)],
    ['Descuento manual registrado', money.format(data.discountMinor / 100)],
    ['Referencia bancaria', data.bankReference],
    ['Fecha de transferencia', date.format(new Date(`${data.transferDate}T12:00:00.000Z`))],
    ['Fecha de emisión', date.format(new Date(data.issuedAt))],
  ];
}

export interface RenderedReceipt {
  subject: string;
  html: string;
  text: string;
}

/** Provider-independent test receipt. No tracking, remote images, or bank-slip attachment. */
export function renderReceipt(input: ReceiptData): RenderedReceipt {
  const data = createReceiptSnapshot(input);
  const rows = receiptRows(data);
  const title = 'Comprobante de prueba';
  const association = 'Asociación Deportiva Belemita de Ajedrez';
  const note = 'Este documento prueba el formato del futuro comprobante numerado. El descuento es un monto manual; no se aplica ninguna regla automática entre hermanos.';
  const replyNotice = 'Las respuestas a este correo no se atienden. Para consultas, escríbenos por';
  const whatsappUrl = 'https://wa.me/50687686102';
  return {
    subject: `[PRUEBA] Comprobante ${data.receiptNumber}`,
    text: [PROTOTYPE_RECEIPT_NOTICE, '', association, title, '',
      ...rows.map(([label, value]) => `${label}: ${value}`), '', note, '',
      `Correo automático. ${replyNotice} WhatsApp.`, whatsappUrl].join('\n'),
    html: `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>@media print { body { background: white !important; } main { border: 0 !important; max-width: none !important; } }</style></head>
<body style="margin:0;padding:24px;background:#f5f3ee;color:#20352d;font-family:Arial,sans-serif;line-height:1.5">
<main style="max-width:640px;margin:auto;background:#fff;border:1px solid #d8dfd8;padding:28px">
<p style="padding:12px;border:2px solid #886600;background:#fff8df;font-weight:bold">${escapeHtml(PROTOTYPE_RECEIPT_NOTICE)}</p>
<p style="font-size:14px">${escapeHtml(association)}</p><h1 style="font-size:26px">${escapeHtml(title)}</h1>
<table style="border-collapse:collapse;width:100%"><tbody>${rows.map(([label, value]) =>
        `<tr><th scope="row" style="text-align:left;vertical-align:top;padding:10px 12px 10px 0;border-bottom:1px solid #e1e5e1">${escapeHtml(label)}</th><td style="padding:10px 0;border-bottom:1px solid #e1e5e1;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>
<p style="font-size:13px;color:#526158">${escapeHtml(note)}</p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e1e5e1;font-size:13px;color:#526158"><strong>Correo automático.</strong> ${escapeHtml(replyNotice)} <a href="${whatsappUrl}" style="color:#20352d;text-decoration:underline">WhatsApp</a>.</p>
</main></body></html>`,
  };
}

export function renderReceiptHtml(data: ReceiptData): string {
  return renderReceipt(data).html;
}

export function renderReceiptText(data: ReceiptData): string {
  return renderReceipt(data).text;
}
