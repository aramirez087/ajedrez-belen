import { suggestAthletes } from "./athlete-match";
import { billingPeriod, listParentCharges, submitPayment } from "./domain";
import { attachSlipDraft, type OcrSuggestions } from "./ocr";
import type { Actor, Charge, SlipMetadata } from "./types";

/** Tells the reviewer that nobody picked these months by hand. */
export const EMAIL_PAYMENT_NOTE = "Registrado por correo. Mensualidades elegidas automáticamente; confírmalas al verificar.";

/** A reading that may not describe a real transfer never registers by itself. */
const UNSAFE_WARNINGS = new Set(["not_transfer", "unreadable", "ambiguous"]);

export interface EmailAllocation { chargeId: string; amountMinor: number; athleteName: string; period: string }

export type EmailPaymentResult =
  | { kind: "registered"; paymentId: string; amountMinor: number; allocations: EmailAllocation[]; creditMinor: number }
  | { kind: "incomplete"; missing: Array<"amount" | "date"> }
  | { kind: "unsure" }
  | { kind: "duplicate"; paymentId: string }
  | { kind: "nothing_due" }
  | { kind: "covered" };

/** The parser's "12000.00" in minor units; anything else counts as unread. */
export function readAmountMinor(amount: string | null | undefined): number | null {
  if (!amount || !/^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(amount)) return null;
  const [whole, fraction] = amount.split(".");
  const minor = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * The same months «Pagar todo lo que vence» fills: charges due this month or
 * earlier, or every open charge when nothing is due yet. Amounts already
 * requested by payments in review are not claimed twice, and an athlete the
 * transfer detail names uniquely goes first. Whatever is left stays as credit.
 */
export function chooseEmailAllocations(
  charges: readonly Charge[],
  requested: ReadonlyMap<string, number>,
  amountMinor: number,
  description: string | null,
  currentPeriod: string,
): EmailAllocation[] {
  const open = charges
    .map(charge => ({ charge, openMinor: charge.balanceMinor - (requested.get(charge.id) ?? 0) }))
    .filter(entry => entry.openMinor > 0);
  const due = open.filter(entry => entry.charge.period <= currentPeriod);
  const candidates = due.length ? due : open;
  const athletes = [...new Map(candidates.map(({ charge }) => [charge.athleteId, { id: charge.athleteId, name: charge.athleteName }])).values()];
  const named = suggestAthletes(description, athletes);
  const first = named.kind === "unique" ? named.candidates[0]!.id : null;
  candidates.sort((a, b) =>
    Number(b.charge.athleteId === first) - Number(a.charge.athleteId === first) ||
    a.charge.period.localeCompare(b.charge.period));
  const allocations: EmailAllocation[] = [];
  let left = amountMinor;
  for (const { charge, openMinor } of candidates) {
    if (left <= 0) break;
    const share = Math.min(openMinor, left);
    allocations.push({ chargeId: charge.id, amountMinor: share, athleteName: charge.athleteName, period: charge.period });
    left -= share;
  }
  return allocations;
}

/** A live payment of this family that already holds the same file or bank reference. */
export async function findRegisteredPayment(
  db: D1Database,
  userId: string,
  match: { sha256: string } | { reference: string },
): Promise<string | null> {
  const row = "sha256" in match
    ? await db.prepare(
      "SELECT p.id FROM payment_files f JOIN payments p ON p.id=f.payment_id WHERE f.file_sha256=? AND (p.designated_user_id=? OR p.submitted_by=?) AND p.status NOT IN ('rejected','void') LIMIT 1",
    ).bind(match.sha256, userId, userId).first<{ id: string }>()
    : await db.prepare(
      "SELECT id FROM payments WHERE bank_reference=? AND (designated_user_id=? OR submitted_by=?) AND status NOT IN ('rejected','void') LIMIT 1",
    ).bind(match.reference, userId, userId).first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * An administrator who is also a guardian pays their own family by email when
 * the transfer detail names exactly one athlete linked to their own account.
 * Any other administrator file may belong to another family.
 */
export async function detailNamesOwnAthlete(db: D1Database, userId: string, description: string | null): Promise<boolean> {
  if (!description) return false;
  const linked = await db.prepare(
    "SELECT a.id, a.name FROM guardian_links l JOIN athletes a ON a.id=l.athlete_id WHERE l.user_id=? AND l.active=1",
  ).bind(userId).all<{ id: string; name: string }>();
  return suggestAthletes(description, linked.results).kind === "unique";
}

/** A payment the Asociación sent back to this person; an emailed file may be its correction. */
export async function findPaymentAwaitingCorrection(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(
    "SELECT id FROM payments WHERE submitted_by=? AND status='needs_info' ORDER BY submitted_at LIMIT 1",
  ).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

async function requestedInReview(db: D1Database, userId: string): Promise<Map<string, number>> {
  const result = await db.prepare(
    "SELECT a.charge_id AS chargeId, sum(a.amount_minor) AS amountMinor FROM payment_requested_allocations a JOIN payments p ON p.id=a.payment_id WHERE p.designated_user_id=? AND p.status IN ('pending','needs_info') GROUP BY a.charge_id",
  ).bind(userId).all<{ chargeId: string; amountMinor: number }>();
  return new Map(result.results.map(row => [row.chargeId, Number(row.amountMinor)]));
}

/**
 * Register an emailed slip as the sender's own pending payment when the
 * reading has an amount and a date. The Asociación still checks the bank and
 * confirms the months before any balance changes. Validation errors from
 * `submitPayment` propagate to the caller.
 */
export async function registerEmailedSlip(
  db: D1Database,
  actor: Actor,
  draft: { id: string; file: SlipMetadata },
  reading: OcrSuggestions | null,
  now = new Date(),
): Promise<EmailPaymentResult> {
  const amountMinor = readAmountMinor(reading?.amount);
  const transferDate = reading?.transferDate ?? null;
  if (!reading || !amountMinor || !transferDate) {
    return { kind: "incomplete", missing: [...(amountMinor ? [] : ["amount" as const]), ...(transferDate ? [] : ["date" as const])] };
  }
  if (reading.warnings.some(code => UNSAFE_WARNINGS.has(code))) return { kind: "unsure" };
  const bankReference = reading.bankReference?.trim() ?? "";
  const registered = bankReference ? await findRegisteredPayment(db, actor.id, { reference: bankReference }) : null;
  if (registered) return { kind: "duplicate", paymentId: registered };
  const charges = await listParentCharges(db, actor);
  if (!charges.some(charge => charge.balanceMinor > 0)) return { kind: "nothing_due" };
  const allocations = chooseEmailAllocations(charges, await requestedInReview(db, actor.id), amountMinor,
    reading.description, billingPeriod(now.toISOString()));
  if (!allocations.length) return { kind: "covered" };
  const paymentId = await submitPayment(db, actor, {
    submissionId: crypto.randomUUID(),
    designatedAdultId: actor.id,
    payerName: reading.payerName?.trim() || actor.name,
    amountMinor,
    transferDate,
    bankReference,
    allocations: allocations.map(({ chargeId, amountMinor: share }) => ({ chargeId, amountMinor: share })),
    note: EMAIL_PAYMENT_NOTE,
    file: draft.file,
  });
  // The payment already references the original; an interrupted attach is reconciled by cleanup.
  try { await attachSlipDraft(db, actor, draft.id, paymentId); } catch { /* See above. */ }
  const allocated = allocations.reduce((total, line) => total + line.amountMinor, 0);
  return { kind: "registered", paymentId, amountMinor, allocations, creditMinor: amountMinor - allocated };
}
