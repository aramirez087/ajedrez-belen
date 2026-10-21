import { addMonths, creditCoverage, type CreditCoverage } from "./advance";
import { validEmail } from "./receipt";
import {
  PortalError,
  type Actor,
  type Athlete,
  type AthleteInput,
  type Charge,
  type Family,
  type MonthlyPreview,
  type ParentDashboard,
  type AdminDashboard,
  type Payment,
  type PaymentDetail,
  type PaymentFile,
  type Receipt,
  type ReceiptSnapshot,
  type RequestedAllocation,
  type ReviewPaymentInput,
  type PaymentReviewSnapshot,
  type ChargeAdjustmentInput,
  type ApplyPaymentCreditInput,
  type SubmitPaymentInput,
} from "./types";

const iso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
// UUIDv4 values for set-based inserts; provider idempotency keys stay stable.
const sqlUuid =
  "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
function fail(message: string, status = 400, code = "invalid_request"): never {
  throw new PortalError(status, message, code);
}
const admin = (actor: Actor) => {
  if (!actor.isAdmin)
    fail("Se requiere una cuenta administrativa.", 403, "forbidden");
};
function text(value: unknown, max = 160): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail("Texto inválido.");
  return (value as string).trim();
}
/** Empty is valid. Used for the declared bank reference, which OCR fills and families do not type. */
function optionalText(value: unknown, max = 160): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    fail("Texto inválido.");
  return value.trim();
}
function amount(value: unknown, allowZero = false): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < (allowZero ? 0 : 1) ||
    (value as number) > 1000000000
  )
    fail("Monto inválido.");
  return value as number;
}
export function validatePeriod(value: string): string {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) fail("Mes inválido.");
  return value;
}
export function billingPeriod(instant: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
/**
 * First billed month for a new enrollment. Fees are payable within the first
 * eight days, so registering on or before the 8th (Costa Rica) bills that
 * month; from the 9th onward billing starts the following month and the rest
 * of the registration month is not charged.
 */
export function billingStartPeriod(instant: string): string {
  const period = billingPeriod(instant);
  const day = Number(costaRicaToday(instant).slice(8, 10));
  if (day <= 8) return period;
  const [year, month] = period.split("-").map(Number);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return `${next[0]}-${String(next[1]).padStart(2, "0")}`;
}
export function billingYear(instant: string): number {
  return Number(billingPeriod(instant).slice(0, 4));
}
function date(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail("Fecha inválida.");
  return value;
}
function bindings(db: D1Database, sql: string, args: unknown[] = []) {
  return db.prepare(sql).bind(...args);
}
async function rows<T>(
  db: D1Database,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await bindings(db, sql, args).all<T>()).results;
}
async function one<T>(
  db: D1Database,
  sql: string,
  args: unknown[] = [],
): Promise<T | null> {
  return bindings(db, sql, args).first<T>();
}
function audit(
  db: D1Database,
  actor: Actor,
  entity: string,
  entityId: string,
  action: string,
  detail: unknown,
  now: string,
) {
  return bindings(
    db,
    "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
    [id(), actor.id, entity, entityId, action, JSON.stringify(detail), now],
  );
}
function paymentAudit(
  db: D1Database,
  actor: Actor,
  paymentId: string,
  action: string,
  detail: unknown,
  now: string,
  token: string,
) {
  return bindings(
    db,
    "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,'payment',id,?,?,? FROM payments WHERE id=? AND approval_token=?",
    [id(), actor.id, action, JSON.stringify(detail), now, paymentId, token],
  );
}
async function batch(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    return await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/bank_match/i.test(message))
      fail(
        "Esa referencia bancaria ya está registrada.",
        409,
        "duplicate_transfer",
      );
    if (
      /UNIQUE|allocation_exceeds|allocation_guardian_revoked|adjustment_below_paid|payment_not_verified|constraint|pending_payment_limit|daily_payment_limit|storage_limit|athlete_limit/i.test(
        message,
      )
    )
      fail(
        "El registro cambió o entra en conflicto con otro pago. Actualice y vuelva a revisar.",
        409,
        "conflict",
      );
    throw error;
  }
}

export async function ensureUser(
  db: D1Database,
  actor: Actor,
): Promise<{ id: string; active: boolean }> {
  const now = iso();
  await bindings(
    db,
    "INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,updated_at=excluded.updated_at",
    [
      actor.id,
      text(actor.email, 254).toLowerCase(),
      text(actor.name),
      now,
      now,
    ],
  ).run();
  const user = await one<{ id: string; active: number }>(
    db,
    "SELECT id,active FROM users WHERE id=?",
    [actor.id],
  );
  return { id: actor.id, active: user?.active === 1 };
}
async function activeUser(db: D1Database, userId: string) {
  const user = await one<{ id: string; name: string; email: string }>(
    db,
    "SELECT id,name,email FROM users WHERE id=? AND active=1",
    [userId],
  );
  if (!user) fail("La cuenta no está activa.", 403, "forbidden");
  return user!;
}
async function requireActor(db: D1Database, actor: Actor) {
  await activeUser(db, actor.id);
}

const athleteSql =
  "SELECT id,name,category,fee_minor AS feeMinor,discount_minor AS discountMinor,discount_reason AS discountReason,active,start_period AS startPeriod FROM athletes";
