# Advance payments and admin family search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Families and admins can register payments for months that do not exist yet; the credit settles itself into each month's charge when published; admins find a family by search instead of a dropdown.

**Architecture:** A payment may carry zero month allocations when the entry point says it is an advance (`advance` flag on submit; derived from "no requested allocations" on revise and verify). A new `settleCredit` allocates verified, unallocated credit to open charges (period ≤ current Costa Rica month, oldest first) using the existing `payment_allocations` triggers as the race guard; it runs after every publish (cron route and admin publish). Pure helpers (`advance.ts`, `family-search.ts`) hold the arithmetic and search so they unit-test without a browser. No migration.

**Tech Stack:** Astro 7 SSR on Cloudflare Workers, D1 (SQLite), `node:test` with `node:sqlite` adapter, vanilla client scripts inside `.astro` files, Spanish UI copy.

**Spec:** `docs/superpowers/specs/2026-10-20-advance-payments-and-family-search-design.md`

## Global Constraints

- No database migration; amounts are integer minor units (CRC); financial writes are single D1 batches; allocations, receipts and audit rows stay immutable.
- Do not commit or push (the owner commits). Do not deploy. Local demo data only.
- Mobile first. Copy is Spanish, one or two short sentences, single next action on top. Match existing `portal-*` classes and component idiom.
- The email-inbound path (`src/lib/portal/email-payment.ts`) must keep requiring at least one month. Do not edit it.
- `publishCurrentMonth` must keep returning exactly `{ period, created }` (existing test uses `deepEqual`).
- Any new list query is bounded and not per-row (family counts ≤ 100, athletes ≤ 300).
- Existing tests that fail because credit now settles itself: review each one. Change an assertion only if it encodes the old manual-apply behavior, and list every such change in the final summary.
- Verification before calling a task done: `npm test` and `npm run check` pass.

## Review Focus

Failure modes the spec implies, most likely first. Each has a test in the owning task.

