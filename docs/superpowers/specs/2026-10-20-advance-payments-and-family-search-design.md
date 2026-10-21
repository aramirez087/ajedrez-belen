# Advance payments and admin family search — design

Date: 2026-10-20. Status: draft for the owner's approval. Not committed (the owner commits).

## Why

Some parents want to pay several months at once (for example three months in advance). Today the portal cannot take that payment cleanly:

- Monthly charges only exist from the 1st of each month (the daily cron `publishCurrentMonth`), so a future month has nothing to pay against.
- A family that is up to date sees "Estás al día" and no form. Admins see a disabled submit button.
- The server rejects any payment with no month selected (`canonicalSubmission` and `validateAllocations` in `src/lib/portal/domain.ts`).
- An overpayment already becomes credit ("saldo a favor"), but an admin has to apply that credit by hand each month (`applyPaymentCredit`).

Separately, an admin registering a payment for a family must pick the family from a single `<select>` listing every account (`src/pages/admin/pagos/nuevo.astro`). That stops being usable at 50–100 families.

Success: a parent pays N months once; each month is marked paid by itself on the 1st; nobody re-enters anything. An admin finds a family by typing a child's name, a parent's name or an email.

## Goals

1. Families and admins can register a payment that covers months that do not exist yet ("Adelantar meses").
2. Credit applies itself to charges as they are published, oldest first, with no admin action.
3. Families and admins can see how far ahead a family is paid ("Pagado hasta enero").
4. Admins pick a family by search, not a dropdown. Familias gets a "Registrar pago" shortcut per account.

## Non-goals and anti-goals

- No pre-created future charges. Credit is money, not locked months.
- No price locking. If the monthly fee rises while a family is paid ahead, credit covers less and the family owes the difference when the month is published. This is my call, the owner has not explicitly decided it.
- No refund or "devolver saldo" flow. Unapplied credit stays visible. (Follow-up if the association wants it.)
- No email when credit is applied. The existing receipt email is the only message (the outbox only supports `receipt` and `receipt_void`).
- No change to discounts: the sibling discount rule and manual discounts stay as they are.
- No new database table or column. No migration.
- Anti-goal: an advance must never be created by accident. The email-inbound path keeps requiring at least one month.
- Anti-goal: the dashboard "Saldo pendiente" must not start counting future months as debt.

## Constraints

- Presentation and ledger changes are approved for this feature only. Keep existing invariants: allocations and receipts are immutable, amounts are integer minor units (CRC), financial writes are single D1 batches guarded by the existing triggers (`allocation_payment_total` and friends).
- Local demo data only. Do not commit or push (the owner does). Do not deploy.
- Mobile first: parents are mostly on phones. Copy is Spanish, one or two short sentences, single next action on top. Match existing component idiom and `class="portal-*"` styles.
- Workers CPU budget: any new query must be bounded (family counts are ≤ 100; no N+1 per request on lists).

## Design

### A. Registering an advance

**Rule.** A payment may be registered with zero month allocations when the request explicitly says it is an advance. All of it becomes credit when verified. A payment with some allocations plus a remainder behaves as today (remainder = credit).

**Family page** (`src/pages/portal/pagos/nuevo.astro`):
- The form shows even when the family is up to date. The "Estás al día" block becomes a short line above the form: "Estás al día. Puedes adelantar meses."
- New block between step 03 and the submit: "¿Adelantar meses?" with chips 1, 2, 3, 6 and a number field (0–12). Choosing N sets the transfer amount to the selected months' total plus N × the family's monthly rate (see "Monthly rate"). It follows the same "auto amount until the person types their own" mirror as `ChargeAllocator.astro`.
- The submit button enables when there is at least one month selected or N ≥ 1. If neither, the existing message stays.
- Help line under the block: "Se aplica solo cada mes, cuando se publique la mensualidad. No tienes que volver a registrar nada."

**Admin page** (`src/pages/admin/pagos/nuevo.astro`): same block with `voice="admin"` wording. The disabled-button message for families with no charges goes away. The audit reason stays required.

**Server.** `canonicalSubmission` (and `assertSubmissionAccess`, `submitPayment`, the review/verify path, `revisePayment`) accept an empty allocation list only when a request-level flag is set by the form route (`advance=on`). The flag is not stored: it only relaxes validation at the entry point. The canonical comparison used by `recoverPaymentSubmission` must keep matching rows already stored. Entry points that do not set the flag (email-inbound, `src/lib/portal/email-payment.ts`) keep today's "at least one month" rule.

