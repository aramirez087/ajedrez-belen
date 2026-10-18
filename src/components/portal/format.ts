export const currency = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyWhole = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });
/** Whole colones read without céntimos (₡27 000); exact cents keep two decimals. */
export function money(minor: number): string { return minor % 100 === 0 ? currencyWhole.format(minor / 100) : currency.format(minor / 100); }
export function inputMoney(minor: number): string { return (minor / 100).toFixed(2); }
/** How a person would type it: whole colones without trailing decimals. */
export function plainMoney(minor: number): string { return minor % 100 === 0 ? String(minor / 100) : inputMoney(minor); }
export const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'] as const;
export function monthLabel(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`));
}
/** Declared transfer reference. Empty means OCR did not read one; the payment can still be registered. */
export function referenceLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || 'Sin referencia leída';
}
/** Families match a transfer by its last digits; the full number stays in administration. */
export function shortReferenceLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Sin referencia leída';
  return trimmed.length > 12 ? `…${trimmed.slice(-8)}` : trimmed;
}
export function dateLabel(value: string | null): string {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.valueOf()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: value.length === 10 ? 'UTC' : 'America/Costa_Rica' }).format(parsed);
}
/** Date and time as a person says it: "17 oct, 3:45 p. m." (Costa Rica). */
export function dateTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Costa_Rica' }).format(parsed);
}
/** "24 oct", for dates that are obviously this year. */
export function dayLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short', timeZone: 'America/Costa_Rica' }).format(parsed);
}
export function fileKindLabel(type: string): string { return type === 'application/pdf' ? 'PDF' : type === 'image/png' ? 'Imagen PNG' : 'Imagen JPG'; }
export const paymentLabels: Record<string, string> = { pending: 'En revisión', submitted: 'En revisión', needs_info: 'Te falta un dato', approved: 'Confirmado', verified: 'Confirmado', rejected: 'Rechazado', voided: 'Anulado', void: 'Anulado' };
/** Due-date state for a charge. Dates are `YYYY-MM-DD` (CR calendar days). */
export function dueState(dueDate: string, today: string): { kind: 'overdue' | 'today' | 'soon' | 'future'; days: number } {
  const ms = (value: string) => new Date(`${value}T12:00:00Z`).valueOf();
  const days = Math.round((ms(dueDate) - ms(today)) / 86_400_000);
  if (Number.isNaN(days)) return { kind: 'future', days: 0 };
  return days < 0 ? { kind: 'overdue', days: -days } : days === 0 ? { kind: 'today', days: 0 } : days <= 8 ? { kind: 'soon', days } : { kind: 'future', days };
}
export function dueLabel(dueDate: string, today: string): string {
  const state = dueState(dueDate, today);
  if (state.kind === 'overdue') return state.days === 1 ? 'Venció hace 1 día' : `Venció hace ${state.days} días`;
  if (state.kind === 'today') return 'Vence hoy';
  return `Vence el ${dateLabel(dueDate)}`;
}
/** One plain sentence per status: who acts next, family side. */
export const paymentHints: Record<string, string> = {
  pending: 'La Asociación lo está revisando. No tienes que hacer nada.',
  submitted: 'La Asociación lo está revisando. No tienes que hacer nada.',
  needs_info: 'La Asociación necesita un dato más de ti. Toca «Completar información».',
  verified: 'Pago confirmado en el banco.',
  approved: 'Pago confirmado en el banco.',
  rejected: 'No se pudo aceptar. Abre el pago para ver el motivo y qué hacer.',
  voided: 'Este pago se anuló. Abre el pago para ver el motivo.',
  void: 'Este pago se anuló. Abre el pago para ver el motivo.',
};
export const emailLabels: Record<string, string> = { recipient_pending: 'Destinatario por revisar', pending: 'Por enviar', queued: 'Por enviar', ready: 'Por enviar', sending: 'Enviando', dry_run: 'Simulado', accepted: 'Aceptado por Brevo', sent: 'Aceptado por Brevo', blocked: 'Configuración pendiente', rejected: 'Rechazado por Brevo', unknown: 'Entrega por confirmar', failed: 'Error de envío', cancelled: 'Cancelado' };
/** Families never need provider names: did the email go out or not. */
export const familyEmailLabels: Record<string, string> = { recipient_pending: 'Aún no enviado', pending: 'Aún no enviado', queued: 'Aún no enviado', ready: 'Aún no enviado', sending: 'Enviándose…', dry_run: 'Aún no enviado', accepted: 'Correo enviado', sent: 'Correo enviado', blocked: 'No se pudo enviar', rejected: 'No se pudo enviar', unknown: 'Por confirmar', failed: 'No se pudo enviar', cancelled: 'No se envió' };
