export const currency = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyWhole = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });
/** Whole colones read without céntimos (₡27 000); exact cents keep two decimals. */
export function money(minor: number): string { return minor % 100 === 0 ? currencyWhole.format(minor / 100) : currency.format(minor / 100); }
export function inputMoney(minor: number): string { return (minor / 100).toFixed(2); }
export function monthLabel(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`));
}
export function dateLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.valueOf()) ? '—' : new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: value.length === 10 ? 'UTC' : 'America/Costa_Rica' }).format(parsed);
}
export const paymentLabels: Record<string, string> = { pending: 'En revisión', submitted: 'En revisión', needs_info: 'Necesita información', approved: 'Confirmado', verified: 'Confirmado', rejected: 'Rechazado', voided: 'Anulado', void: 'Anulado' };
export const emailLabels: Record<string, string> = { recipient_pending: 'Destinatario por revisar', pending: 'Por enviar', queued: 'Por enviar', ready: 'Por enviar', sending: 'Enviando', dry_run: 'Simulado', accepted: 'Aceptado por Brevo', sent: 'Aceptado por Brevo', blocked: 'Configuración pendiente', rejected: 'Rechazado por Brevo', unknown: 'Entrega por confirmar', failed: 'Error de envío', cancelled: 'Cancelado' };