1. Two settle runs race (cron and admin publish at once): no allocation may exceed a payment or a charge. (Task 2)
2. A voided payment's credit must not settle; voiding after settling must return the charge to unpaid. (Task 2)
3. A family with no billable athlete (all paused/inactive) has monthly rate 0: coverage is 0 months, no divide-by-zero, no advance chips. (Task 3)
4. Coverage across a year boundary (Nov + 3 months → Jan next year). (Task 3)
5. Fee rises while paid ahead: charge keeps a partial balance equal to the difference. (Task 2)

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/portal/advance.ts` (create) | Pure: month arithmetic, advance amount, credit coverage, advance selection parsing |
| `src/lib/portal/family-search.ts` (create) | Pure: accent-insensitive family match, pagination |
| `src/lib/portal/domain.ts` (modify) | Zero-allocation rules, `settleCredit`, `familyMonthlyRates`, `advanceQuote`, `listFamilyMoney` |
| `src/lib/portal/types.ts`, `http.ts`, `receipt.ts` (modify) | `advance` input flag, `parseAdvanceMonths`, receipt advance note |
| `src/pages/api/internal/publish-monthly.ts`, `src/pages/api/portal/payments/index.ts` (modify) | Run settle after cron publish; pass advance flag |
| `src/components/portal/AdvanceMonths.astro` (create), `ChargeAllocator.astro` (modify) | Advance chips and the amount/validation behavior |
| `src/pages/portal/pagos/nuevo.astro`, `[id].astro`, `portal/index.astro`, `PaymentHistory.astro` (modify) | Family flow, "Pagado hasta", copy |
| `src/pages/admin/pagos/nuevo.astro`, `[id].astro`, `admin/familias.astro` (modify) | Admin search, advance, review of advances, shortcut |
| `tests/portal-advance.test.ts`, `tests/portal-advance-payments.test.ts`, `tests/portal-family-search.test.ts` (create) | Pure helpers; domain behavior on real SQLite; search |

---

### Task 1: Zero-allocation advance payments (server)

**Files:**
- Modify: `src/lib/portal/types.ts` (`SubmitPaymentInput`), `src/lib/portal/domain.ts` (`validateAllocations`, `canonicalSubmission`, `recoverPaymentSubmission`, `submitPayment`, `revisePayment`, `reviewPayment` verify branch), `src/lib/portal/http.ts`, `src/pages/api/portal/payments/index.ts`, `src/lib/portal/receipt.ts`
- Test: `tests/portal-advance-payments.test.ts` (create; copy the `SQLiteD1` adapter with `beforeBatch`, the `input` and `verification` helpers and the `admin`/`parent` actors from `tests/portal-domain.test.ts`, repo convention; use `seedDemo`), plus `tests/portal-receipt.test.ts`

**Interfaces:**
- Produces: `SubmitPaymentInput.advance?: boolean`; `validateAllocations(db, userId, allocations, paid, checkBalance, allowEmpty = false)`; `parseAdvanceMonths(form: FormData): number` in `http.ts` (integer 0–12, absent → 0, anything else throws `InputError('invalid_fields')`); `export const ADVANCE_RECEIPT_NOTE = 'Este saldo se aplica automáticamente a las próximas mensualidades.'` in `receipt.ts`.

- [ ] **Step 1: Write failing tests** in `tests/portal-advance-payments.test.ts`:
  - `"an advance needs the explicit flag"`: `submitPayment(db, parent, input([], 4500000))` rejects with `PortalError` status 400, message `"Seleccione las mensualidades."`; with `{ ...input([], 4500000), advance: true }` it resolves and `SELECT count(*) FROM payment_requested_allocations` for that payment is 0.
  - `"verifying an advance with no months keeps the whole amount as credit"`: submit with flag, `reviewPayment(db, admin, id, { ...verification(data), allocations: [] })` returns a receipt id; `getReceipt(...).snapshot.lines` is `[]`, `unallocatedMinor === 4500000`; `getParentDashboard(db, parent).creditMinor === 4500000`.
  - `"a payment that named months cannot be verified with none"`: submit with one allocation, verify with `allocations: []` rejects (400).
  - `"an advance in needs_info can be corrected without months"`: review `needs_info`, then `revisePayment` with `allocations: []` resolves.
  - `"a plain submission with no months is still refused"` for the shape email-inbound uses (no `advance`, empty list) → rejects.
  - `parseAdvanceMonths`: `""`/missing → 0, `"3"` → 3, `"12"` → 12, `"13"`, `"-1"`, `"2.5"`, `"abc"` → throws `InputError`.
- [ ] **Step 2: Add to `tests/portal-receipt.test.ts`**: with `lines: []` and `unallocatedMinor > 0`, `renderReceipt(...).text` and `.html` contain `ADVANCE_RECEIPT_NOTE`; with lines present neither contains it.
- [ ] **Step 3: Run** `node --import tsx --test tests/portal-advance-payments.test.ts tests/portal-receipt.test.ts` → FAIL.
- [ ] **Step 4: Implement.**
  - `canonicalSubmission` accepts an empty allocation list only when `input.advance === true`; the returned canonical object must not include `advance`, so `recoverPaymentSubmission` still matches rows already stored.
  - `validateAllocations` gains `allowEmpty`; when true and the list is empty it returns `[]` (the length ≤ 36 and duplicate checks still apply).
  - `submitPayment` and `recoverPaymentSubmission` pass `allowEmpty` = the request is an advance with an empty list. `revisePayment` and the `verify` branch of `reviewPayment` pass `allowEmpty` = `SELECT count(*) FROM payment_requested_allocations WHERE payment_id=?` is 0 (server-derived; no client flag).
  - `index.ts` route adds `advance: parseAdvanceMonths(form) > 0` to `input`.
  - `receipt.ts`: when `data.lines.length === 0 && data.unallocatedMinor > 0`, add `ADVANCE_RECEIPT_NOTE` after the credit line in both text and html; no other receipt output changes.
- [ ] **Step 5: Run** the two files → PASS; then `npm test` → all existing tests pass (email-inbound tests prove its rule is untouched).

---

### Task 2: Credit settles itself

**Files:**
- Modify: `src/lib/portal/domain.ts` (add `settleCredit`; extract `ensureSystemActor` from `publishCurrentMonth`; call settle at the end of `publishMonth`), `src/pages/api/internal/publish-monthly.ts`
- Test: `tests/portal-advance-payments.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 (an advance can be submitted and verified with no months).
- Produces: `export async function settleCredit(db: D1Database, instant: string): Promise<number>` returning the number of allocation rows created; internal `ensureSystemActor(db: D1Database): Promise<void>`.

