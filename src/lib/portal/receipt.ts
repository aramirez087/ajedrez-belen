import type { ReceiptSnapshot } from './types.ts';

export type FrozenReceiptSnapshot = Readonly<Omit<ReceiptSnapshot, 'lines' | 'designatedAdult'>> & {
  readonly lines: ReadonlyArray<Readonly<ReceiptSnapshot['lines'][number]>>;
  readonly designatedAdult: Readonly<ReceiptSnapshot['designatedAdult']>;
};

export interface ReceiptPresentation {
  voidedAt?: string | null;
  voidReason?: string | null;
  /** Display-only environment warning; never part of the issuance snapshot. */
  stagingTest?: boolean;
  /** Portal-only navigation back to the account; never sent by email. */
  portalBackLink?: boolean;
}

export interface RenderedReceipt { subject: string; html: string; text: string }

export const DEMO_RECEIPT_NOTICE = 'DEMOSTRACIÓN — Datos ficticios. Este documento no acredita un pago real.';
export const STAGING_RECEIPT_NOTICE = 'PRUEBA — Datos ficticios. Este documento no acredita un pago real.';

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) &&
    validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s\u0000-\u001f\u007f<>(),;:"\\@]+@[^\s\u0000-\u001f\u007f<>(),;:"\\@]+\.[^\s\u0000-\u001f\u007f<>(),;:"\\@]+$/.test(value);
}

// Historical contact metadata is not the delivery envelope. An absent address is
// stored as an empty string so a held email never prevents receipt rendering.
function snapshotContactEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 &&
    !/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(value);
}

/** Validate and copy every value before freezing the nested issuance snapshot. */
export function createReceiptSnapshot(input: ReceiptSnapshot): FrozenReceiptSnapshot {
  if (!input || input.version !== 1 || !text(input.receiptNumber, 64) ||
      !/^AB-\d{4}-\d{1,12}$/.test(input.receiptNumber) ||
      !text(input.associationName, 200) || !text(input.payerName, 160) ||
      !validDate(input.paymentDate) || !validTimestamp(input.issuedAt) || input.currency !== 'CRC' ||
      !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
      !Number.isSafeInteger(input.unallocatedMinor) || input.unallocatedMinor < 0 ||
      !text(input.bankReference, 128) || !text(input.bankName, 120) || !text(input.receivingAccount, 160) ||
      !input.designatedAdult || !text(input.designatedAdult.id, 128) ||
      !text(input.designatedAdult.name, 160) || !snapshotContactEmail(input.designatedAdult.email) ||
      typeof input.demo !== 'boolean' || !Array.isArray(input.lines) || input.lines.length > 100) {
    throw new Error('Invalid receipt snapshot.');
  }
  let allocatedMinor = 0;
  const chargeIds = new Set<string>();
  const lines = input.lines.map((line) => {
    if (!line || !text(line.athleteId, 128) || !text(line.athleteName, 160) || !text(line.chargeId, 128) ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(line.period) ||
        !Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0 || chargeIds.has(line.chargeId)) {
      throw new Error('Invalid receipt allocation.');
    }
    chargeIds.add(line.chargeId);
    allocatedMinor += line.amountMinor;
    if (!Number.isSafeInteger(allocatedMinor)) throw new Error('Invalid receipt total.');
    return Object.freeze({ athleteId: line.athleteId, athleteName: line.athleteName,
      chargeId: line.chargeId, period: line.period, amountMinor: line.amountMinor });
  });
  if (allocatedMinor + input.unallocatedMinor !== input.amountMinor) throw new Error('Receipt total does not match allocations.');
  return Object.freeze({ version: 1, receiptNumber: input.receiptNumber,
    associationName: input.associationName, payerName: input.payerName, paymentDate: input.paymentDate,
    issuedAt: input.issuedAt, currency: 'CRC', amountMinor: input.amountMinor,
    bankReference: input.bankReference, bankName: input.bankName, receivingAccount: input.receivingAccount,
    lines: Object.freeze(lines), unallocatedMinor: input.unallocatedMinor,
    designatedAdult: Object.freeze({ id: input.designatedAdult.id, name: input.designatedAdult.name,
      email: input.designatedAdult.email }), demo: input.demo });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;' })[character]!);
}

