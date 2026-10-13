import { formText } from './http';
import { feeForCategory } from './domain';
import type { AthleteInput } from './types';

function part(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Compose YYYY-MM from the Spanish month/year selects; a legacy single field still works. */
export function formPeriod(form: FormData, base: string): string {
  const single = part(form, base);
  if (single) return single;
  const month = part(form, `${base}Month`), year = part(form, `${base}Year`);
  if (!month || !year) return '';
  return `${year}-${month.padStart(2, '0')}`;
}

/** Compose YYYY-MM-DD from the Spanish day/month/year selects; legacy single field still works. */
export function formDate(form: FormData, base: string): string {
  const single = part(form, base);
  if (single) return single;
  const day = part(form, `${base}Day`), month = part(form, `${base}Month`), year = part(form, `${base}Year`);
  if (!day || !month || !year) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function athleteFromForm(form: FormData): AthleteInput {
  const category = formText(form, 'category', 80);
  return {
    name: formText(form, 'name'), category,
    // La cuota se infiere de la categoría y no hay descuento manual.
    feeMinor: feeForCategory(category) ?? 0, discountMinor: 0, discountReason: undefined,
    active: form.get('active') === 'on', startPeriod: formPeriod(form, 'startPeriod'),
  };
}
