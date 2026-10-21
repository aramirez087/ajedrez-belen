import type { Family } from './types';

/** Lowercase, accent-free and trimmed, so "sofia" finds "Sofía" and the reverse. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').trim();
}

/** A family matches when the adult's name or email, or any athlete's name, contains the (already normalized) query. */
export function familyMatches(family: Family, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return normalizeSearch(`${family.adultName} ${family.email}`).includes(normalizedQuery)
    || family.athletes.some(athlete => normalizeSearch(athlete.name).includes(normalizedQuery));
}

/** One page of a list; the requested page (usually a query-string value) is clamped into range. */
export function paginate<T>(items: readonly T[], requestedPage: unknown, size = 20): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const requested = Number(requestedPage);
  const page = Number.isFinite(requested) ? Math.max(1, Math.min(pages, Math.floor(requested))) : 1;
  return { items: items.slice((page - 1) * size, page * size), page, pages };
}