const money = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC',
  minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeZone: 'America/Costa_Rica' });
const month = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Association receipt, independent of a mail provider; bank evidence is never embedded. */
export function renderReceipt(input: ReceiptSnapshot, presentation: ReceiptPresentation = {}): RenderedReceipt {
  const data = createReceiptSnapshot(input);
  const stagingTest = presentation.stagingTest === true;
  const voided = !!presentation.voidedAt;
  if ((voided && (!validTimestamp(presentation.voidedAt) || !text(presentation.voidReason, 500))) ||
      (!voided && presentation.voidReason)) throw new Error('Invalid receipt void notice.');
  const title = voided ? 'Comprobante de pago anulado' : 'Comprobante de pago';
  const rows: Array<[string, string]> = [
    ['Número', data.receiptNumber], ['Pagado por', data.payerName],
    ['Fecha del pago', date.format(new Date(`${data.paymentDate}T12:00:00.000Z`))],
    ['Referencia bancaria', data.bankReference], ['Banco', data.bankName],
    ['Cuenta destino', data.receivingAccount], ['Monto recibido', money.format(data.amountMinor / 100)],
    ['Fecha de emisión', date.format(new Date(data.issuedAt))],
  ];
  const allocations = data.lines.map((line) => ({ athlete: line.athleteName,
    period: month.format(new Date(`${line.period}-01T12:00:00.000Z`)), amount: money.format(line.amountMinor / 100) }));
  const voidReason = presentation.voidReason?.trim() ?? '';
  const voidNotice = voided ? `ANULADO — ${voidReason}${/[.!?…]$/.test(voidReason) ? '' : '.'} Fecha de anulación: ${date.format(new Date(presentation.voidedAt!))}.` : '';
  const note = stagingTest
    ? 'Comprobante ficticio emitido durante una verificación simulada. No se recibieron fondos reales.'
    : 'Comprobante numerado emitido por la Asociación después de verificar el ingreso en la cuenta bancaria.';
  const credit = data.unallocatedMinor > 0 ? `Saldo a favor sin aplicar: ${money.format(data.unallocatedMinor / 100)}.` : '';
  const replyNotice = 'Las respuestas a este correo no se atienden. Para consultas, escríbenos por';
  const whatsappUrl = 'https://wa.me/50687686102';
  return {
    subject: `${data.demo ? '[DEMOSTRACIÓN] ' : ''}${voided ? '[ANULADO] ' : ''}Comprobante ${data.receiptNumber}`,
    text: [...(stagingTest ? [STAGING_RECEIPT_NOTICE] : []), data.demo ? DEMO_RECEIPT_NOTICE : '', voidNotice, data.associationName, title, '',
      ...rows.map(([label, value]) => `${label}: ${value}`), '', 'Aplicación del pago:',
      ...allocations.map((line) => `${line.athlete} — ${line.period}: ${line.amount}`), credit, '', note, '',
      `Correo automático. ${replyNotice} WhatsApp.`, whatsappUrl]
      .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n'),
    html: `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} ${escapeHtml(data.receiptNumber)}</title>
<style>@media print{body{background:white!important;padding:0!important}main{border:0!important;max-width:none!important}.print-button{display:none!important}}${stagingTest ? `
@media screen and (max-width:480px){body{padding:12px!important}main{padding:16px!important}table{table-layout:fixed}th,td{padding:6px 4px!important;font-size:13px;overflow-wrap:anywhere}h1{font-size:24px!important}}
@media print{@page{margin:12mm}body{font-size:12px;line-height:1.3!important}main{padding:12px!important}main>p{margin:8px 0!important;break-inside:avoid}main>p:first-child{padding:10px!important;font-size:14px!important}main>p:last-child{padding-top:8px!important;break-before:avoid}h1{font-size:22px!important}h2{font-size:16px!important;margin:14px 0 6px!important;break-after:avoid}th,td{padding:5px 4px!important}tr{break-inside:avoid}}` : ''}</style></head>
<body style="margin:0;padding:24px;background:#f7f4ec;color:#23281f;font-family:'DM Sans',Arial,sans-serif;line-height:1.5"><main style="max-width:720px;margin:auto;background:#fffdf7;border:1px solid #d8d3c2;border-top:4px solid #8c302f;padding:32px">
${stagingTest ? `<p style="margin:0 0 24px;padding:16px;border:3px solid #8c302f;background:#f3e3dc;color:#8c302f;font-size:18px;font-weight:bold;overflow-wrap:anywhere">${escapeHtml(STAGING_RECEIPT_NOTICE)}</p>\n` : ''}${data.demo ? `<p style="padding:12px;border:2px solid #ad7c14;background:#fff8df;font-weight:bold">${escapeHtml(DEMO_RECEIPT_NOTICE)}</p>` : ''}
${voided ? `<p style="padding:12px;border:2px solid #8c302f;color:#8c302f;font-weight:bold">${escapeHtml(voidNotice)}</p>` : ''}
<p style="font-size:14px;font-weight:bold;color:#8c302f;letter-spacing:.02em;text-transform:uppercase">${escapeHtml(data.associationName)}</p><h1 style="font-size:28px;margin:8px 0;font-family:Manrope,'DM Sans',Arial,sans-serif">${escapeHtml(title)}</h1><p style="font-size:18px;color:#8c302f;font-weight:bold">${escapeHtml(data.receiptNumber)}</p>
<table style="border-collapse:collapse;width:100%"><tbody>${rows.map(([label, value]) => `<tr><th scope="row" style="text-align:left;vertical-align:top;padding:9px 12px 9px 0;border-bottom:1px solid #ddd6c3">${escapeHtml(label)}</th><td style="padding:9px 0;border-bottom:1px solid #ddd6c3;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>
<h2 style="font-size:18px;margin-top:28px;font-family:Manrope,'DM Sans',Arial,sans-serif">Aplicación del pago</h2><table style="border-collapse:collapse;width:100%"><thead><tr><th scope="col" style="text-align:left;padding:8px 4px">Atleta</th><th scope="col" style="text-align:left;padding:8px 4px">Mensualidad</th><th scope="col" style="text-align:right;padding:8px 4px">Monto aplicado</th></tr></thead><tbody>${allocations.map((line) => `<tr><td style="padding:9px 4px;border-top:1px solid #ddd6c3;overflow-wrap:anywhere">${escapeHtml(line.athlete)}</td><td style="padding:9px 4px;border-top:1px solid #ddd6c3">${escapeHtml(line.period)}</td><td style="padding:9px 4px;border-top:1px solid #ddd6c3;text-align:right">${escapeHtml(line.amount)}</td></tr>`).join('')}</tbody></table>
${credit ? `<p style="font-weight:bold">${escapeHtml(credit)}</p>` : ''}<p style="margin-top:28px;font-size:13px;color:#5d6152">${escapeHtml(note)}</p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #ddd6c3;font-size:13px;color:#5d6152"><strong>Correo automático.</strong> ${escapeHtml(replyNotice)} <a href="${whatsappUrl}" style="color:#8c302f;text-decoration:underline">WhatsApp</a>.</p>
${presentation.portalBackLink ? `<p class="print-button" style="margin-top:24px;font-size:14px"><a href="/portal" style="color:#8c302f;font-weight:bold">← Volver a mi cuenta</a></p><p class="print-button" style="font-size:13px;color:#5d6152">Para guardarlo: usa Compartir → Imprimir (o «Guardar como PDF») en tu navegador. Este comprobante queda siempre disponible en tu cuenta.</p>` : ''}
</main></body></html>`,
  };
}

export function renderReceiptHtml(input: ReceiptSnapshot, presentation?: ReceiptPresentation): string {
  return renderReceipt(input, presentation).html;
}
export function renderReceiptText(input: ReceiptSnapshot, presentation?: ReceiptPresentation): string {
  return renderReceipt(input, presentation).text;
}