const athleteSnapshotSql = "json_array(name,category,fee_minor,discount_minor,discount_reason,active,start_period)";
/** Compare the values actually shown, including active status; timestamps can collide. */
export function athleteFeeSnapshot(athlete: Athlete): string {
  return JSON.stringify([athlete.name, athlete.category, athlete.feeMinor, athlete.discountMinor,
    athlete.discountReason, athlete.active ? 1 : 0, athlete.startPeriod]);
}
function monthlySnapshot(period: string, athletes: Athlete[]): string {
  return JSON.stringify([period, [...athletes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(athlete => [athlete.id, ...JSON.parse(athleteFeeSnapshot(athlete))])]);
}
type PreviewAthlete = Athlete & { siblingMinor?: number; familySize?: number };
function previewSnapshot(period: string, athletes: PreviewAthlete[]): string {
  return JSON.stringify([period, [...athletes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(athlete => [athlete.id, ...JSON.parse(athleteFeeSnapshot(athlete)), athlete.siblingMinor ?? 0, athlete.familySize ?? 1])]);
}
export const SIBLING_DISCOUNT_REASON = "Descuento hermanos 25%";
/** Siblings share at least one active guardian; groups merge transitively. */
export function siblingFamilySizes(links: Array<{ userId: string; athleteId: string }>, athleteIds: string[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const athleteId of athleteIds) parent.set(`a:${athleteId}`, `a:${athleteId}`);
  for (const link of links) {
    if (!parent.has(`a:${link.athleteId}`)) continue;
    const userNode = `u:${link.userId}`;
    if (!parent.has(userNode)) parent.set(userNode, userNode);
    const ra = find(`a:${link.athleteId}`);
    const ru = find(userNode);
    if (ra !== ru) parent.set(ra, ru);
  }
  const counts = new Map<string, number>();
  for (const athleteId of athleteIds) {
    const root = find(`a:${athleteId}`);
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return new Map(athleteIds.map((athleteId) => [athleteId, counts.get(find(`a:${athleteId}`)) ?? 1]));
}
async function siblingDiscounts(db: D1Database, athletes: Athlete[]): Promise<Map<string, { siblingMinor: number; familySize: number }>> {
  if (!athletes.length) return new Map();
  const billedIds = athletes.map((a) => a.id);
  // A paused athlete is still enrolled, so the sibling who is billed this month
  // keeps the family rate. A baja (active=0) has left and does not.
  const paused = await rows<{ id: string }>(
    db,
    `SELECT id FROM athletes WHERE active=1 AND paused=1 AND id NOT IN (${billedIds.map(() => "?").join(",")})`,
    billedIds,
  );
  const countingIds = [...billedIds, ...paused.map((athlete) => athlete.id)];
  const links = await rows<{ userId: string; athleteId: string }>(
    db,
    `SELECT user_id AS userId, athlete_id AS athleteId FROM guardian_links WHERE active=1 AND athlete_id IN (${countingIds.map(() => "?").join(",")})`,
    countingIds,
  );
  const sizes = siblingFamilySizes(links, countingIds);
  return new Map(athletes.map((a) => {
    const familySize = sizes.get(a.id) ?? 1;
    const siblingMinor = familySize > 1 ? Math.round(a.feeMinor * 0.25) : 0;
    return [a.id, { siblingMinor, familySize }];
  }));
}
async function snapshotDigest(snapshot: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
// This roster deliberately excludes publication state, so an unchanged replay is
// idempotent. Fee/profile/eligibility changes and newly eligible athletes invalidate it.
const monthlySnapshotSql = `(SELECT json_array(?,json_group_array(json_array(id,name,category,fee_minor,discount_minor,discount_reason,active,start_period))) FROM (SELECT id,name,category,fee_minor,discount_minor,discount_reason,active,start_period FROM athletes WHERE active=1 AND paused=0 AND start_period<=? ORDER BY id))`;
const chargeSql = `SELECT c.id,c.athlete_id AS athleteId,s.name AS athleteName,c.period,c.due_date AS dueDate,c.base_minor AS baseMinor,c.discount_minor AS discountMinor,c.discount_reason AS discountReason,c.base_minor-c.discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=c.id),0) AS totalMinor,COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=c.id AND p.status='verified'),0) AS paidMinor FROM charges c JOIN athletes s ON s.id=c.athlete_id`;
const paymentFields = `p.id,p.designated_user_id AS designatedAdultId,p.submitted_by AS submitterId,p.payer_name AS payerName,p.amount_minor AS amountMinor,p.transfer_date AS transferDate,p.bank_reference AS bankReference,p.status,p.review_note AS reviewNote,p.submitted_at AS submittedAt,p.revision,p.verified_amount_minor AS verifiedAmountMinor,CASE WHEN p.status='verified' THEN p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) ELSE 0 END AS unallocatedMinor,r.id AS receiptId,r.number AS receiptNumber`;
const paymentFrom = `FROM payments p LEFT JOIN receipts r ON r.payment_id=p.id`;
const paymentSql = `SELECT ${paymentFields} ${paymentFrom}`;
// Dashboard affordances and detail authorization must use the same current-link rule.
const paymentDetailAccess = `(?=1 OR ((p.designated_user_id=? OR p.submitted_by=?) AND NOT EXISTS(SELECT 1 FROM payment_requested_allocations a JOIN charges c ON c.id=a.charge_id WHERE a.payment_id=p.id AND NOT EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1))))`;
function chargeMap(charges: Omit<Charge, "balanceMinor">[]): Charge[] {
  return charges.map((c) => ({
    ...c,
    balanceMinor: c.totalMinor - c.paidMinor,
  }));
}
function athleteMap(
  athletes: Array<Athlete & { active: boolean | number }>,
): Athlete[] {
  return athletes.map((a) => ({ ...a, active: !!a.active }));
}
export async function listParentCharges(
  db: D1Database,
  actor: Actor,
): Promise<Charge[]> {
  await requireActor(db, actor);
  return chargeMap(
    await rows(
      db,
      `${chargeSql} WHERE EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1) ORDER BY c.period,c.created_at`,
      [actor.id],
    ),
  );
}
export async function getChargesForAdult(
  db: D1Database,
  actor: Actor,
  adultId: string,
): Promise<Charge[]> {
  admin(actor);
  await requireActor(db, actor);
  await activeUser(db, adultId);
  return chargeMap(
    await rows(
      db,
      `${chargeSql} WHERE EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1) ORDER BY c.period,c.created_at`,
      [adultId],
    ),
  );
}
export async function getParentDashboard(
  db: D1Database,
  actor: Actor,
): Promise<ParentDashboard> {
  await requireActor(db, actor);
  const [athletes, charges, payments, receipts, totals] = await Promise.all([
    rows<Athlete>(
      db,
      `${athleteSql} WHERE id IN(SELECT athlete_id FROM guardian_links WHERE user_id=? AND active=1) ORDER BY name`,
      [actor.id],
    ),
    listParentCharges(db, actor),
    rows<Payment & { canOpenDetail: number }>(
      db,
      `SELECT ${paymentFields},${paymentDetailAccess} AS canOpenDetail ${paymentFrom} WHERE p.designated_user_id=? OR p.submitted_by=? ORDER BY CASE WHEN p.status IN ('pending','needs_info') THEN 0 WHEN p.status='verified' AND p.verified_amount_minor>COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) THEN 1 ELSE 2 END,p.submitted_at DESC LIMIT 200`,
      [actor.isAdmin ? 1 : 0, actor.id, actor.id, actor.id, actor.id, actor.id],
    ),
    listReceipts(db, actor),
    one<{ pendingMinor: number; creditMinor: number }>(
      db,
      "SELECT COALESCE(sum(CASE WHEN p.status IN ('pending','needs_info') THEN p.amount_minor ELSE 0 END),0) AS pendingMinor,COALESCE(sum(CASE WHEN p.status='verified' THEN p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) ELSE 0 END),0) AS creditMinor FROM payments p WHERE p.designated_user_id=? OR p.submitted_by=?",
      [actor.id, actor.id],
    ),
  ]);
  return {
    athletes: athleteMap(athletes),
    charges,
    payments: payments.map(payment => ({ ...payment, canOpenDetail: payment.canOpenDetail === 1 })),
    receipts,
    balanceMinor: charges.reduce((s, c) => s + c.balanceMinor, 0),
    pendingMinor: totals?.pendingMinor || 0,
    creditMinor: totals?.creditMinor || 0,
  };
}
export async function getAdminDashboard(
  db: D1Database,
): Promise<AdminDashboard> {
  const [
    payments,
    charges,
    athletes,
    receipts,
    email,
    paymentTotals,
    chargeTotals,
  ] = await Promise.all([
    rows<Payment>(
      db,
      `${paymentSql} ORDER BY CASE WHEN p.status IN ('pending','needs_info') THEN 0 ELSE 1 END,CASE WHEN p.status IN ('pending','needs_info') THEN p.submitted_at END ASC,p.submitted_at DESC LIMIT 500`,
    ),
    rows<Omit<Charge, "balanceMinor">>(
      db,
      `${chargeSql} ORDER BY c.period DESC,s.name LIMIT 2000`,
    ),
    rows<Athlete>(db, `${athleteSql} ORDER BY name`),
    receiptRows(db),
    one<{ n: number }>(
      db,
      "SELECT count(*) n FROM email_outbox WHERE status IN ('queued','sending','blocked','rejected','unknown')",
    ),
    one<{ pendingCount: number; verifiedMinor: number; creditMinor: number }>(
      db,
      "SELECT COALESCE(sum(CASE WHEN p.status IN ('pending','needs_info') THEN 1 ELSE 0 END),0) AS pendingCount,COALESCE(sum(CASE WHEN p.status='verified' THEN p.verified_amount_minor ELSE 0 END),0) AS verifiedMinor,COALESCE(sum(CASE WHEN p.status='verified' THEN p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) ELSE 0 END),0) AS creditMinor FROM payments p",
    ),
    one<{ balanceMinor: number }>(
      db,
      `SELECT COALESCE(sum(totalMinor-paidMinor),0) AS balanceMinor FROM (${chargeSql})`,
    ),
  ]);
  const mapped = chargeMap(charges);
  return {
    payments,
    charges: mapped,
    athletes: athleteMap(athletes),
    receipts,
    pendingCount: paymentTotals?.pendingCount || 0,
    balanceMinor: chargeTotals?.balanceMinor || 0,
    verifiedMinor: paymentTotals?.verifiedMinor || 0,
    creditMinor: paymentTotals?.creditMinor || 0,
    emailPendingCount: email?.n || 0,
  };
}
export async function listFamilies(db: D1Database): Promise<Family[]> {
  const adults = await rows<{
    id: string;
    name: string;
    email: string;
    active: number;
  }>(db, "SELECT id,name,email,active FROM users ORDER BY name");
  const links = await rows<Athlete & { userId: string; receiptOptIn: number }>(
    db,
    "SELECT s.id,s.name,s.category,s.fee_minor AS feeMinor,s.discount_minor AS discountMinor,s.discount_reason AS discountReason,s.active,s.start_period AS startPeriod,l.user_id AS userId,l.receipt_opt_in AS receiptOptIn FROM guardian_links l JOIN athletes s ON s.id=l.athlete_id WHERE l.active=1 ORDER BY s.name",
  );
  return adults.map((u) => ({
    adultId: u.id,
    adultName: u.name,
    email: u.email,
    active: !!u.active,
    athletes: links
      .filter((l) => l.userId === u.id)
      .map((l) => ({
        ...l,
        active: !!l.active,
        receiptOptIn: !!l.receiptOptIn,
      })),
  }));
}
/**
 * What each active adult would be charged per month for the athletes billed in `period`
 * (sibling discount included, exactly as publishing computes it). Adults with nothing billable are absent.
 */
export async function familyMonthlyRates(db: D1Database, period: string): Promise<Map<string, number>> {
  validatePeriod(period);
  const billed = await rows<Athlete>(db, `${athleteSql} WHERE active=1 AND paused=0 AND start_period<=?`, [period]);
  if (!billed.length) return new Map();
  const discounts = await siblingDiscounts(db, billed);
  const net = new Map(billed.map((a) => [a.id, a.feeMinor - Math.min(a.feeMinor, discounts.get(a.id)?.siblingMinor ?? 0)]));
  const links = await rows<{ userId: string; athleteId: string }>(
    db,
    "SELECT l.user_id AS userId,l.athlete_id AS athleteId FROM guardian_links l JOIN users u ON u.id=l.user_id AND u.active=1 JOIN athletes a ON a.id=l.athlete_id WHERE l.active=1 AND a.active=1 AND a.paused=0 AND a.start_period<=?",
    [period],
  );
  const rates = new Map<string, number>();
  for (const link of links) rates.set(link.userId, (rates.get(link.userId) ?? 0) + (net.get(link.athleteId) ?? 0));
  return rates;
}
/**
 * The advance form's numbers for one family: the monthly rate from next month on, and how far the
 * credit already held reaches. Next month is where coverage starts because settling only touches
 * months up to the current one.
 */
export async function advanceQuote(
  db: D1Database,
  adultId: string,
  creditMinor = 0,
  instant: string = iso(),
): Promise<{ monthlyRateMinor: number } & CreditCoverage> {
  const startPeriod = addMonths(billingPeriod(instant), 1);
  const monthlyRateMinor = (await familyMonthlyRates(db, startPeriod)).get(adultId) ?? 0;
  return { monthlyRateMinor, ...creditCoverage(creditMinor, monthlyRateMinor, startPeriod) };
}
/** Balance owed and unapplied credit for every account that has either, in two grouped queries. */
export async function listFamilyMoney(db: D1Database): Promise<Map<string, { balanceMinor: number; creditMinor: number }>> {
  const [balances, credits] = await Promise.all([
    rows<{ adultId: string; balanceMinor: number }>(
      db,
      `SELECT l.user_id AS adultId,COALESCE(sum(t.balance),0) AS balanceMinor FROM guardian_links l
       JOIN (SELECT c.athlete_id,c.base_minor-c.discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=c.id),0)-COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=c.id AND p.status='verified'),0) AS balance FROM charges c) t ON t.athlete_id=l.athlete_id
       WHERE l.active=1 GROUP BY l.user_id`,
    ),
    rows<{ adultId: string; creditMinor: number }>(
      db,
      "SELECT p.designated_user_id AS adultId,COALESCE(sum(p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0)),0) AS creditMinor FROM payments p WHERE p.status='verified' GROUP BY p.designated_user_id",
    ),
  ]);
  const money = new Map<string, { balanceMinor: number; creditMinor: number }>();
  for (const row of balances) money.set(row.adultId, { balanceMinor: row.balanceMinor, creditMinor: 0 });
  for (const row of credits) money.set(row.adultId, { balanceMinor: money.get(row.adultId)?.balanceMinor ?? 0, creditMinor: row.creditMinor });
  return money;
}
export async function getMonthlyPreview(
  db: D1Database,
  period: string,
): Promise<MonthlyPreview> {
  validatePeriod(period);
  const base = athleteMap(
    await rows<Athlete & { alreadyPublished: number }>(
      db,
      `${athleteSql.replace(" FROM athletes", ",EXISTS(SELECT 1 FROM charges c WHERE c.athlete_id=athletes.id AND c.period=?) AS alreadyPublished FROM athletes")} WHERE active=1 AND paused=0 AND start_period<=? ORDER BY name`,
      [period, period],
    ),
  );
  const discounts = await siblingDiscounts(db, base);
  const athletes = base.map((a) => {
    const sibling = discounts.get(a.id) ?? { siblingMinor: 0, familySize: 1 };
    return {
      ...a,
      alreadyPublished: !!(a as Athlete & { alreadyPublished: number })
        .alreadyPublished,
      siblingMinor: sibling.siblingMinor,
      familySize: sibling.familySize,
      totalMinor: a.feeMinor - sibling.siblingMinor,
    };
  });
  return {
    period,
    snapshot: await snapshotDigest(previewSnapshot(period, athletes)),
    dueDate: `${period}-08`,
    athletes,
    newCount: athletes.filter((a) => !a.alreadyPublished).length,
    totalMinor: athletes
      .filter((a) => !a.alreadyPublished)
      .reduce((s, a) => s + a.totalMinor, 0),
  };
}

const receiptAccess = `EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.active=1) AND (p.designated_user_id=? OR EXISTS(SELECT 1 FROM email_outbox e WHERE e.receipt_id=r.id AND e.recipient_id=?)) AND NOT EXISTS(SELECT 1 FROM json_each(r.snapshot_json,'$.lines') line WHERE NOT EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=json_extract(line.value,'$.athleteId') AND l.active=1 AND (p.designated_user_id=? OR l.receipt_opt_in=1)))`;
async function receiptRows(
  db: D1Database,
  where = "",
  args: unknown[] = [],
): Promise<Receipt[]> {
  const found = await rows<{
    id: string;
    paymentId: string;
    number: string;
    status: "issued" | "void";
    snapshotJson: string;
    voidReason: string | null;
    voidedAt: string | null;
    emailStatus: string | null;
    canPrepareEmail: number;
  }>(
    db,
    `SELECT r.id,r.payment_id AS paymentId,r.number,r.status,r.snapshot_json AS snapshotJson,r.void_reason AS voidReason,r.voided_at AS voidedAt,COALESCE((SELECT e.status FROM email_outbox e WHERE e.receipt_id=r.id AND e.recipient_id=p.designated_user_id AND e.kind=CASE WHEN r.status='void' THEN 'receipt_void' ELSE 'receipt' END ORDER BY e.updated_at DESC LIMIT 1),'recipient_pending') AS emailStatus,(r.status='issued' AND p.status='verified' AND NOT EXISTS(SELECT 1 FROM email_outbox e WHERE e.receipt_id=r.id AND e.kind='receipt')) AS canPrepareEmail FROM receipts r JOIN payments p ON p.id=r.payment_id ${where} ORDER BY r.created_at DESC LIMIT 500`,
    args,
  );
  return found.map(({ snapshotJson, canPrepareEmail, ...r }) => ({
    ...r,
    canPrepareEmail: canPrepareEmail === 1,
    snapshot: JSON.parse(snapshotJson) as ReceiptSnapshot,
  }));
}
export async function listReceipts(
  db: D1Database,
  actor: Actor,
): Promise<Receipt[]> {
  await requireActor(db, actor);
  return actor.isAdmin
    ? receiptRows(db)
    : receiptRows(db, `WHERE ${receiptAccess}`, Array(5).fill(actor.id));
}
export async function getReceipt(
  db: D1Database,
  actor: Actor,
  receiptId: string,
): Promise<Receipt> {
  await requireActor(db, actor);
  const found = await receiptRows(
    db,
    `WHERE r.id=? ${actor.isAdmin ? "" : `AND ${receiptAccess}`}`,
    [receiptId, ...(actor.isAdmin ? [] : Array(5).fill(actor.id))],
  );
  if (!found[0]) fail("Comprobante no disponible.", 404, "not_found");
  return found[0]!;
}
async function authorizedPayment(
  db: D1Database,
  actor: Actor,
  paymentId: string,
): Promise<Payment> {
  await requireActor(db, actor);
  const payment = await one<Payment>(
    db,
    `${paymentSql} WHERE p.id=? AND ${paymentDetailAccess}`,
    [paymentId, actor.isAdmin ? 1 : 0, actor.id, actor.id, actor.id],
  );
  if (!payment) fail("Pago no disponible.", 404, "not_found");
  return payment!;
}
export async function getPaymentFile(
  db: D1Database,
  actor: Actor,
  fileId: string,
): Promise<PaymentFile> {
  await requireActor(db, actor);
  const file = await one<PaymentFile>(
    db,
    "SELECT f.id,f.payment_id AS paymentId,f.file_key AS key,f.file_type AS type,f.file_size AS size,f.file_sha256 AS sha256,f.revision,f.created_at AS createdAt FROM payment_files f JOIN payments p ON p.id=f.payment_id WHERE f.id=? AND (?=1 OR p.submitted_by=? OR (p.designated_user_id=? AND p.share_evidence=1))",
    [fileId, actor.isAdmin ? 1 : 0, actor.id, actor.id],
  );
  if (!file) fail("Archivo no disponible.", 404, "not_found");
  return file!;
}
export async function getPaymentDetail(
  db: D1Database,
  actor: Actor,
  paymentId: string,
): Promise<PaymentDetail> {
  const payment = await authorizedPayment(db, actor, paymentId);
  const [files, requestedAllocations, revisions, events] = await Promise.all([
    rows<PaymentFile>(
      db,
      "SELECT f.id,f.payment_id AS paymentId,f.file_key AS key,f.file_type AS type,f.file_size AS size,f.file_sha256 AS sha256,f.revision,f.created_at AS createdAt FROM payment_files f JOIN payments p ON p.id=f.payment_id WHERE f.payment_id=? AND (?=1 OR p.submitted_by=? OR (p.designated_user_id=? AND p.share_evidence=1)) ORDER BY f.revision DESC",
      [paymentId, actor.isAdmin ? 1 : 0, actor.id, actor.id],
    ),
    rows<
      RequestedAllocation & {
        athleteId: string;
        athleteName: string;
        period: string;
        balanceMinor: number;
      }
    >(
      db,
      `SELECT a.charge_id AS chargeId,a.amount_minor AS amountMinor,c.athlete_id AS athleteId,s.name AS athleteName,c.period,c.base_minor-c.discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=c.id),0)-COALESCE((SELECT sum(pa.amount_minor) FROM payment_allocations pa JOIN payments pp ON pp.id=pa.payment_id WHERE pa.charge_id=c.id AND pp.status='verified'),0) AS balanceMinor FROM payment_requested_allocations a JOIN charges c ON c.id=a.charge_id JOIN athletes s ON s.id=c.athlete_id WHERE a.payment_id=?`,
      [paymentId],
    ),
    rows<PaymentDetail["revisions"][number]>(
      db,
      "SELECT id,payer_name AS payerName,amount_minor AS amountMinor,transfer_date AS transferDate,bank_reference AS bankReference,note,created_at AS createdAt FROM payment_revisions WHERE payment_id=? ORDER BY revision DESC",
      [paymentId],
    ),
    actor.isAdmin
      ? rows<{ action: string; detail: string; createdAt: string }>(
          db,
          "SELECT action,detail_json AS detail,created_at AS createdAt FROM audit_events WHERE entity_type='payment' AND entity_id=? ORDER BY created_at",
          [paymentId],
        )
      : Promise.resolve([]),
  ]);
  let receipt: Receipt | null = null;
  if (payment.receiptId)
    try {
      receipt = await getReceipt(db, actor, payment.receiptId);
    } catch (error) {
      if (!(error instanceof PortalError && error.status === 404)) throw error;
    }
  return {
    payment,
    files,
    requestedAllocations,
    revisions,
    audit: events,
    receipt,
  };
}

export const ATHLETE_CATEGORIES = ["Iniciación", "Cadetes", "Intermedios", "Avanzados"] as const;
/** La cuota se infiere de la categoría; no se captura por separado. */
export function feeForCategory(category: string): number | null {
  if (category === "Iniciación") return 1200000;
  if (category === "Cadetes" || category === "Intermedios" || category === "Avanzados") return 1500000;
  return null;
}
/** Sin descuento manual: el único descuento es el de hermanos, al publicar. */
function athleteInput(input: AthleteInput, schedule?: Record<string, number>): AthleteInput {
  text(input.name);
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const feeMinor = schedule?.[category] ?? feeForCategory(category);
  if (feeMinor === null || feeMinor === undefined) fail("Elige la categoría del atleta.");
  validatePeriod(input.startPeriod);
  return { ...input, category, feeMinor, discountMinor: 0, discountReason: undefined };
}

export const DEFAULT_FEES: Record<string, number> = {
  "Iniciación": 1200000, "Cadetes": 1500000, "Intermedios": 1500000, "Avanzados": 1500000,
};
/** Montos vigentes por categoría; sin la migración 0007 rigen los valores por defecto. */
export async function getFeeSchedule(db: D1Database): Promise<Record<string, number>> {
  const schedule = { ...DEFAULT_FEES };
  try {
    const stored = await rows<{ category: string; feeMinor: number }>(db, "SELECT category, fee_minor AS feeMinor FROM fee_schedule");
    for (const row of stored) if (row.category in schedule && Number.isSafeInteger(row.feeMinor) && row.feeMinor > 0) schedule[row.category] = row.feeMinor;
  } catch { /* Base anterior a la migración: se usan los montos por defecto. */ }
  return schedule;
}
/** Actualiza los montos y los aplica a los atletas de cada categoría; los cargos ya publicados no cambian. */
export async function updateFeeSchedule(db: D1Database, actor: Actor, fees: Record<string, number>): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  const entries = ATHLETE_CATEGORIES.map((category) => [category, fees[category]] as const);
  for (const [category, feeMinor] of entries) {
    if (!Number.isSafeInteger(feeMinor) || feeMinor <= 0 || feeMinor > 100_000_000)
      fail(`Revisa el monto de ${category}.`);
  }
  const now = iso();
  await batch(db, [
    ...entries.map(([category, feeMinor]) => bindings(db,
      "INSERT INTO fee_schedule(category,fee_minor,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(category) DO UPDATE SET fee_minor=excluded.fee_minor,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
      [category, feeMinor, now, actor.id])),
    ...entries.map(([category, feeMinor]) => bindings(db,
      "UPDATE athletes SET fee_minor=?,updated_at=? WHERE category=?", [feeMinor, now, category])),
    audit(db, actor, "fee_schedule", "categories", "update", Object.fromEntries(entries), now),
  ]);
}
export async function enrollAthlete(
  db: D1Database,
  actor: Actor,
  input: AthleteInput,
): Promise<string> {
  admin(actor);
  await requireActor(db, actor);
  input = athleteInput(input, await getFeeSchedule(db));
  const count = await one<{ n: number }>(db, "SELECT count(*) n FROM athletes");
  if ((count?.n || 0) >= 300)
    fail("Se alcanzó el límite de atletas.", 409, "limit");
  const athleteId = id(),
    now = iso();
  await batch(db, [
    bindings(
      db,
      "INSERT INTO athletes(id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        athleteId,
        input.name.trim(),
        input.category.trim(),
        input.feeMinor,
        input.discountMinor,
        input.discountReason?.trim() || null,
        input.active === false ? 0 : 1,
        input.startPeriod,
        now,
        now,
      ],
    ),
    audit(db, actor, "athlete", athleteId, "enroll", input, now),
  ]);
  return athleteId;
}
export async function setAthleteFee(
  db: D1Database,
  actor: Actor,
  athleteId: string,
  input: AthleteInput,
  expectedSnapshot: string,
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  input = athleteInput(input, await getFeeSchedule(db));
  const expected = text(expectedSnapshot, 2048);
  if (!(await one(db, "SELECT id FROM athletes WHERE id=?", [athleteId])))
    fail("Atleta no disponible.", 404, "not_found");
  const now = iso();
  const result = await batch(db, [
    bindings(db,
      `INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,'athlete',id,'update',?,? FROM athletes WHERE id=? AND ${athleteSnapshotSql}=?`,
      [id(), actor.id, JSON.stringify(input), now, athleteId, expected]),
    bindings(
      db,
      `UPDATE athletes SET name=?,category=?,fee_minor=?,discount_minor=?,discount_reason=?,active=?,start_period=?,updated_at=? WHERE id=? AND ${athleteSnapshotSql}=?`,
      [
        input.name.trim(),
        input.category.trim(),
        input.feeMinor,
        input.discountMinor,
        input.discountReason?.trim() || null,
        input.active === false ? 0 : 1,
        input.startPeriod,
        now,
        athleteId,
        expected,
      ],
    ),
  ]);
  if (!result[1].meta.changes)
    fail("Los datos o la cuota cambiaron. Actualiza la página antes de guardar.", 409, "conflict");
}
export async function linkGuardian(
  db: D1Database,
  actor: Actor,
  input: { userId: string; athleteId: string; receiptOptIn?: boolean },
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  await activeUser(db, input.userId);
  if (!(await one(db, "SELECT id FROM athletes WHERE id=?", [input.athleteId])))
    fail("Atleta no disponible.", 404, "not_found");
  const now = iso();
  await batch(db, [
    bindings(
      db,
      "INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(user_id,athlete_id) DO UPDATE SET active=1,receipt_opt_in=excluded.receipt_opt_in,linked_by=excluded.linked_by,updated_at=excluded.updated_at",
      [
        input.userId,
        input.athleteId,
        input.receiptOptIn ? 1 : 0,
        actor.id,
        now,
        now,
      ],
    ),
    audit(
      db,
      actor,
      "athlete",
      input.athleteId,
      "link_guardian",
      { userId: input.userId, receiptOptIn: !!input.receiptOptIn },
      now,
    ),
  ]);
}
export async function revokeGuardian(
  db: D1Database,
  actor: Actor,
  input: { userId: string; athleteId: string },
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  const now = iso();
  await batch(db, [
    bindings(
      db,
      "UPDATE guardian_links SET active=0,receipt_opt_in=0,updated_at=? WHERE user_id=? AND athlete_id=?",
      [now, input.userId, input.athleteId],
    ),
    // A pending multi-athlete invitation is one grant: revoke the entire old
    // token, then require a fresh deliberate invitation for any restored access.
    // Expiring at creation also defeats a redemption that read it before this
    // batch, even when both operations have the same millisecond timestamp.
    bindings(
      db,
      `UPDATE invitations SET expires_at=created_at WHERE redeemed_at IS NULL
        AND email=(SELECT email FROM users WHERE id=?) COLLATE NOCASE
        AND EXISTS(SELECT 1 FROM json_each(athlete_ids_json) WHERE value=?)`,
      [input.userId, input.athleteId],
    ),
    audit(db, actor, "athlete", input.athleteId, "revoke_guardian", input, now),
  ]);
}
export async function setReceiptConsent(
  db: D1Database,
  actor: Actor,
  input: { userId: string; athleteId: string; receiptOptIn: boolean },
): Promise<void> {
  if (input.userId !== actor.id && !actor.isAdmin)
    fail("Acceso denegado.", 403, "forbidden");
  await requireActor(db, actor);
  const now = iso(),
    optIn = input.receiptOptIn ? 1 : 0;
  const result = await batch(db, [
    bindings(
      db,
      "UPDATE guardian_links SET receipt_opt_in=?,updated_at=? WHERE user_id=? AND athlete_id=? AND active=1",
      [optIn, now, input.userId, input.athleteId],
    ),
    bindings(
      db,
      "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,'athlete',athlete_id,'receipt_consent',?,? FROM guardian_links WHERE user_id=? AND athlete_id=? AND active=1 AND updated_at=? AND receipt_opt_in=?",
      [
        id(),
        actor.id,
        JSON.stringify(input),
        now,
        input.userId,
        input.athleteId,
        now,
        optIn,
      ],
    ),
  ]);
  if (!result[0].meta.changes) fail("Vínculo no disponible.", 404, "not_found");
}
export type InvitationKind = "link" | "register";

export async function createInvitation(
  db: D1Database,
  actor: Actor,
  input: {
    email: string;
    athleteIds: string[];
    tokenHash: string;
    expiresAt?: string;
    kind?: InvitationKind;
  },
): Promise<string> {
  admin(actor);
  await requireActor(db, actor);
  const kind: InvitationKind = input.kind === "register" ? "register" : "link";
  const email = text(input.email, 254).toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (kind === "link" && (!input.athleteIds.length || input.athleteIds.length > 10)) ||
    (kind === "register" && input.athleteIds.length > 0) ||
    new Set(input.athleteIds).size !== input.athleteIds.length ||
    !/^[a-f0-9]{64}$/.test(input.tokenHash)
  )
    fail("Invitación inválida.");
  for (const athleteId of input.athleteIds)
    if (!(await one(db, "SELECT id FROM athletes WHERE id=?", [athleteId])))
      fail("Atleta no disponible.", 404, "not_found");
  const invitationId = id(),
    now = iso(),
    expiresAt =
      input.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || expiresAt <= now)
    fail("Vencimiento inválido.");
  await batch(db, [
    bindings(
      db,
      "INSERT INTO invitations(id,token_hash,email,athlete_ids_json,invited_by,expires_at,created_at,kind) VALUES(?,?,?,?,?,?,?,?)",
      [
        invitationId,
        input.tokenHash,
        email,
        JSON.stringify(input.athleteIds),
        actor.id,
        expiresAt,
        now,
        kind,
      ],
    ),
    audit(
      db,
      actor,
      "invitation",
      invitationId,
      "create",
      { email, athleteIds: input.athleteIds, kind },
      now,
    ),
  ]);
  return invitationId;
}
/**
 * A guardian invites the other guardian to their own athletes. The invited
 * person gets exactly the athletes the inviter is linked to — never more —
 * through the same link invitation an administrator would create.
 */
