/** Most months a family can pay ahead in one transfer. */
export const MAX_ADVANCE_MONTHS = 12;
/** Longest run of covered months worth announcing; beyond it the figure stops being meaningful. */
const MAX_COVERED_MONTHS = 36;

/** `period` is `YYYY-MM`; negative `months` go back. */
export function addMonths(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function advanceMinor(months: number, monthlyRateMinor: number): number {
  return months * monthlyRateMinor;
}

/** The advance field's value: blank is none, otherwise a whole number from 0 to 12; anything else is invalid. */
export function advanceSelection(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const months = Number(trimmed);
  return months <= MAX_ADVANCE_MONTHS ? months : null;
}

export interface CreditCoverage { months: number; throughPeriod: string | null; leftoverMinor: number }

/** Whole months the credit pays for from `startPeriod`, the last month covered, and what is left over. */
export function creditCoverage(creditMinor: number, monthlyRateMinor: number, startPeriod: string): CreditCoverage {
  if (monthlyRateMinor <= 0 || creditMinor < monthlyRateMinor) return { months: 0, throughPeriod: null, leftoverMinor: creditMinor };
  const months = Math.min(MAX_COVERED_MONTHS, Math.floor(creditMinor / monthlyRateMinor));
  return { months, throughPeriod: addMonths(startPeriod, months - 1), leftoverMinor: creditMinor - months * monthlyRateMinor };
}
