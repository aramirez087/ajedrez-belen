import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationSummary, minorAmount } from '../src/lib/portal/allocation-validation';

test('an empty, blank or zero distribution never qualifies as a credit-only payment or credit application', () => {
  assert.deepEqual(allocationSummary([]), { kind: 'empty', totalMinor: 0 });
  for (const values of [['0'], ['', '0.00'], ['0', '00.00', '']]) {
    assert.deepEqual(allocationSummary(values), { kind: 'missing_positive', totalMinor: 0 });
  }
});

test('one positive allocation enables a distribution and removing it returns to the required state', () => {
  const values = ['0', '0.01', ''];
  assert.deepEqual(allocationSummary(values), { kind: 'ready', totalMinor: 1 });
  assert.deepEqual(values, ['0', '0.01', ''], 'Validation never rewrites form values');
  values[1] = '0';
  assert.equal(allocationSummary(values).kind, 'missing_positive');
  values[1] = '12000.25';
  assert.deepEqual(allocationSummary(values), { kind: 'ready', totalMinor: 1_200_025 });
  assert.equal(minorAmount('13000'), 1_300_000, 'A valid partial distribution can still leave a credit');
});

test('allocation decimals match the server grammar and cannot be rounded or salvaged from malformed inputs', () => {
  for (const value of ['-1', '1e3', 'Infinity', 'NaN', '1.2345', '10000000.01']) {
    assert.equal(minorAmount(value, true), null, value);
    assert.equal(allocationSummary(['12000', value]).kind, 'invalid', value);
  }
  assert.equal(minorAmount('0'), null);
  assert.equal(minorAmount('0', true), 0);
  assert.equal(minorAmount('10000000'), 1_000_000_000);
  assert.deepEqual(allocationSummary(['12000.10', '15000.20']), { kind: 'ready', totalMinor: 2_700_030 });
});