Algorithm (not determined by the signature):
1. `ensureSystemActor`; `period = billingPeriod(instant)`.
2. Select verified payments whose `verified_amount_minor` exceeds the sum of their allocations, ordered by `verified_at, id`.
3. For each payment, re-query the designated adult's linked, active-link charges with `period <= ?` and `totalMinor - paidMinor > 0` (reuse `chargeSql`), ordered by `c.period, s.name, c.id`. Allocate `min(remaining credit, balance)` down the list.
4. One `batch` per payment: the `payment_allocations` inserts plus one `audit` row (actor `SYSTEM_MONTHLY_ACTOR`, entity `payment`, action `auto_apply_credit`, detail `{ allocations: [{ chargeId, amountMinor }] }`). Skip the batch when nothing is allocated.
5. The domain `batch()` wrapper turns trigger aborts into `PortalError` status 409. On a 409, re-plan that payment once from fresh state; a second 409 rethrows.
6. `publishMonth` calls `settleCredit(db, iso())` after its batch succeeds; a settle failure there is caught and written with `console.error(JSON.stringify({ event: 'settle_credit_failed', message }))`, never failing the publish (the daily cron retries). `publish-monthly.ts` calls `settleCredit(env.DB, new Date().toISOString())` after `publishCurrentMonth`, includes `settled` in the logged and returned JSON, and returns 500 `'Settle failed'` if it throws (publish already committed; next run repeats). `publishCurrentMonth` itself is not changed.

- [ ] **Step 1: Write failing tests** (publish instants like `"2026-11-01T06:00:00.000Z"` as in `tests/portal-monthly-publish.test.ts`):
  - `"credit settles oldest month first across siblings"`: a verified advance equal to two months of the family's net rate; after `publishCurrentMonth` for the next month and `settleCredit`, the allocation rows are ordered period then athlete, every settled charge has `balanceMinor === 0`, the payment's unallocated amount is 0, and one `auto_apply_credit` audit row exists with actor `system:monthly-publish`.
  - `"settling twice allocates nothing the second time"`: second call returns 0, row counts unchanged.
  - `"a competing manual application cannot be over-allocated"`: set `adapter.beforeBatch` to call `applyPaymentCredit` on the same charge; `settleCredit` resolves; no charge's allocated sum exceeds its total and no payment's allocated sum exceeds its verified amount.
  - `"a voided payment does not settle, and voiding after settling frees the charge"`: void then `settleCredit` returns 0; separate case: settle, void, `getParentDashboard(...).balanceMinor` returns to the unpaid amount.
  - `"settle ignores charges after the current month"`: publish next month early with `publishMonth`, `settleCredit(db, <current month instant>)` leaves that charge untouched.
  - `"a fee increase leaves the difference owed"`: credit equals one month at the old fee; raise the athlete's category fee, publish, settle → charge balance equals new fee minus credit.
  - `"credit never crosses families"`: the unrelated family's credit never allocates to parent A's charges and vice versa.
  - `"publishMonth settles credit"`: manual `publishMonth` for the current month applies existing credit.
- [ ] **Step 2: Run** `node --import tsx --test tests/portal-advance-payments.test.ts` → FAIL.
- [ ] **Step 3: Implement** per the algorithm above.
- [ ] **Step 4: Run** the file → PASS; `npm test` → pass (apply the global rule for any old test now failing).

---

### Task 3: Rates, coverage and family money (pure + queries)

**Files:**
- Create: `src/lib/portal/advance.ts`
- Modify: `src/lib/portal/domain.ts`
- Test: `tests/portal-advance.test.ts` (create, pure), `tests/portal-advance-payments.test.ts` (append, domain)

**Interfaces:**
- Produces in `advance.ts`: `MAX_ADVANCE_MONTHS = 12`; `addMonths(period: string, months: number): string` (`'YYYY-MM'`); `advanceMinor(months: number, monthlyRateMinor: number): number`; `advanceSelection(value: string): number | null` (`''` → 0, integer 0–12 → itself, else `null`); `interface CreditCoverage { months: number; throughPeriod: string | null; leftoverMinor: number }`; `creditCoverage(creditMinor: number, monthlyRateMinor: number, startPeriod: string): CreditCoverage`.
- Produces in `domain.ts`: `familyMonthlyRates(db, period: string): Promise<Map<string, number>>` (adult id → net monthly minor); `advanceQuote(db, adultId: string, creditMinor?: number, instant?: string): Promise<{ monthlyRateMinor: number } & CreditCoverage>`; `listFamilyMoney(db): Promise<Map<string, { balanceMinor: number; creditMinor: number }>>`.

