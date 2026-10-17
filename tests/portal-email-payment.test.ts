import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseEmailAllocations, readAmountMinor } from "../src/lib/portal/email-payment";
import type { Charge } from "../src/lib/portal/types";

function charge(id: string, athleteId: string, athleteName: string, period: string, balanceMinor = 1_500_000): Charge {
  return {
    id, athleteId, athleteName, period, dueDate: `${period}-08`, baseMinor: 1_500_000, discountMinor: 0,
    discountReason: null, totalMinor: 1_500_000, paidMinor: 1_500_000 - balanceMinor, balanceMinor,
  };
}

const none = new Map<string, number>();
const lines = (result: ReturnType<typeof chooseEmailAllocations>) =>
  result.map(line => [line.chargeId, line.amountMinor]);

test("emailed payments fill the oldest due month first and split the last one", () => {
  const charges = [charge("ana-09", "ana", "Ana Mora", "2026-09"), charge("ana-10", "ana", "Ana Mora", "2026-10")];
  assert.deepEqual(lines(chooseEmailAllocations(charges, none, 2_000_000, null, "2026-10")),
    [["ana-09", 1_500_000], ["ana-10", 500_000]]);
});

test("an amount above what is due stays as credit instead of paying ahead", () => {
  const charges = [charge("ana-10", "ana", "Ana Mora", "2026-10"), charge("ana-11", "ana", "Ana Mora", "2026-11")];
  assert.deepEqual(lines(chooseEmailAllocations(charges, none, 2_000_000, null, "2026-10")), [["ana-10", 1_500_000]]);
});

test("with nothing due yet, a published future month can be paid ahead", () => {
  const charges = [charge("ana-11", "ana", "Ana Mora", "2026-11")];
  assert.deepEqual(lines(chooseEmailAllocations(charges, none, 1_500_000, null, "2026-10")), [["ana-11", 1_500_000]]);
});

test("amounts already claimed by payments in review are not claimed twice", () => {
  const charges = [charge("ana-09", "ana", "Ana Mora", "2026-09"), charge("ana-10", "ana", "Ana Mora", "2026-10")];
  const requested = new Map([["ana-09", 1_500_000], ["ana-10", 1_000_000]]);
  assert.deepEqual(lines(chooseEmailAllocations(charges, requested, 1_500_000, null, "2026-10")), [["ana-10", 500_000]]);
  const covered = new Map([["ana-09", 1_500_000], ["ana-10", 1_500_000]]);
  assert.deepEqual(chooseEmailAllocations(charges, covered, 1_500_000, null, "2026-10"), []);
});

test("the athlete named in the transfer detail is paid first", () => {
  const charges = [
    charge("ana-09", "ana", "Ana Mora", "2026-09"), charge("luis-09", "luis", "Luis Mora", "2026-09"),
    charge("luis-10", "luis", "Luis Mora", "2026-10"),
  ];
  assert.deepEqual(lines(chooseEmailAllocations(charges, none, 3_000_000, "Mensualidad Luis Mora", "2026-10")),
    [["luis-09", 1_500_000], ["luis-10", 1_500_000]]);
  assert.deepEqual(lines(chooseEmailAllocations(charges, none, 3_000_000, "Ana y Luis", "2026-10")),
    [["ana-09", 1_500_000], ["luis-09", 1_500_000]]);
});

test("only a plain colón amount with cents is read", () => {
  assert.equal(readAmountMinor("12000.00"), 1_200_000);
  assert.equal(readAmountMinor("0.00"), null);
  assert.equal(readAmountMinor("12,000"), null);
  assert.equal(readAmountMinor(null), null);
});