**Verification (admin review).** The review form allows verifying with no allocations when the payment was requested with none. The admin sees "Adelanto: todo queda como saldo a favor (₡X)". The receipt snapshot has `lines: []` and `unallocatedMinor = amount`; `receipt.ts` already supports this ("Sin aplicación a mensualidades" plus "Saldo a favor sin aplicar"). Add one sentence to the receipt when there are no lines and credit remains: it applies to future months automatically. Existing receipts and their tests must still render the same.

### B. Credit settles itself

New domain function `settleCredit(db, now)`:

1. Find verified payments with unallocated credit, oldest `verified_at` first.
2. For each, take the designated adult's linked athletes' charges with `period <= current Costa Rica period` and `balance > 0`, ordered by period, then athlete name.
3. Allocate `min(remaining credit, balance)` per charge. One D1 batch per payment: the `payment_allocations` inserts plus one audit event `auto_apply_credit` by `SYSTEM_MONTHLY_ACTOR` with the charge ids and amounts.
4. Safe under races: if two runs plan the same allocation, the existing triggers (`allocation_exceeds_payment`, `allocation_exceeds_charge`) abort the second batch; the function treats that as "already done" and re-plans once.

Called:
- At the end of `publishCurrentMonth` on every cron run, including runs where `newCount === 0` (so a failed settle is retried the next day).
- After a successful manual `publishMonth`.

Credit from any verified payment settles, not only advances. This matches the terms page ("el excedente queda como saldo a favor y se aplica a mensualidades futuras").

Older open charges settle before newer ones, so a family that owed last month and paid ahead is not left with an old debt.

The Payment history label map in `PaymentHistory.astro` gains `auto_apply_credit: 'Adelanto aplicado a una mensualidad'`.

### C. Showing "Pagado hasta"

Helper `creditCoverage(creditMinor, monthlyRateMinor, startPeriod)` returns how many whole future months the remaining credit covers and the last covered period. `startPeriod` is the month after the latest published period.

Shown:
- Family dashboard (`src/pages/portal/index.astro`): where credit appears today, one line: "Adelanto: pagado hasta enero. Sobran ₡X."
- Admin family cards and the selected-family panel on the register page.

Not shown when credit covers less than one month; then it stays "Saldo a favor ₡X".

**Monthly rate.** `familyMonthlyRate(db, adultId, period)` = sum over that adult's linked athletes who would be billed (active, not paused, `start_period <= period`) of fee − sibling discount, using `siblingDiscounts` so it matches what publishing produces.

### D. Admin finds a family by search

Replace the `<select>` in `nuevo.astro` with a server-rendered search (GET, no JavaScript needed):

- Search box labelled "Buscar familia" (child, parent or email), autofocus. Matching is accent-insensitive and uses the same logic as Familias, extracted to a shared `src/lib/portal/family-search.ts` (also used by `familias.astro`).
- Below it, a list of matching active accounts, alphabetical, 20 per page with the same pagination style as Familias. Each row: parent name, email, athletes, "Saldo ₡X" and, if any, "Adelanto". Each row links to `?adult=ID` (keeping `q`).
- After choosing, the selected-family panel gets a "Cambiar familia" link back to the search.
- Per-family balance and credit come from one grouped query for all accounts (no per-family queries).
- `familias.astro` account rows get a "Registrar pago" link to `/admin/pagos/nuevo?adult=ID`.

## Decided by me (check these)

1. Fee increase while paid ahead: family owes the difference (credit is money).
2. All verified credit auto-settles, not only advances.
3. Oldest charge first, across all of a family's athletes.
4. Settle only touches charges up to the current month, so an admin who publishes next month early does not consume credit early.
5. Months stepper allows 1–12 with chips 1, 2, 3, 6.
6. No email when credit is applied.
7. The advance flag is request-level and not stored; the amount and the remainder carry the meaning.

## Left to the builder

- Exact component split (new `AdvanceMonths.astro` vs extending `ChargeAllocator.astro`) and how the script mirrors the transfer amount. Reuse `allocation-validation.ts`; the "ready" summary must accept zero allocations when advance months are chosen.
- Query shapes for family balances and credit.
- Test design. Follow the repo's real-SQLite pattern (`tests/portal-monthly-publish.test.ts`). Cover at least: pure-advance verify, settle on publish (multi-month, multi-athlete, oldest first), settle idempotent on rerun, settle racing (second batch aborts cleanly), settle skips voided payments, fee increase leaves a remainder owed, email-inbound still requires a month, family search matching and pagination, receipt text with and without lines.

## Verification

`npm test`, `npm run check`, `test:portal` against `http://127.0.0.1:4400`, the 320–1440 px sweep, and the axe path from the verification-tooling memory. Manually walk both flows (family on a phone, admin) end to end on demo data: submit advance, verify, run the monthly publish, see the month marked paid.