Rules: coverage `startPeriod` is the month after the current Costa Rica month (not "after the latest published"): settle only touches months up to the current one, so the first month still waiting for credit is next month. `creditCoverage` returns `months: 0, throughPeriod: null, leftoverMinor: creditMinor` when the rate is ≤ 0 or credit is below one month; months are capped at 36. `familyMonthlyRates` bills athletes with `active=1 AND paused=0 AND start_period <= period`, net of `Math.min(fee, siblingMinor)` from `siblingDiscounts` (same as publishing), summed per active guardian link; an athlete linked to two adults counts for both. `listFamilyMoney` is two grouped queries over all adults, not per row; `balanceMinor` sums charge balances, `creditMinor` sums verified unallocated amounts, both by designated adult / linked athlete.

- [ ] **Step 1: Write failing pure tests** in `tests/portal-advance.test.ts`: `addMonths("2026-11", 3) === "2027-02"`, `addMonths("2026-12", 1) === "2027-01"`; `advanceMinor(3, 1500000) === 4500000`; `advanceSelection` for `""`, `"0"`, `"12"`, `"13"`, `"-1"`, `"1.5"`, `"x"`; `creditCoverage(4500000, 1500000, "2026-11")` → `{ months: 3, throughPeriod: "2027-01", leftoverMinor: 0 }`; `creditCoverage(4600000, 1500000, "2026-11").leftoverMinor === 100000`; rate 0 and credit below one month → `months 0`, `throughPeriod null`; huge credit capped at 36.
- [ ] **Step 2: Write failing domain tests**: two siblings under one adult get the 25% discount on the discounted athlete's net; a paused, an inactive and a future-`start_period` athlete are excluded; an adult with no billable athlete is absent from the map and `advanceQuote` returns `monthlyRateMinor 0, months 0`; a shared athlete counts for both guardians; `listFamilyMoney` matches `getParentDashboard` balance and credit for each demo adult.
- [ ] **Step 3: Run** both files → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS; `npm test`.

---

### Task 4: Advance chips and allocator behavior

**Files:**
- Create: `src/components/portal/AdvanceMonths.astro`
- Modify: `src/components/portal/ChargeAllocator.astro` (markup prop + script)
- Test: `tests/portal-allocation-validation.test.ts` (extend; pure parts only); behavior verified in the browser in Tasks 5 and 7

**Interfaces:**
- Consumes: `advanceSelection`, `advanceMinor`, `MAX_ADVANCE_MONTHS` from Task 3.
- Produces: `<AdvanceMonths monthlyRateMinor={number} voice?="family"|"admin" value?={number} />`, renders nothing when the rate is 0; otherwise a `fieldset[data-advance][data-rate-minor]` containing chip buttons for 1, 2, 3 and 6 months labelled `"N meses · ₡X"` (singular `"1 mes"`) and `input[name="advanceMonths"][type="number"][min=0][max=12][inputmode="numeric"]` that works without JavaScript. `ChargeAllocator` gains a boolean prop `allowEmpty` (sets `data-allow-empty` on its fieldset).

Behavior of the `ChargeAllocator` script when the form holds `[name="advanceMonths"]` with value `n > 0`, or the fieldset has `data-allow-empty`:
- Submit buttons are not disabled for lack of eligible charges, and the "Toca «Pagar todo»…" error does not appear for a zero total.
- The transfer-amount mirror follows `allocated total + advanceMinor(n, rate)` while still automatic, even when the allocated total is 0.
- The status line reads `"Adelantas N meses (₡X). Se aplican solos cuando se publique cada mes."` (both voices; "1 mes" singular), and the existing "total exceeds transfer" check is unchanged.
- Chip click sets the number input, then dispatches `input` on the form. A value `advanceSelection` rejects (`null`) shows the field's native validity message `"Escribe un número de 0 a 12."`.

- [ ] **Step 1: Write failing tests** in `tests/portal-allocation-validation.test.ts`: `advanceSelection` cases are already in Task 3; here add a source-level test that `ChargeAllocator.astro` contains `data-allow-empty` and `advanceMonths` handling and that `AdvanceMonths.astro` exists with `name="advanceMonths"`, following how `tests/portal-family-form-ux.test.ts` asserts on page source.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the component and script changes above. **Step 4: Run** → PASS; `npm test`; `npm run check`.

---

### Task 5: Family flow, "Pagado hasta", copy