const GUARDIAN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** True when the optional other-parent address cannot receive an invitation. */
export function coGuardianEmailProblem(email: string, actorEmail: string): boolean {
  const value = email.trim().toLowerCase();
  return value.length === 0 || value.length > 254 || !GUARDIAN_EMAIL.test(value) || value === actorEmail.trim().toLowerCase();
}
export async function createGuardianInvitation(
  db: D1Database,
  actor: Actor,
  input: { email: string; athleteIds: string[]; tokenHash: string; expiresAt?: string },
): Promise<string> {
  await requireActor(db, actor);
  const email = text(input.email, 254).toLowerCase();
  if (
    coGuardianEmailProblem(email, actor.email) ||
    !input.athleteIds.length ||
    input.athleteIds.length > 10 ||
    new Set(input.athleteIds).size !== input.athleteIds.length ||
    !/^[a-f0-9]{64}$/.test(input.tokenHash)
  )
    fail(email === actor.email.toLowerCase() ? "Usa el correo de la otra persona encargada." : "Invitación inválida.");
  for (const athleteId of input.athleteIds) {
    const link = await one(
      db,
      "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND athlete_id=? AND active=1 LIMIT 1",
      [actor.id, athleteId],
    );
    if (!link) fail("Solo puedes compartir atletas vinculados a tu cuenta.", 403, "forbidden");
  }
  const invitationId = id(),
    now = iso(),
    expiresAt = input.expiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || expiresAt <= now)
    fail("Vencimiento inválido.");
  await batch(db, [
    bindings(
      db,
      "INSERT INTO invitations(id,token_hash,email,athlete_ids_json,invited_by,expires_at,created_at,kind) VALUES(?,?,?,?,?,?,?,'link')",
      [invitationId, input.tokenHash, email, JSON.stringify(input.athleteIds), actor.id, expiresAt, now],
    ),
    audit(db, actor, "invitation", invitationId, "create", { email, athleteIds: input.athleteIds, via: "guardian" }, now),
  ]);
  return invitationId;
}

