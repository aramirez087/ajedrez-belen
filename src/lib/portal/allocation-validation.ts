import { moneyMinor } from './money-input';

/** Same grammar as the server (money-input.ts): CR and banking-app formats. */
export function minorAmount(value: string, allowZero = false): number | null {
  return moneyMinor(value, allowZero);
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
