import assert from 'node:assert/strict';
import test from 'node:test';
import { addMonths, advanceMinor, advanceSelection, creditCoverage, MAX_ADVANCE_MONTHS } from '../src/lib/portal/advance.ts';

test('addMonths moves across month and year boundaries', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', 0), '2026-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('advanceMinor is months times the monthly rate', () => {
  assert.equal(advanceMinor(3, 1_500_000), 4_500_000);
  assert.equal(advanceMinor(0, 1_500_000), 0);
});

test('advanceSelection accepts blank and whole months from 0 to 12 only', () => {
  assert.equal(MAX_ADVANCE_MONTHS, 12);
  assert.equal(advanceSelection(''), 0);
  assert.equal(advanceSelection('0'), 0);
  assert.equal(advanceSelection('12'), 12);
  for (const bad of ['13', '-1', '1.5', 'x', '1e1', '+2']) assert.equal(advanceSelection(bad), null, bad);
});

test('credit coverage counts whole months from the start period and keeps the leftover', () => {
  assert.deepEqual(creditCoverage(4_500_000, 1_500_000, '2026-11'), { months: 3, throughPeriod: '2027-01', leftoverMinor: 0 });
  assert.equal(creditCoverage(4_600_000, 1_500_000, '2026-11').leftoverMinor, 100_000);
});

test('credit below one month, or a family with no monthly rate, covers no months', () => {
  assert.deepEqual(creditCoverage(1_400_000, 1_500_000, '2026-11'), { months: 0, throughPeriod: null, leftoverMinor: 1_400_000 });
  assert.deepEqual(creditCoverage(5_000_000, 0, '2026-11'), { months: 0, throughPeriod: null, leftoverMinor: 5_000_000 });
  assert.deepEqual(creditCoverage(0, 1_500_000, '2026-11'), { months: 0, throughPeriod: null, leftoverMinor: 0 });
});

test('coverage is capped at 36 months', () => {
  assert.equal(creditCoverage(1_000_000_000, 1_500_000, '2026-11').months, 36);
});