export type InvitationPreview = {
  status: "ready" | "used" | "expired" | "not_found";
  email: string | null;
  expiresAt: string | null;
  kind: InvitationKind | null;
};

/** Read-only check so the invitation page can explain itself before accepting. */
export async function getInvitationPreview(
  db: D1Database,
  tokenHash: string,
): Promise<InvitationPreview> {
  const invite = await one<{
    email: string;
    expiresAt: string;
    redeemedAt: string | null;
    kind: InvitationKind;
  }>(
    db,
    "SELECT email,expires_at AS expiresAt,redeemed_at AS redeemedAt,kind FROM invitations WHERE token_hash=?",
    [tokenHash],
  );
  if (!invite) return { status: "not_found", email: null, expiresAt: null, kind: null };
  const kind = invite.kind === "register" ? "register" : "link";
  if (invite.redeemedAt) return { status: "used", email: invite.email, expiresAt: invite.expiresAt, kind };
  if (invite.expiresAt <= iso()) return { status: "expired", email: invite.email, expiresAt: invite.expiresAt, kind };
  return { status: "ready", email: invite.email, expiresAt: invite.expiresAt, kind };
}

export async function redeemInvitation(
  db: D1Database,
  actor: Actor,
  tokenHash: string,
): Promise<{ kind: InvitationKind }> {
  await requireActor(db, actor);
  const now = iso(),
    invite = await one<{
      id: string;
      email: string;
      athleteIds: string;
      invitedBy: string;
      kind: InvitationKind;
    }>(
      db,
      "SELECT id,email,athlete_ids_json AS athleteIds,invited_by AS invitedBy,kind FROM invitations WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>?",
      [tokenHash, now],
    );
  if (!invite || invite.email.toLowerCase() !== actor.email.toLowerCase())
    fail("Invitación inválida o vencida.", 403, "invitation_invalid");
  const athleteIds = JSON.parse(invite.athleteIds) as string[],
    token = id();
  const statements = [
    bindings(
      db,
      `UPDATE invitations SET redeemed_by=?,redeemed_at=?,redemption_token=?
        WHERE id=? AND redeemed_at IS NULL AND expires_at>? AND email=? COLLATE NOCASE
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND email=invitations.email COLLATE NOCASE)`,
      [actor.id, now, token, invite.id, now, actor.email, actor.id],
    ),
  ];
  for (const athleteId of athleteIds)
    statements.push(
      bindings(
        db,
        "INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) SELECT ?,?,1,0,?,?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE id=? AND redeemed_by=? AND redemption_token=?) ON CONFLICT(user_id,athlete_id) DO UPDATE SET active=1,receipt_opt_in=0,linked_by=excluded.linked_by,updated_at=excluded.updated_at",
        [
          actor.id,
          athleteId,
          invite.invitedBy,
          now,
          now,
          invite.id,
          actor.id,
          token,
        ],
      ),
    );
  statements.push(bindings(
    db,
    `INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at)
      SELECT ?,?,'invitation',id,'redeem',?,? FROM invitations
      WHERE id=? AND redeemed_by=? AND redemption_token=?`,
    [id(), actor.id, JSON.stringify({ athleteIds }), now, invite.id, actor.id, token],
  ));
  const result = await batch(db, statements);
  if (!result[0].meta.changes)
    fail("Invitación ya utilizada.", 409, "invitation_invalid");
  return { kind: invite.kind === "register" ? "register" : "link" };
}

// Self-service stays open in two cases: a claimed (redeemed) 'register'
// invitation that has not expired yet (seven days), or an already-linked
// family adding another athlete at any time. New families need an invitation.
export async function getRegistrationWindow(
  db: D1Database,
  actor: Actor,
): Promise<{ invitationId: string | null; expiresAt: string | null; via: "invitation" | "family" } | null> {
  const invite = await one<{ id: string; expiresAt: string }>(
    db,
    "SELECT id,expires_at AS expiresAt FROM invitations WHERE redeemed_by=? AND kind='register' AND expires_at>? ORDER BY redeemed_at DESC LIMIT 1",
    [actor.id, iso()],
  );
  if (invite) return { invitationId: invite.id, expiresAt: invite.expiresAt, via: "invitation" };
  const linked = await one(
    db,
    "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND active=1 LIMIT 1",
    [actor.id],
  );
  return linked ? { invitationId: null, expiresAt: null, via: "family" } : null;
}

/**
 * A new account still has to enroll its first athlete. The registration
 * invitation stays "open" after that enrollment, so the active guardian
 * link is what ends the step. Accounts with no window are left alone:
 * they cannot submit the form, and trapping them there would be a dead end.
 */
export async function needsAthleteRegistration(db: D1Database, actor: Actor): Promise<boolean> {
  const window = await getRegistrationWindow(db, actor);
  if (window?.via !== "invitation") return false;
  const linked = await one(
    db,
    "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND active=1 LIMIT 1",
    [actor.id],
  );
  return !linked;
}

/** Completed years on a Costa Rica calendar date (both YYYY-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
}

export function costaRicaToday(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export interface SelfAthleteInput {
  name: string;
  birthDate: string;
  nationalId?: string;
  school: string;
  category: string;
}

// The Google-Form group names map onto the portal categories and their fees.
const selfCategories: Record<string, { category: string; feeMinor: number }> = {
  "Iniciación": { category: "Iniciación", feeMinor: 1200000 },
  "Principiantes": { category: "Iniciación", feeMinor: 1200000 },
  "Cadetes": { category: "Cadetes", feeMinor: 1500000 },
  "Intermedios": { category: "Intermedios", feeMinor: 1500000 },
  "Avanzados": { category: "Avanzados", feeMinor: 1500000 },
};

function selfAthlete(input: SelfAthleteInput, today: string, schedule?: Record<string, number>) {
  const name = text(input.name);
  const birthDate = date(input.birthDate);
  if (birthDate > today) fail("La fecha de nacimiento no puede ser futura.");
  const age = ageOn(birthDate, today);
  if (age > 100) fail("Revisa la fecha de nacimiento.");
  // Age is derived, never asked. The cédula replaces the old "fill with ones"
  // rule: required from age 12, optional before, never a placeholder.
  const digits = (input.nationalId ?? "").replace(/[\s-]/g, "");
  let nationalId: string | null = null;
  if (digits) {
    if (!/^\d{9,12}$/.test(digits) || /^(\d)\1+$/.test(digits))
      fail("Revisa el número de cédula.");
    nationalId = digits;
  }
  if (age >= 12 && !nationalId)
    fail("Indica el número de cédula del atleta (tiene 12 años o más).");
  const school = text(input.school);
  const mapped = selfCategories[input.category?.trim()];
  if (!mapped) fail("Elige el grupo del atleta.");
  return { name, birthDate, nationalId, school, category: mapped.category, feeMinor: schedule?.[mapped.category] ?? mapped.feeMinor };
}

/**
 * Self-service enrollment inside a claimed registration window. Every athlete
 * is created active and linked to the guardian. The first billed month is
 * billingStartPeriod: the current month on or before the 8th, otherwise the
 * following month, charged by the normal (automatic) publication.
 */