**Files:**
- Modify: `src/pages/portal/pagos/nuevo.astro`, `src/pages/portal/pagos/[id].astro`, `src/pages/portal/index.astro`, `src/components/portal/PaymentHistory.astro`
- Test: existing `tests/portal-family-form-ux.test.ts`, `tests/portal-plain-ux.test.ts`, `tests/portal-due-state.test.ts` (update only assertions that encode the removed "up to date → no form" state; list changes); then `npm run test:portal`

**Interfaces:** Consumes `advanceQuote` (Task 3) and `AdvanceMonths`/`ChargeAllocator allowEmpty` (Task 4).

- [ ] **Step 1: `nuevo.astro`**: `showForm = !dashboardUnavailable && !noAthletes`. Call `advanceQuote(env.DB, actor.id, dashboard.creditMinor)`; when `upToDate`, show one line above the form: `"Estás al día. Puedes adelantar meses."` instead of the dead-end panel (drop its "¿Transferiste por adelantado? Avisa por WhatsApp" aside and the email-draft "regístralo cuando se publique la próxima mensualidad" wording). Render `<AdvanceMonths monthlyRateMinor={quote.monthlyRateMinor} />` after the allocator inside the form; the submit button is no longer disabled by `charges.length === 0` when the rate is above 0 (JS and the server govern); add the help line `"Se aplica solo cada mes, cuando se publique la mensualidad. No tienes que volver a registrar nada."`.
- [ ] **Step 2: `index.astro`**: search for `draftsActionable` and the email-draft copy that tells families to wait; a family with a billable athlete can now register a draft as an advance, so make drafts actionable and fix the wording. Where credit shows today, when `advanceQuote(...).months > 0` show one line `"Adelanto: pagado hasta {monthLabel(throughPeriod)}. Sobran {money(leftoverMinor)}."` (call `advanceQuote` only when `dashboard.creditMinor > 0`); below one month it stays `"Saldo a favor ₡X"`. The "Estás al día / Adelantar el pago" card's link stays valid.
- [ ] **Step 3: `[id].astro` (family revise)**: pass `allowEmpty={detail.requestedAllocations.length === 0}` to the allocator and drop the `disabled` condition in that case. **`PaymentHistory.astro`**: add `auto_apply_credit: 'Adelanto aplicado a una mensualidad'` to `actionLabels`.
- [ ] **Step 4: Verify**: `npm test`, `npm run check`; start the local portal as in `scripts/test-portal.mjs` (`PORTAL_TEST_URL=http://127.0.0.1:4400`), log in as `parent-a` via the demo POST (memory: portal-verification-tooling), register a 3-month advance on a phone-width viewport (320 and 390 px), confirm the amount follows the chosen months, the form submits, and the payment shows `"en revisión"`. Run `npm run test:portal`.

---

### Task 6: Family search library

**Files:**
- Create: `src/lib/portal/family-search.ts`
- Test: `tests/portal-family-search.test.ts` (create)

**Interfaces:**
- Produces: `normalizeSearch(value: string): string` (NFD, strip diacritics, `toLocaleLowerCase('es')`); `familyMatches(family: Family, normalizedQuery: string): boolean` (adult name, email or any athlete name contains the query; empty query matches all); `paginate<T>(items: readonly T[], requestedPage: unknown, size = 20): { items: T[]; page: number; pages: number }` (page clamps to 1…pages; non-numeric → 1; empty list → page 1, pages 1).

- [ ] **Step 1: Write failing tests**: `familyMatches` finds `"sofia"` for athlete `"Sofía de prueba"`, finds by email fragment, by adult name, returns false for no match, true for empty query; `paginate` with 45 items and size 20 gives pages 3, page 0 → 1, page 99 → 3, `"x"` → 1, last page has 5 items.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

---

### Task 7: Admin pages

**Files:**
- Modify: `src/pages/admin/pagos/nuevo.astro`, `src/pages/admin/pagos/[id].astro`, `src/pages/admin/familias.astro`
- Test: existing `tests/portal-assisted-flow.test.ts` and `tests/portal-family-form-ux.test.ts` (update only assertions that encode the removed `<select>` or the disabled button; list changes); then `npm run test:portal`

**Interfaces:** Consumes Task 3 (`listFamilyMoney`, `familyMonthlyRates`, `advanceQuote`), Task 4, Task 6.

