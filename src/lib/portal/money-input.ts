/**
 * One money grammar for server and browser. Costa Rican families write
 * amounts as 27.000 or 27.000,50, banking apps paste 27,000.00, and the
 * browser submits 27000.00 — all of them mean the same colones. Anything
 * ambiguous (mixed grouping, 3+ decimal digits without grouping, letters)
 * is rejected instead of guessed. Digits only; never binary floating point.
 */
export function moneyMinor(value: unknown, allowZero = false): number | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s\u00a0\u202f]/g, '').replace(/^₡/, '');
  if (!compact || /[^0-9.,]/.test(compact)) return null;
  let canonical: string;
  if (/^\d{1,10}$/.test(compact)) canonical = compact;
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact)) canonical = compact.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(compact)) canonical = compact.replace(/,/g, '');
  else if (/^\d{1,10},\d{1,2}$/.test(compact)) canonical = compact.replace(',', '.');
  else if (/^\d{1,10}\.\d{1,2}$/.test(compact)) canonical = compact;
  else return null;
  const [whole, fraction = ''] = canonical.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) && amount <= 1_000_000_000 ? amount : null;
}