export async function registerAthletes(
  db: D1Database,
  actor: Actor,
  inputs: SelfAthleteInput[],
): Promise<string[]> {
  await requireActor(db, actor);
  if (!inputs.length || inputs.length > 6)
    fail("Inscriba al menos un atleta (máximo seis por vez).");
  const window = await getRegistrationWindow(db, actor);
  if (!window) fail("Necesitas una invitación de inscripción vigente.", 403, "invitation_invalid");
  const now = iso(), today = costaRicaToday(now), period = billingStartPeriod(now);
  const schedule = await getFeeSchedule(db);
  const athletes = inputs.map((input) => selfAthlete(input, today, schedule));
  const total = await one<{ n: number }>(db, "SELECT count(*) n FROM athletes");
  if ((total?.n || 0) + athletes.length > 300)
    fail("Se alcanzó el límite de atletas.", 409, "limit");
  for (const athlete of athletes) {
    const dupe = await one(
      db,
      `SELECT a.id FROM athletes a JOIN guardian_links l ON l.athlete_id=a.id
       WHERE l.user_id=? AND lower(trim(a.name))=lower(trim(?)) AND a.birth_date=? LIMIT 1`,
      [actor.id, athlete.name, athlete.birthDate],
    );
    if (dupe) fail(`"${athlete.name}" ya está inscrito en tu cuenta.`, 409, "conflict");
  }
  const ids = athletes.map(() => id());
  const statements: D1PreparedStatement[] = [];
  athletes.forEach((athlete, index) => {
    statements.push(bindings(
      db,
      "INSERT INTO athletes(id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at,birth_date,national_id,school) VALUES(?,?,?,?,0,NULL,1,?,?,?,?,?,?)",
      [ids[index], athlete.name, athlete.category, athlete.feeMinor, period, now, now, athlete.birthDate, athlete.nationalId, athlete.school],
    ));
    statements.push(bindings(
      db,
      "INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,?,1,0,?,?,?)",
      [actor.id, ids[index], actor.id, now, now],
    ));
    statements.push(audit(db, actor, "athlete", ids[index], "self_register", { invitationId: window.invitationId, category: athlete.category }, now));
  });
  await batch(db, statements);
  return ids;
}

/**
 * Enrollment and the optional other-parent invite. The address is checked
 * before any athlete row is written, so a bad email can be corrected and resent.
 */
export async function registerAthletesWithOptionalGuardian(
  db: D1Database,
  actor: Actor,
  athletes: SelfAthleteInput[],
  coGuardian?: { email: string; tokenHash: string },
): Promise<string[]> {
  if (coGuardian) {
    const email = coGuardian.email.trim().toLowerCase();
    if (coGuardianEmailProblem(email, actor.email)) {
      fail(email === actor.email.trim().toLowerCase() ? "Usa el correo de la otra persona encargada." : "Invitación inválida.");
    }
  }
  const athleteIds = await registerAthletes(db, actor, athletes);
  if (coGuardian) {
    await createGuardianInvitation(db, actor, {
      email: coGuardian.email,
      athleteIds,
      tokenHash: coGuardian.tokenHash,
    });
  }
  return athleteIds;
}

export interface AthleteProfile { birthDate: string | null; nationalId: string | null; school: string | null; paused: boolean }

export async function listAthleteProfiles(db: D1Database): Promise<Map<string, AthleteProfile>> {
  const profiles = await rows<{ id: string; birthDate: string | null; nationalId: string | null; school: string | null; paused: number }>(
    db,
    "SELECT id,birth_date AS birthDate,national_id AS nationalId,school,paused FROM athletes",
  );
  return new Map(profiles.map(({ id: athleteId, paused, ...profile }) => [athleteId, { ...profile, paused: !!paused }]));
}

/** Profiles for athletes this guardian can still manage. Cédula stays off this page. */
export async function listOwnAthleteProfiles(db: D1Database, actor: Actor): Promise<Map<string, AthleteProfile>> {
  const profiles = await rows<{ id: string; birthDate: string | null; school: string | null; paused: number }>(
    db,
    `SELECT a.id,a.birth_date AS birthDate,a.school,a.paused
     FROM athletes a JOIN guardian_links l ON l.athlete_id=a.id
     WHERE l.user_id=? AND l.active=1`,
    [actor.id],
  );
  return new Map(profiles.map(({ id: athleteId, paused, birthDate, school }) => [
    athleteId,
    { birthDate, school, nationalId: null, paused: !!paused },
  ]));
}

/**
 * Admin membership pause: the athlete stays enrolled (access and history are
 * preserved) but monthly publication skips them until resumed. Charges that
 * already exist are untouched; use a charge adjustment for those.
 */
export async function setAthletePaused(
  db: D1Database,
  actor: Actor,
  athleteId: string,
  paused: boolean,
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  const athlete = await one<{ id: string; paused: number }>(db, "SELECT id,paused FROM athletes WHERE id=?", [athleteId]);
  if (!athlete) fail("Atleta no disponible.", 404, "not_found");
  if (!!athlete.paused === paused) return;
  const now = iso();
  await batch(db, [
    bindings(db, "UPDATE athletes SET paused=?,updated_at=? WHERE id=?", [paused ? 1 : 0, now, athleteId]),
    audit(db, actor, "athlete", athleteId, paused ? "pause" : "resume", {}, now),
  ]);
}

/**
 * A guardian activates/deactivates their own linked athlete at any time.
 * Deactivation never deletes history: past charges stay payable and monthly
 * publication simply stops creating new ones.
 */
export async function setOwnAthleteActive(
  db: D1Database,
  actor: Actor,
  athleteId: string,
  active: boolean,
): Promise<void> {
  await requireActor(db, actor);
  const link = await one(
    db,
    "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND athlete_id=? AND active=1 LIMIT 1",
    [actor.id, athleteId],
  );
  if (!link) fail("Atleta no disponible.", 404, "not_found");
  const athlete = await one<{ id: string; active: number }>(db, "SELECT id,active FROM athletes WHERE id=?", [athleteId]);
  if (!athlete) fail("Atleta no disponible.", 404, "not_found");
  if (!!athlete.active === active) return;
  const now = iso();
  await batch(db, [
    bindings(db, "UPDATE athletes SET active=?,updated_at=? WHERE id=?", [active ? 1 : 0, now, athleteId]),
    audit(db, actor, "athlete", athleteId, active ? "self_reactivate" : "self_deactivate", {}, now),
  ]);
}

export async function publishMonth(
  db: D1Database,
  actor: Actor,
  period: string,
  expectedSnapshot: string,
): Promise<number> {
  admin(actor);
  await requireActor(db, actor);
  validatePeriod(period);
  if (typeof expectedSnapshot !== "string" || !/^[a-f0-9]{64}$/.test(expectedSnapshot))
    fail("Revisa la vista previa antes de publicar.", 400, "invalid_fields");
  const preview = await getMonthlyPreview(db, period);
  if (preview.snapshot !== expectedSnapshot)
    fail("Las cuotas o las inscripciones cambiaron. Actualiza la vista previa.", 409, "conflict");
  const reviewed = monthlySnapshot(period, preview.athletes);
  const now = iso();
  const pending = preview.athletes.filter((a) => !a.alreadyPublished);
  const result = await batch(db, [
    // The guarded audit is also the transaction's successful snapshot claim.
    // A stale roster writes neither an audit nor charges; any later insert error rolls both back.
    bindings(db,
      `INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,'month',?,'publish',?,? WHERE ${monthlySnapshotSql}=?`,
      [id(), actor.id, period, JSON.stringify({ snapshot: expectedSnapshot }), now, period, period, reviewed]),
    ...pending.map((a) => bindings(
      db,
      `INSERT OR IGNORE INTO charges(id,athlete_id,period,due_date,base_minor,discount_minor,discount_reason,published_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${monthlySnapshotSql}=?`,
      [id(), a.id, period, `${period}-08`, a.feeMinor,
        Math.min(a.feeMinor, a.siblingMinor),
        a.siblingMinor > 0 ? SIBLING_DISCOUNT_REASON : null,
        actor.id, now, period, period, reviewed],
    )),
  ]);
  if (!result[0].meta.changes)
    fail("Las cuotas o las inscripciones cambiaron. Actualiza la vista previa.", 409, "conflict");
  // Credit paid ahead lands on the new charges now; a failure here never undoes the publish (the daily run retries).
  try { await settleCredit(db, now); }
  catch (error) { console.error(JSON.stringify({ event: "settle_credit_failed", message: error instanceof Error ? error.message : "unknown" })); }
  return result.slice(1).reduce((sum, r) => sum + (r.meta.changes || 0), 0);
}

// Dedicated non-login identity for the automatic monthly publication. It only
// exists so charges/audit rows name a stable system actor instead of a person.
export const SYSTEM_MONTHLY_ACTOR: Actor = {
  id: "system:monthly-publish",
  email: "sistema@mensualidades.invalid",
  name: "Sistema — publicación automática",
  isAdmin: true,
  mode: "workos",
};

async function ensureSystemActor(db: D1Database): Promise<void> {
  const now = iso();
  await bindings(
    db,
    "INSERT OR IGNORE INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    [SYSTEM_MONTHLY_ACTOR.id, SYSTEM_MONTHLY_ACTOR.email, SYSTEM_MONTHLY_ACTOR.name, now, now],
  ).run();
}

// Workers Free allows 50 D1 queries per invocation. A settling payment costs two (open charges, then the
// batch), so one run takes a bounded number; the daily run (or the next publish) continues with the rest.
const SETTLE_PAYMENTS_PER_RUN = 12;

/**
 * Apply verified payments' unapplied credit to their family's open charges up to the current Costa Rica
 * month, oldest month first. Only payments that can settle something are visited, at most `maxPayments`
 * per call. Safe to repeat and to race: the allocation triggers reject any insert that would exceed a payment
 * or a charge, and the loser re-plans once. Months a pending payment already asked for are left to it.
 * Returns the number of allocations created.
 */
export async function settleCredit(db: D1Database, instant: string, maxPayments = SETTLE_PAYMENTS_PER_RUN): Promise<number> {
  await ensureSystemActor(db);
  const period = billingPeriod(instant);
  const payments = await rows<{ id: string; adultId: string; creditMinor: number }>(
    db,
    `SELECT t.id,t.adultId,t.creditMinor FROM (
       SELECT p.id,p.designated_user_id AS adultId,p.verified_at AS verifiedAt,
         p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) AS creditMinor
       FROM payments p JOIN users u ON u.id=p.designated_user_id AND u.active=1 WHERE p.status='verified') t
     WHERE t.creditMinor>0 AND EXISTS(
       SELECT 1 FROM guardian_links l JOIN charges c ON c.athlete_id=l.athlete_id
       WHERE l.user_id=t.adultId AND l.active=1 AND c.period<=?
         AND c.base_minor-c.discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=c.id),0)
           >COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments pv ON pv.id=a.payment_id WHERE a.charge_id=c.id AND pv.status='verified'),0))
     ORDER BY t.verifiedAt,t.id LIMIT ?`,
    [period, maxPayments],
  );
  let created = 0;
  for (const payment of payments) {
    let remaining = payment.creditMinor;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        const fresh = await one<{ creditMinor: number }>(
          db,
          "SELECT p.verified_amount_minor-COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=p.id),0) AS creditMinor FROM payments p WHERE p.id=? AND p.status='verified'",
          [payment.id],
        );
        remaining = fresh?.creditMinor ?? 0;
      }
      const open = await rows<{ id: string; balanceMinor: number }>(
        db,
        `SELECT q.id,q.totalMinor-q.paidMinor-COALESCE((SELECT sum(r.amount_minor) FROM payment_requested_allocations r JOIN payments pr ON pr.id=r.payment_id WHERE r.charge_id=q.id AND pr.status IN ('pending','needs_info')),0) AS balanceMinor
         FROM (${chargeSql} WHERE c.period<=? AND EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1)) q
         ORDER BY q.period,q.athleteName,q.id`,
        [period, payment.adultId],
      );
      const plan: RequestedAllocation[] = [];
      for (const charge of open) {
        if (remaining <= 0) break;
        if (charge.balanceMinor <= 0) continue;
        const amountMinor = Math.min(remaining, charge.balanceMinor);
        plan.push({ chargeId: charge.id, amountMinor });
        remaining -= amountMinor;
      }
      if (!plan.length) break;
      const now = iso();
      try {
        await batch(db, [
          ...plan.map((line) => bindings(
            db,
            "INSERT INTO payment_allocations(id,payment_id,charge_id,amount_minor,created_at) VALUES(?,?,?,?,?)",
            [id(), payment.id, line.chargeId, line.amountMinor, now],
          )),
          audit(db, SYSTEM_MONTHLY_ACTOR, "payment", payment.id, "auto_apply_credit", { allocations: plan }, now),
        ]);
        created += plan.length;
        break;
      } catch (error) {
        if (attempt === 0 && error instanceof PortalError && error.status === 409) continue;
        throw error;
      }
    }
  }
  return created;
}

