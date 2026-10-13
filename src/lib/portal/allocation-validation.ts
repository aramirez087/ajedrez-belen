/** Match the server's decimal grammar without rounding fractional colones. */
export function minorAmount(value: string, allowZero = false): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) && amount <= 1_000_000_000 ? amount : null;
}

export function allocationSummary(values: readonly string[]): {
  kind: 'empty' | 'invalid' | 'missing_positive' | 'ready'; totalMinor: number;
} {
  if (!values.length) return { kind: 'empty', totalMinor: 0 };
  let totalMinor = 0;
  for (const value of values) {
    const amount = value === '' ? 0 : minorAmount(value, true);
    if (amount === null || !Number.isSafeInteger(totalMinor + amount)) return { kind: 'invalid', totalMinor: 0 };
    totalMinor += amount;
  }
  return { kind: totalMinor > 0 ? 'ready' : 'missing_positive', totalMinor };
}
