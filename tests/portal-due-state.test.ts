import assert from 'node:assert/strict';
import test from 'node:test';
import { dueLabel, dueState } from '../src/components/portal/format';

test('due state classifies overdue, today, soon and future by CR calendar day', () => {
  assert.deepEqual(dueState('2026-10-08', '2026-10-14'), { kind: 'overdue', days: 6 });
  assert.deepEqual(dueState('2026-10-14', '2026-10-14'), { kind: 'today', days: 0 });
  assert.deepEqual(dueState('2026-10-20', '2026-10-14'), { kind: 'soon', days: 6 });
  assert.deepEqual(dueState('2026-11-08', '2026-10-14'), { kind: 'future', days: 25 });
});

test('due label speaks in vencido/vence terms a parent understands', () => {
  assert.equal(dueLabel('2026-10-13', '2026-10-14'), 'Venció hace 1 día');
  assert.equal(dueLabel('2026-10-08', '2026-10-14'), 'Venció hace 6 días');
  assert.equal(dueLabel('2026-10-14', '2026-10-14'), 'Vence hoy');
  assert.match(dueLabel('2026-11-08', '2026-10-14'), /^Vence el /);
});