/**
 * Publish the Costa Rica current month if it is not published yet. Safe to run
 * repeatedly (the cron runs daily): already-published athletes are skipped and
 * a snapshot conflict retries once with a fresh preview.
 */
export async function publishCurrentMonth(
  db: D1Database,
  instant: string,
): Promise<{ period: string; created: number }> {
  const period = billingPeriod(instant);
  await ensureSystemActor(db);
  for (let attempt = 0; attempt < 2; attempt++) {
    const preview = await getMonthlyPreview(db, period);
    if (preview.newCount === 0) return { period, created: 0 };
    try {
      return { period, created: await publishMonth(db, SYSTEM_MONTHLY_ACTOR, period, preview.snapshot) };
    } catch (error) {
      if (attempt === 0 && error instanceof PortalError && error.status === 409) continue;
      throw error;
    }
  }
  return { period, created: 0 };
}
type FinancialOperation = {
  actorId: string;
  action: "adjust_charge" | "apply_credit";
  targetId: string;
  operationId: string;
  payload: string;
  claimToken: string;
};
function financialOperation(actor: Actor, action: FinancialOperation["action"], targetId: string, operationId: string, payload: unknown): FinancialOperation {
  if (typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    fail("Identificador de operación inválido.", 400, "invalid_fields");
  }
  return { actorId: actor.id, action, targetId: text(targetId, 80), operationId: operationId.toLowerCase(), payload: JSON.stringify(payload), claimToken: id() };
}
async function completedFinancialOperation(db: D1Database, operation: FinancialOperation): Promise<boolean> {
  const completed = await one<{ payload: string }>(db,
    "SELECT payload_json AS payload FROM financial_operations WHERE actor_id=? AND action=? AND target_id=? AND operation_id=?",
    [operation.actorId, operation.action, operation.targetId, operation.operationId]);
  if (!completed) return false;
  if (completed.payload !== operation.payload) {
    fail("Esta operación ya se usó con datos diferentes. Actualiza la página antes de registrar otro cambio.", 409, "conflict");
  }
  return true;
}
function claimFinancialOperation(db: D1Database, operation: FinancialOperation, now: string) {
  return bindings(db,
    "INSERT INTO financial_operations(actor_id,action,target_id,operation_id,payload_json,claim_token,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(actor_id,action,target_id,operation_id) DO NOTHING",
    [operation.actorId, operation.action, operation.targetId, operation.operationId, operation.payload, operation.claimToken, now]);
}
function financialOperationAudit(db: D1Database, actor: Actor, operation: FinancialOperation, entity: string, action: string, detail: unknown, now: string) {
  return bindings(db,
    "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM financial_operations WHERE claim_token=?)",
    [id(), actor.id, entity, operation.targetId, action, JSON.stringify(detail), now, operation.claimToken]);
}

export async function adjustCharge(
  db: D1Database,
  actor: Actor,
  input: ChargeAdjustmentInput,
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  if (!Number.isSafeInteger(input.amountMinor) || !input.amountMinor || Math.abs(input.amountMinor) > 100000000)
    fail("Ajuste inválido.");
  const reason = text(input.reason, 500);
  const operation = financialOperation(actor, "adjust_charge", input.chargeId, input.operationId,
    { amountMinor: input.amountMinor, reason });
  if (await completedFinancialOperation(db, operation)) return;
  const now = iso();
  const result = await batch(db, [
    claimFinancialOperation(db, operation, now),
    bindings(db,
      "INSERT INTO charge_adjustments(id,charge_id,amount_minor,reason,recorded_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM financial_operations WHERE claim_token=?)",
      [id(), input.chargeId, input.amountMinor, reason, actor.id, now, operation.claimToken]),
    financialOperationAudit(db, actor, operation, "charge", "adjust", { ...input, reason }, now),
  ]);
  if (!result[0].meta.changes) await completedFinancialOperation(db, operation);
}

async function validateAllocations(
  db: D1Database,
  userId: string,
  allocations: RequestedAllocation[],
  paid: number,
  checkBalance: boolean,
  allowEmpty = false,
): Promise<
  Array<{
    chargeId: string;
    amountMinor: number;
    athleteId: string;
    athleteName: string;
    period: string;
  }>
> {
  if (
    !Array.isArray(allocations) ||
    (!allocations.length && !allowEmpty) ||
    allocations.length > 36 ||
    new Set(allocations.map((a) => a.chargeId)).size !== allocations.length
  )
    fail("Seleccione las mensualidades.", 400);
  if (!allocations.length) await requireLinkedAthlete(db, userId);
  if (allocations.reduce((sum, a) => sum + amount(a.amountMinor), 0) > paid)
    fail("La distribución supera el monto del pago.");
  const found = [];
  for (const allocation of allocations) {
    const charge = await one<Charge>(
      db,
      `${chargeSql} WHERE c.id=? AND EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1)`,
      [allocation.chargeId, userId],
    );
    if (!charge)
      fail("Mensualidad no disponible para esta familia.", 403, "forbidden");
    if (
      checkBalance &&
      allocation.amountMinor > charge.totalMinor - charge.paidMinor
    )
      fail(
        "La distribución supera el saldo de la mensualidad.",
        409,
        "conflict",
      );
    found.push({
      chargeId: charge.id,
      amountMinor: allocation.amountMinor,
      athleteId: charge.athleteId,
      athleteName: charge.athleteName,
      period: charge.period,
    });
  }
  return found;
}
/** With no month to check, the only proof a family may pay is that the account has an athlete linked. */
async function requireLinkedAthlete(db: D1Database, userId: string): Promise<void> {
  const linked = await one<{ ok: number }>(db, "SELECT 1 AS ok FROM guardian_links WHERE user_id=? AND active=1 LIMIT 1", [userId]);
  if (!linked) fail("Esta cuenta no tiene atletas vinculados.", 403, "forbidden");
}
/** A payment registered as an advance named no month. Derived from storage, so revising or verifying needs no client flag. */
async function isAdvanceRequest(db: D1Database, paymentId: string): Promise<boolean> {
  const requested = await one<{ n: number }>(db, "SELECT count(*) AS n FROM payment_requested_allocations WHERE payment_id=?", [paymentId]);
  return (requested?.n ?? 0) === 0;
}
function validateSlip(file: SubmitPaymentInput["file"]) {
  text(file.key, 200);
  if (
    !["image/jpeg", "image/png", "application/pdf"].includes(file.type) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 3145728 ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    fail("Archivo inválido.");
}
type SubmissionRequest = Omit<SubmitPaymentInput, "file"> & {
  file: Omit<SubmitPaymentInput["file"], "key">;
};

function canonicalSubmission(actor: Actor, input: SubmissionRequest) {
  if (typeof input.submissionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.submissionId))
    fail("El formulario venció. Vuelve a abrir el registro de pago.", 400, "invalid_fields");
  const designatedAdultId = input.designatedAdultId || actor.id;
  if (!actor.isAdmin && designatedAdultId !== actor.id)
    fail("Acceso denegado.", 403, "forbidden");
  if (actor.isAdmin && !input.designatedAdultId) fail("Seleccione al adulto responsable.");
  // Dual role: an administrator paying for their own family is self-service,
  // exactly like any other guardian — no staff-assistance reason is required.
  // The reason stays mandatory only when registering for someone else.
  const staffAssisted = actor.isAdmin && designatedAdultId !== actor.id;
  const auditReason = staffAssisted ? text(input.auditReason, 500)
    : input.auditReason ? text(input.auditReason, 500) : null;
  validateSlip({ ...input.file, key: "submission-original" });
  const amountMinor = amount(input.amountMinor);
  // Only an explicit advance (the form's "Adelantar meses") may name no month; every other entry point still needs one.
  if (!Array.isArray(input.allocations) || (!input.allocations.length && input.advance !== true) || input.allocations.length > 36)
    fail("Seleccione las mensualidades.", 400);
  const allocations = input.allocations.map(allocation => ({
    chargeId: text(allocation.chargeId, 80), amountMinor: amount(allocation.amountMinor),
  })).sort((a, b) => a.chargeId.localeCompare(b.chargeId));
  if (new Set(allocations.map(allocation => allocation.chargeId)).size !== allocations.length ||
      allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0) > amountMinor)
    fail("Distribución inválida.", 400);
  return {
    payerName: text(input.payerName), amountMinor, transferDate: date(input.transferDate),
    bankReference: optionalText(input.bankReference, 128), allocations,
    designatedAdultId, shareEvidence: staffAssisted ? Boolean(input.shareEvidence) : true,
    auditReason, note: input.note ? text(input.note, 500) : null,
    file: { type: input.file.type, size: input.file.size, sha256: input.file.sha256 },
  };
}

function submissionConflict(): never {
  fail("Este formulario ya se utilizó. Revisa tus pagos o abre un formulario nuevo.", 409, "conflict");
}

