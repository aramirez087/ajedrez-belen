import assert from 'node:assert/strict';
import test from 'node:test';
import { familyMatches, normalizeSearch, paginate } from '../src/lib/portal/family-search.ts';
import type { Family } from '../src/lib/portal/types.ts';

const family = (adultName: string, email: string, athletes: string[] = []): Family =>
  ({ adultId: adultName, adultName, email, active: true, athletes: athletes.map(name => ({ name })) }) as unknown as Family;

test('search ignores case and accents in what is typed and what is stored', () => {
  assert.equal(normalizeSearch('Sofía'), 'sofia');
  assert.equal(normalizeSearch('SOFIA'), 'sofia');
  assert.equal(normalizeSearch('  Ñandú  '), 'nandu');
});

test('a family matches by athlete, adult or email, and an empty search matches everyone', () => {
  const ana = family('Ana Mora', 'ana@example.invalid', ['Sofía Mora', 'Timothy Mora']);
  assert.equal(familyMatches(ana, normalizeSearch('sofia')), true, 'athlete, accent-insensitive');
  assert.equal(familyMatches(ana, normalizeSearch('ANA mo')), true, 'adult name');
  assert.equal(familyMatches(ana, normalizeSearch('example.invalid')), true, 'email');
  assert.equal(familyMatches(ana, normalizeSearch('diego')), false);
  assert.equal(familyMatches(ana, normalizeSearch('')), true);
});

test('paginate clamps the requested page and reports the page count', () => {
  const items = Array.from({ length: 45 }, (_, index) => index);
  assert.deepEqual(paginate(items, '2').items, items.slice(20, 40));
  assert.equal(paginate(items, '2').pages, 3);
  assert.equal(paginate(items, '0').page, 1);
  assert.equal(paginate(items, '99').page, 3);
  assert.equal(paginate(items, 'x').page, 1);
  assert.equal(paginate(items, undefined).page, 1);
  assert.equal(paginate(items, '3').items.length, 5);
  assert.deepEqual(paginate([], '4'), { items: [], page: 1, pages: 1 });
});