- [ ] **Step 1: `nuevo.astro` search.** Replace the `<select>` form with a GET search: label `"Buscar familia"`, `input[type=search][name=q]` with `autofocus`, hint `"Nombre del atleta, de la persona o correo"`. Below it, active accounts matching `familyMatches`, alphabetical, `paginate` 20 per page, with pager links built like `familias.astro`'s `pageHref` and preserving `q`. Each row is a link to `?adult=ID&q=…` showing adult name, email, athlete names, `"Saldo ₡X"` and, when credit exists, `"Adelanto ₡Y"` plus `"· pagado hasta {mes}"` when coverage is at least one month (rates from one `familyMonthlyRates` call; money from one `listFamilyMoney` call). No results: `"No encontramos esa familia. Prueba con otro nombre o correo."`. When `adult` is selected, show the existing panel plus a `"Cambiar familia"` link to `/admin/pagos/nuevo?q=…`; the search list is hidden then.
- [ ] **Step 2: `nuevo.astro` advance.** Render `<AdvanceMonths voice="admin" monthlyRateMinor={quote.monthlyRateMinor} />` after the allocator; remove the `disabled={charges.length === 0}` and its "no tiene mensualidades pendientes" message when the rate is above 0 (replace with `"Esta familia está al día: puedes registrar un adelanto."`). The audit reason stays required.
- [ ] **Step 3: `[id].astro` review.** When `detail.requestedAllocations.length === 0` and status is reviewable, add above the form a guidance block `"Adelanto: la familia no indicó mensualidades. Todo queda como saldo a favor y se aplica solo cuando se publique cada mes."`; pass `allowEmpty` to the verify allocator and enable the confirm button (`disabled` only when `charges.length === 0 && requestedAllocations.length > 0`). For verified payments with credit left, add `"Se aplica solo en la próxima publicación."` before the manual "Aplicar saldo a favor" form, which stays available.
- [ ] **Step 4: `familias.astro`.** Replace the inline normalize/match code with `normalizeSearch`, `familyMatches` and `paginate` (behavior and URLs unchanged). On each account row add a `"Registrar pago"` link to `/admin/pagos/nuevo?adult=ID`, and a credit line (same wording as Step 1) when applicable.
- [ ] **Step 5: Verify.** `npm test`, `npm run check`. In the browser as demo `admin` at 390 px and 1280 px: search by athlete name with and without accent, by email; page through results with more than 20 demo families (seed extra users locally if needed); pick a family, register a 2-month advance, open the payment, confirm it with no months, and check the receipt page shows the advance note and the family dashboard shows credit. Run the axe check from the memory note on `/admin/pagos/nuevo`, `/portal/pagos/nuevo`, `/admin/pagos/[id]`.

---

### Task 8: End-to-end walk and wrap-up

**Files:** none new.

- [ ] **Step 1: Full suites.** `npm test`, `npm run check`, `npm run test:portal` against `http://127.0.0.1:4400` all pass.
- [ ] **Step 2: Walk on demo data.** As `parent-a`: advance 3 months → as `admin`: verify with no months → trigger `settleCredit` by calling the cron route locally with `CRON_SECRET` (or `publishMonth`) for the next month's instant → parent dashboard shows that month paid and `"Adelanto: pagado hasta …"` for the rest. Check the 320–1440 px sweep on the three changed pages in Chrome and WebKit.
- [ ] **Step 3: Report.** Summarise to the owner: what changed, every existing test assertion that was edited and why, anything that could not be verified. Do not commit.

---

## Self-review

- **Spec coverage:** A (advance register, family + admin) → Tasks 1, 4, 5, 7. B (credit settles) → Task 2. C ("Pagado hasta" and rate) → Tasks 3, 5, 7. D (admin search and Familias shortcut) → Tasks 6, 7. Non-goals respected: no migration, no email, no refund, email-inbound untouched (Task 1 test).
- **Deliberate refinement of the spec:** coverage starts at the month after the **current** month (spec said "after the latest published"), because settle only reaches the current month; identical in the normal case, more correct when an admin publishes early.
- **Type consistency:** `advanceQuote` returns `{ monthlyRateMinor } & CreditCoverage` everywhere it is used (Tasks 5, 7); `settleCredit` returns `number` (Task 2 route and tests); `parseAdvanceMonths` and `advanceSelection` both treat 0–12 as valid and `""` as 0.
- **Proportion:** The plan names decisions, signatures, copy and tests; bodies are left to the builder.