/** Recover the original operation, never the payment's later editable state. No writes or R2 calls. */
export async function recoverPaymentSubmission(
  db: D1Database, actor: Actor, input: SubmissionRequest,
): Promise<string | null> {
  await requireActor(db, actor);
  const expected = canonicalSubmission(actor, input);
  const payment = await one<{ submittedBy: string }>(db,
    "SELECT submitted_by AS submittedBy FROM payments WHERE id=?", [input.submissionId]);
  if (!payment) return null;
  // Do not reveal any details, even to another administrator, on a guessed/colliding operation ID.
  if (payment.submittedBy !== actor.id) submissionConflict();
  const original = await one<{
    payerName: string; amountMinor: number; transferDate: string; bankReference: string;
    allocationsJson: string; note: string | null; recordedBy: string;
    type: string; size: number; sha256: string;
  }>(db, `SELECT r.payer_name AS payerName,r.amount_minor AS amountMinor,r.transfer_date AS transferDate,
    r.bank_reference AS bankReference,r.requested_allocations_json AS allocationsJson,r.note,r.recorded_by AS recordedBy,
    f.file_type AS type,f.file_size AS size,f.file_sha256 AS sha256
    FROM payment_revisions r JOIN payment_files f ON f.payment_id=r.payment_id AND f.revision=r.revision
    WHERE r.payment_id=? AND r.revision=1`, [input.submissionId]);
  const events = await rows<{ detail: string; actorId: string }>(db,
    "SELECT detail_json AS detail,actor_id AS actorId FROM audit_events WHERE entity_type='payment' AND entity_id=? AND action='submit' LIMIT 2",
    [input.submissionId]);
  if (!original || original.recordedBy !== actor.id || events.length !== 1 || events[0].actorId !== actor.id)
    submissionConflict();
  let matches = false;
  try {
    const detail = JSON.parse(events[0].detail);
    // Legacy rows have no original sharing-policy snapshot and cannot be claimed as new operations.
    if (detail.submission?.version !== 1 || typeof detail.submission.shareEvidence !== "boolean") submissionConflict();
    const allocations = JSON.parse(original.allocationsJson) as RequestedAllocation[];
    const actual = {
      payerName: original.payerName, amountMinor: original.amountMinor, transferDate: original.transferDate,
      bankReference: original.bankReference, allocations: allocations.sort((a, b) => a.chargeId.localeCompare(b.chargeId)),
      designatedAdultId: detail.designatedAdultId, shareEvidence: detail.submission.shareEvidence,
      auditReason: detail.auditReason, note: original.note,
      file: { type: original.type, size: original.size, sha256: original.sha256 },
    };
    matches = JSON.stringify(actual) === JSON.stringify(expected);
  } catch { submissionConflict(); }
  if (!matches) submissionConflict();
  // A replay does not bypass a revoked account or family link.
  await activeUser(db, expected.designatedAdultId);
  await authorizedPayment(db, actor, input.submissionId);
  await validateAllocations(db, expected.designatedAdultId, expected.allocations, expected.amountMinor, false, expected.allocations.length === 0);
  return input.submissionId;
}
/**
 * Permission gate for a new submission, run before any slip draft is reserved. Mirrors the
 * ownership part of validateAllocations so a request for another family fails with 403 and
 * leaves no draft behind (drafts count toward a per-account cap).
 */
export async function assertSubmissionAccess(
  db: D1Database,
  actor: Actor,
  input: SubmissionRequest,
): Promise<void> {
  await requireActor(db, actor);
  const designated = canonicalSubmission(actor, input).designatedAdultId;
  await activeUser(db, designated);
  const allocations = Array.isArray(input.allocations) ? input.allocations : [];
  if (!allocations.length) await requireLinkedAthlete(db, designated);
  for (const allocation of allocations) {
    const linked = await one<{ id: string }>(
      db,
      "SELECT c.id FROM charges c WHERE c.id=? AND EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=? AND l.athlete_id=c.athlete_id AND l.active=1)",
      [allocation.chargeId, designated],
    );
    if (!linked) fail("Mensualidad no disponible para esta familia.", 403, "forbidden");
  }
}

export async function submitPayment(
  db: D1Database,
  actor: Actor,
  input: SubmitPaymentInput,
): Promise<string> {
  await requireActor(db, actor);
  validateSlip(input.file);
  const canonical = canonicalSubmission(actor, input);
  const recovered = await recoverPaymentSubmission(db, actor, input);
  if (recovered) return recovered;
  const designated = canonical.designatedAdultId;
  await activeUser(db, designated);
  await validateAllocations(
    db,
    designated,
    input.allocations,
    input.amountMinor,
    false,
    canonical.allocations.length === 0,
  );
  const paymentId = input.submissionId,
    now = iso();
  const statements = [
    bindings(
      db,
      "INSERT INTO payments(id,designated_user_id,submitted_by,share_evidence,payer_name,amount_minor,transfer_date,bank_reference,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        paymentId,
        designated,
        actor.id,
        canonical.shareEvidence ? 1 : 0,
        canonical.payerName,
        input.amountMinor,
        input.transferDate,
        canonical.bankReference,
        now,
        now,
      ],
    ),
    bindings(
      db,
      "INSERT INTO payment_revisions(id,payment_id,revision,payer_name,amount_minor,transfer_date,bank_reference,requested_allocations_json,note,recorded_by,created_at) VALUES(?,?,1,?,?,?,?,?,?,?,?)",
      [
        id(),
        paymentId,
        canonical.payerName,
        input.amountMinor,
        input.transferDate,
        canonical.bankReference,
        JSON.stringify(canonical.allocations),
        canonical.note,
        actor.id,
        now,
      ],
    ),
    bindings(
      db,
      "INSERT INTO payment_files(id,payment_id,revision,file_key,file_type,file_size,file_sha256,created_at) VALUES(?,?,1,?,?,?,?,?)",
      [
        id(),
        paymentId,
        input.file.key,
        input.file.type,
        input.file.size,
        input.file.sha256,
        now,
      ],
    ),
  ];
  for (const a of input.allocations)
    statements.push(
      bindings(
        db,
        "INSERT INTO payment_requested_allocations(payment_id,charge_id,amount_minor) VALUES(?,?,?)",
        [paymentId, a.chargeId, a.amountMinor],
      ),
    );
  statements.push(
    audit(
      db,
      actor,
      "payment",
      paymentId,
      "submit",
      { designatedAdultId: designated, auditReason: canonical.auditReason,
        submission: { version: 1, shareEvidence: canonical.shareEvidence } },
      now,
    ),
  );
  try { await batch(db, statements); }
  catch (error) {
    // D1 rolls the whole batch back on a competing primary-key insert. Recover only an exact owned replay.
    const raced = await recoverPaymentSubmission(db, actor, input);
    if (raced) return raced;
    throw error;
  }
  return paymentId;
}

export async function revisePayment(
  db: D1Database,
  actor: Actor,
  paymentId: string,
  input: Omit<SubmitPaymentInput, "file" | "submissionId"> & PaymentReviewSnapshot & {
    file?: SubmitPaymentInput["file"];
  },
): Promise<void> {
  const payment = await authorizedPayment(db, actor, paymentId);
  if (payment.submitterId !== actor.id && !actor.isAdmin)
    fail("Solo quien registró el pago puede corregirlo.", 403, "forbidden");
  requirePaymentSnapshot(payment, input);
  if (payment.status !== "needs_info")
    fail("El pago no admite correcciones.", 409, "conflict");
  text(input.note, 500);
  text(input.payerName);
  amount(input.amountMinor);
  date(input.transferDate);
  const bankReference = optionalText(input.bankReference, 128);
  if (input.file) validateSlip(input.file);
  await validateAllocations(
    db,
    payment.designatedAdultId,
    input.allocations,
    input.amountMinor,
    false,
    await isAdvanceRequest(db, paymentId),
  );
  const revision = input.expectedRevision + 1,
    now = iso();
  const token = id();
  const statements = [
    bindings(
      db,
      "UPDATE payments SET status='pending',review_note=NULL,payer_name=?,amount_minor=?,transfer_date=?,bank_reference=?,revision=?,updated_at=?,approval_token=? WHERE id=? AND status='needs_info' AND revision=? AND review_note IS ?",
      [
        input.payerName.trim(),
        input.amountMinor,
        input.transferDate,
        bankReference,
        revision,
        now,
        token,
        paymentId,
        revision - 1,
        input.expectedReviewNote,
      ],
    ),
    bindings(
      db,
      "INSERT INTO payment_revisions(id,payment_id,revision,payer_name,amount_minor,transfer_date,bank_reference,requested_allocations_json,note,recorded_by,created_at) SELECT ?,id,revision,payer_name,amount_minor,transfer_date,bank_reference,?,?,?,? FROM payments WHERE id=? AND approval_token=?",
      [
        id(),
        JSON.stringify(input.allocations),
        input.note,
        actor.id,
        now,
        paymentId,
        token,
      ],
    ),
    bindings(
      db,
      "DELETE FROM payment_requested_allocations WHERE payment_id=? AND EXISTS(SELECT 1 FROM payments WHERE id=? AND approval_token=?)",
      [paymentId, paymentId, token],
    ),
  ];
  for (const a of input.allocations)
    statements.push(
      bindings(
        db,
        "INSERT INTO payment_requested_allocations(payment_id,charge_id,amount_minor) SELECT id,?,? FROM payments WHERE id=? AND approval_token=?",
        [a.chargeId, a.amountMinor, paymentId, token],
      ),
    );
  if (input.file)
    statements.push(
      bindings(
        db,
        "INSERT INTO payment_files(id,payment_id,revision,file_key,file_type,file_size,file_sha256,created_at) SELECT ?,id,revision,?,?,?,?,? FROM payments WHERE id=? AND approval_token=?",
        [
          id(),
          input.file.key,
          input.file.type,
          input.file.size,
          input.file.sha256,
          now,
          paymentId,
          token,
        ],
      ),
    );
  statements.push(
    paymentAudit(db, actor, paymentId, "revise", { revision }, now, token),
  );
  const result = await batch(db, statements);
  if (!result[0].meta.changes)
    fail("El pago cambió. Actualice la página.", 409, "conflict");
}

function bankMatch(bank: string, account: string, reference: string) {
  return JSON.stringify([
    bank.normalize("NFKC").trim().toUpperCase(),
    account.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase(),
    reference.normalize("NFKC").replace(/\s/g, "").toUpperCase(),
  ]);
}
function requirePaymentSnapshot(payment: Payment, expected: PaymentReviewSnapshot) {
  if (!Number.isSafeInteger(expected.expectedRevision) || expected.expectedRevision < 1 ||
      expected.expectedRevision !== payment.revision || expected.expectedStatus !== payment.status ||
      expected.expectedReviewNote !== payment.reviewNote) {
    fail("El pago cambió desde que abriste la página. Actualiza y vuelve a revisar el respaldo.", 409, "conflict");
  }
}
export async function reviewPayment(
  db: D1Database,
  actor: Actor,
  paymentId: string,
  input: ReviewPaymentInput,
): Promise<string | null> {
  admin(actor);
  const payment = await authorizedPayment(db, actor, paymentId),
    now = iso();
  requirePaymentSnapshot(payment, input);
  if (input.action === "void") {
    if (payment.status !== "verified")
      fail("Solo un pago verificado puede anularse.", 409, "conflict");
    const reason = text(input.reason, 500),
      token = id();
    // A void notice reuses the original immutable destination; it never adopts a new address.
    const originalRecipient = await one<{ recipientEmail: string }>(db,
      "SELECT recipient_email AS recipientEmail FROM email_outbox WHERE receipt_id=? AND recipient_id=? AND kind='receipt'",
      [payment.receiptId, payment.designatedAdultId]);
    const results = await batch(db, [
      bindings(
        db,
        "UPDATE payments SET status='void',review_note=?,voided_by=?,voided_at=?,updated_at=?,approval_token=? WHERE id=? AND status=? AND revision=? AND review_note IS ?",
        [reason, actor.id, now, now, token, paymentId, input.expectedStatus, input.expectedRevision, input.expectedReviewNote],
      ),
      bindings(
        db,
        "UPDATE receipts SET status='void',void_reason=?,voided_at=? WHERE payment_id=? AND status='issued' AND EXISTS(SELECT 1 FROM payments WHERE id=? AND status='void' AND approval_token=?)",
        [reason, now, paymentId, paymentId, token],
      ),
      bindings(
        db,
        "UPDATE email_outbox SET status='cancelled',updated_at=? WHERE receipt_id IN(SELECT r.id FROM receipts r JOIN payments p ON p.id=r.payment_id WHERE p.id=? AND p.approval_token=?) AND status IN ('queued','blocked','rejected','dry_run')",
        [now, paymentId, token],
      ),
      bindings(
        db,
        `INSERT OR IGNORE INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,next_attempt_at,created_at,updated_at) SELECT ${sqlUuid},e.receipt_id,e.recipient_id,e.recipient_email,e.recipient_name,'receipt_void','queued',?,?,? FROM email_outbox e JOIN receipts r ON r.id=e.receipt_id JOIN payments p ON p.id=r.payment_id WHERE r.payment_id=? AND p.approval_token=? AND e.kind='receipt' AND r.status='void' AND p.status='void' AND e.recipient_id=p.designated_user_id AND json_extract(r.snapshot_json,'$.designatedAdult.id')=p.designated_user_id AND ?=1 AND e.recipient_email=? AND EXISTS(SELECT 1 FROM users u WHERE u.id=e.recipient_id AND u.active=1 AND lower(u.email)=lower(e.recipient_email)) AND NOT EXISTS(SELECT 1 FROM json_each(r.snapshot_json,'$.lines') line WHERE NOT EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=e.recipient_id AND l.athlete_id=json_extract(line.value,'$.athleteId') AND l.active=1))`,
        [now, now, now, paymentId, token, validEmail(originalRecipient?.recipientEmail) ? 1 : 0, originalRecipient?.recipientEmail ?? ""],
      ),
      paymentAudit(db, actor, paymentId, "void", { reason }, now, token),
    ]);
    if (!results[0].meta.changes) fail("El pago cambió.", 409, "conflict");
    return payment.receiptId;
  }
  if (!["pending", "needs_info"].includes(payment.status))
    fail("El pago ya fue revisado.", 409, "conflict");
  if (input.action === "reject" || input.action === "needs_info") {
    const reason = text(input.reason, 500),
      token = id();
    const result = await batch(db, [
      bindings(
        db,
        "UPDATE payments SET status=?,review_note=?,updated_at=?,approval_token=? WHERE id=? AND status=? AND revision=? AND review_note IS ?",
        [
          input.action === "reject" ? "rejected" : "needs_info",
          reason,
          now,
          token,
          paymentId,
          input.expectedStatus,
          input.expectedRevision,
          input.expectedReviewNote,
        ],
      ),
      paymentAudit(db, actor, paymentId, input.action, { reason }, now, token),
    ]);
    if (!result[0].meta.changes) fail("El pago cambió.", 409, "conflict");
    return null;
  }
  if (input.action !== "verify") fail("Acción inválida.");
  if (!input.bankChecked)
    fail("Confirme la transferencia en la cuenta bancaria.");
  if (input.currency !== "CRC") fail("Solo se admite CRC.");
  amount(input.amountMinor);
  date(input.paymentDate);
  text(input.bankReference, 128);
  text(input.bankName, 80);
  text(input.receivingAccount, 100);
  if (input.note) text(input.note, 500);
  if (
    input.amountMinor !== payment.amountMinor ||
    input.paymentDate !== payment.transferDate ||
    input.bankReference.trim() !== payment.bankReference.trim()
  )
    text(input.note, 500);
  // An existing inactive account or invalid contact address holds email, not a bank-confirmed receipt.
  // A missing account is a broken ownership invariant and must not produce fabricated identity data.
  const owner = await one<{ id: string; name: string; email: string }>(db,
    "SELECT id,name,email FROM users WHERE id=?", [payment.designatedAdultId]);
  if (!owner) fail("No se encontró la cuenta responsable asociada al pago.", 409, "recipient_missing");
  const lines = await validateAllocations(
    db,
    owner.id,
    input.allocations,
    input.amountMinor,
    true,
    await isAdvanceRequest(db, paymentId),
  );
  const year = billingYear(now),
    receiptId = id(),
    token = id();
  const snapshot: ReceiptSnapshot = {
    version: 1,
    receiptNumber: "PENDING",
    associationName: text(input.associationName, 200),
    payerName: payment.payerName,
    paymentDate: input.paymentDate,
    issuedAt: now,
    currency: "CRC",
    amountMinor: input.amountMinor,
    bankReference: input.bankReference.trim(),
    bankName: input.bankName.trim(),
    receivingAccount: input.receivingAccount.trim(),
    lines,
    unallocatedMinor:
      input.amountMinor - lines.reduce((s, l) => s + l.amountMinor, 0),
    designatedAdult: owner,
    demo: actor.mode === "demo",
  };
  const statements = [
    bindings(
      db,
      "UPDATE payments SET status='verified',verified_amount_minor=?,verified_date=?,verified_reference=?,verified_bank_name=?,verified_receiving_account=?,bank_match_key=?,verified_by=?,verified_at=?,approval_token=?,review_note=?,updated_at=? WHERE id=? AND status=? AND revision=? AND review_note IS ?",
      [
        input.amountMinor,
        input.paymentDate,
        input.bankReference.trim(),
        input.bankName.trim(),
        input.receivingAccount.trim(),
        bankMatch(input.bankName, input.receivingAccount, input.bankReference),
        actor.id,
        now,
        token,
        input.note || null,
        now,
        paymentId,
        input.expectedStatus,
        input.expectedRevision,
        input.expectedReviewNote,
      ],
    ),
  ];
  for (const line of lines)
    statements.push(
      bindings(
        db,
        "INSERT INTO payment_allocations(id,payment_id,charge_id,amount_minor,created_at) SELECT ?,id,?,?,? FROM payments WHERE id=? AND approval_token=?",
        [id(), line.chargeId, line.amountMinor, now, paymentId, token],
      ),
    );
  statements.push(
    bindings(
      db,
      "INSERT INTO receipt_counters(year,sequence) SELECT ?,1 WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND approval_token=?) ON CONFLICT(year) DO UPDATE SET sequence=sequence+1",
      [year, paymentId, token],
    ),
  );
  statements.push(
    bindings(
      db,
      "INSERT INTO receipts(id,payment_id,number,year,sequence,snapshot_json,created_at) SELECT ?,p.id,'AB-'||c.year||'-'||printf('%06d',c.sequence),c.year,c.sequence,json_set(?,'$.receiptNumber','AB-'||c.year||'-'||printf('%06d',c.sequence)),? FROM payments p JOIN receipt_counters c ON c.year=? WHERE p.id=? AND p.approval_token=?",
      [receiptId, JSON.stringify(snapshot), now, year, paymentId, token],
    ),
  );
  statements.push(
    bindings(
      db,
      `INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,next_attempt_at,created_at,updated_at) SELECT ${sqlUuid},r.id,u.id,u.email,u.name,'receipt','queued',?,?,? FROM receipts r JOIN payments p ON p.id=r.payment_id JOIN users u ON u.id=p.designated_user_id AND u.active=1 WHERE r.id=? AND p.approval_token=? AND p.status='verified' AND r.status='issued' AND json_extract(r.snapshot_json,'$.designatedAdult.id')=u.id AND ?=1 AND u.email=? AND NOT EXISTS(SELECT 1 FROM json_each(r.snapshot_json,'$.lines') line WHERE NOT EXISTS(SELECT 1 FROM guardian_links l WHERE l.user_id=u.id AND l.athlete_id=json_extract(line.value,'$.athleteId') AND l.active=1))`,
      [now, now, now, receiptId, token, validEmail(owner.email) ? 1 : 0, owner.email],
    ),
  );
  statements.push(
    bindings(
      db,
      "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,action,detail_json,created_at) SELECT ?,?,'payment',p.id,'verify',json_set(?,'$.emailRecipientPending',json(CASE WHEN EXISTS(SELECT 1 FROM email_outbox e WHERE e.receipt_id=? AND e.kind='receipt') THEN 'false' ELSE 'true' END),'$.emailRecipientUserId',(SELECT e.recipient_id FROM email_outbox e WHERE e.receipt_id=? AND e.kind='receipt')),? FROM payments p WHERE p.id=? AND p.approval_token=?",
      [
        id(),
        actor.id,
        JSON.stringify({
          receiptId,
          bankMatchConfirmed: true,
          emailRecipientPolicy: payment.submitterId === payment.designatedAdultId ? "uploader_only" : "designated_adult",
          amountMinor: input.amountMinor,
          allocations: input.allocations,
        }),
        receiptId,
        receiptId,
        now,
        paymentId,
        token,
      ],
    ),
  );
  const result = await batch(db, statements);
  if (!result[0].meta.changes)
    fail("El pago ya fue revisado.", 409, "conflict");
  return receiptId;
}

export async function applyPaymentCredit(
  db: D1Database,
  actor: Actor,
  input: ApplyPaymentCreditInput,
): Promise<void> {
  admin(actor);
  await requireActor(db, actor);
  const reason = text(input.reason, 500);
  if (!Array.isArray(input.allocations) || !input.allocations.length || input.allocations.length > 36)
    fail("Seleccione las mensualidades.");
  const allocations = input.allocations.map(a => ({ chargeId: text(a.chargeId, 80), amountMinor: amount(a.amountMinor) }))
    .sort((a,b) => a.chargeId.localeCompare(b.chargeId));
  const operation = financialOperation(actor, "apply_credit", input.paymentId, input.operationId, { allocations, reason });
  if (await completedFinancialOperation(db, operation)) return;
  try {
    const payment = await authorizedPayment(db, actor, input.paymentId);
    if (payment.status !== "verified") fail("Pago no verificado.", 409, "conflict");
    await validateAllocations(db, payment.designatedAdultId, allocations, payment.unallocatedMinor, true);
    const now = iso();
    const result = await batch(db, [
      claimFinancialOperation(db, operation, now),
      ...allocations.map(a => bindings(db,
        "INSERT INTO payment_allocations(id,payment_id,charge_id,amount_minor,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM financial_operations WHERE claim_token=?)",
        [id(), input.paymentId, a.chargeId, a.amountMinor, now, operation.claimToken])),
      financialOperationAudit(db, actor, operation, "payment", "apply_credit", { ...input, allocations, reason }, now),
    ]);
    if (!result[0].meta.changes) await completedFinancialOperation(db, operation);
  } catch (error) {
    // A competing identical request may finish while this request validates balances.
    if (await completedFinancialOperation(db, operation)) return;
    throw error;
  }
}

/** Synthetic demo enrollment only; no payment/receipt history is silently invented. */
export async function seedDemo(db: D1Database): Promise<void> {
  const adminActor: Actor = {
    id: "demo-admin",
    email: "admin@example.invalid",
    name: "Administración de prueba",
    isAdmin: true,
    mode: "demo",
  };
  const adults: Actor[] = [
    adminActor,
    {
      id: "demo-parent-a",
      email: "ana@example.invalid",
      name: "Ana de prueba",
      isAdmin: false,
      mode: "demo",
    },
    {
      id: "demo-parent-b",
      email: "diego@example.invalid",
      name: "Diego de prueba",
      isAdmin: false,
      mode: "demo",
    },
    {
      id: "demo-unrelated",
      email: "otra@example.invalid",
      name: "Familia independiente",
      isAdmin: false,
      mode: "demo",
    },
  ];
  for (const actor of adults) await ensureUser(db, actor);
  const now = iso(),
    currentPeriod = billingPeriod(now);
  for (const [athleteId, name, fee] of [
    ["demo-athlete-1", "Timothy de prueba", 1200000],
    ["demo-athlete-2", "Sofía de prueba", 1500000],
    ["demo-athlete-3", "Alex independiente", 1200000],
  ] as const)
    await bindings(
      db,
      "INSERT OR IGNORE INTO athletes(id,name,category,fee_minor,discount_minor,active,start_period,created_at,updated_at) VALUES(?,?,?, ?,0,1,?,?,?)",
      [
        athleteId,
        name,
        fee === 1200000 ? "Iniciación" : "Avanzados",
        fee,
        currentPeriod,
        now,
        now,
      ],
    ).run();
  for (const [userId, athleteId] of [
    ["demo-parent-a", "demo-athlete-1"],
    ["demo-parent-a", "demo-athlete-2"],
    ["demo-parent-b", "demo-athlete-1"],
    ["demo-unrelated", "demo-athlete-3"],
  ])
    await bindings(
      db,
      "INSERT OR IGNORE INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,?,1,0,?,?,?)",
      [userId, athleteId, adminActor.id, now, now],
    ).run();
  await publishMonth(db, adminActor, currentPeriod, (await getMonthlyPreview(db, currentPeriod)).snapshot);
}
