# Inscription Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner chose Native execution for the previous plan; same here). Steps use checkbox syntax.

**Goal:** Self-registered athletes start pending and are billed only after an administrator approves them.

**Architecture:** `athletes.approval_status` plus `active=0` while not approved (every existing `active=1` filter keeps them out of billing, discounts and rates), enforced by DB triggers. New domain functions approve, reject, withdraw and dismiss with guarded batches. An admin queue page and a family status view sit on top.

**Tech Stack:** Astro SSR on Cloudflare Workers, D1 (SQLite), `node:test` with the real-SQLite `SQLiteD1` adapter.

**Spec:** `docs/superpowers/specs/2026-10-21-inscription-approval-design.md`

## Global Constraints

- Do not commit, push or deploy (the owner commits). Local demo data only.
- Spanish UI copy, short, mobile first, existing `portal-*` classes; match the surrounding comment density and naming.
- Financial tables, receipts and the ledger are untouched. Every state change writes an audit row. Writes are single `batch()` calls.
- `athletes.active` stays the only flag billing reads; a non-approved athlete is always `active=0`.
- New migration is `migrations/0011_athlete_approval.sql`. Every test harness that applies migrations by hand must load it (several list migrations explicitly).
- `getParentDashboard().athletes` keeps meaning "approved members" so existing pages stay correct; pending and rejected requests are a separate `registrations` list.

## Review Focus

- Pending athlete linked to a second parent (co-guardian invitation at registration): both parents see the same state; a rejected or withdrawn athlete is not linked by a later redemption.
- Two administrators approving or rejecting the same request: one wins, the other gets 409 and no second audit row.
- Approval on the 8th/9th and on the last day of a month in Costa Rica time: `start_period` follows `billingStartPeriod(now)`.
- A family whose only athlete is pending or rejected must not gain the "already linked family" registration window, advance payments, reactivation or admin linking.
- Re-registering the same child is blocked while pending/approved and allowed after reject or withdraw; the 7th pending registration of one account is refused.
- Code deployed before the migration would reference a missing column: the operations doc says to apply 0011 first.

---

### Task 1: Schema and the database rule

**Files:**
- Create: `migrations/0011_athlete_approval.sql`, `tests/portal-inscription-approval.test.ts`
- Modify: `src/lib/portal/types.ts` (add `export type AthleteApproval = "pending" | "approved" | "rejected" | "withdrawn";`), `src/lib/portal/domain.ts` (`batch()` regex gains `athlete_unapproved|athlete_approval_final`), every `tests/*.test.ts` harness that loads migrations by hand (add `0011_athlete_approval.sql`)

**Interfaces:**
- Produces: columns `athletes.approval_status` (default `'approved'`), `reviewed_by`, `reviewed_at`, `review_note`; triggers `athlete_unapproved_inactive_insert`, `athlete_unapproved_inactive_update` (abort message `athlete_unapproved_active`), `athlete_approval_final` (abort message `athlete_approval_final`); the new test file's `SQLiteD1` adapter (copy of the one in `tests/portal-advance-payments.test.ts`, loading 0002, 0004, 0006, 0007, 0011) and fixtures `admin`, `parentA` (`Actor`s) used by later tasks.

- [ ] **Step 1: Failing schema tests** in the new file, direct SQL against the adapter: an `INSERT` without the new columns gets `approval_status='approved'` (grandfathering); inserting `approval_status='pending'` with `active=1` throws `athlete_unapproved_active`; `UPDATE ... SET active=1` on a pending row throws; `pending→approved` with `active=1` in one `UPDATE` succeeds; `approved→pending`, `rejected→approved`, `withdrawn→pending` throw `athlete_approval_final`; `pending→rejected` and `pending→withdrawn` succeed; `UPDATE athletes SET fee_minor=...` on a rejected row (what `updateFeeSchedule` does) does not throw.
- [ ] **Step 2: Run** `node --import tsx --test tests/portal-inscription-approval.test.ts`. Expected: FAIL (no such column).
- [ ] **Step 3: Write the migration.** `ALTER TABLE athletes ADD COLUMN` for the four columns (status with the CHECK and `NOT NULL DEFAULT 'approved'`); the three triggers (`BEFORE INSERT`, `BEFORE UPDATE OF active, approval_status` with `WHEN NEW.approval_status<>'approved' AND NEW.active=1`, and `BEFORE UPDATE OF approval_status` with `WHEN NEW.approval_status<>OLD.approval_status AND OLD.approval_status<>'pending'`), each `SELECT RAISE(ABORT,'<message>')`. Add the type and the `batch()` regex alternatives. Add the migration to every hand-listed harness.
- [ ] **Step 4: Run** the new test, then `npm test`. Expected: all pass (full suite green before moving on).

### Task 2: Registering creates a pending request; every other path stays closed

**Files:**
- Modify: `src/lib/portal/domain.ts`, `src/lib/portal/types.ts`
- Test: `tests/portal-inscription-approval.test.ts`

**Interfaces:**
- Consumes: Task 1 fixtures and columns.
- Produces: `registerAthletes` (signature unchanged) inserts `approval_status='pending'`, `active=0`; `interface Registration { id: string; name: string; category: string; feeMinor: number; status: "pending" | "rejected"; reviewNote: string | null; registeredAt: string }`; `ParentDashboard.registrations: Registration[]` (links with `active=1`, status pending or rejected, newest first); `getParentDashboard().athletes` returns only approved athletes; `listFamilies` and `getAdminDashboard().athletes` return approved athletes only.

- [ ] **Step 1: Failing tests** (names are the assertions): `registerAthletes stores a pending inactive athlete linked to the guardian with a self_register audit`; `a pending athlete is absent from the monthly preview and publish creates no charge for it`; `a pending sibling does not give an approved sibling the sibling discount`; `the seventh pending request of one account is refused with 409 and the first six are kept`; `a family linked only to a pending athlete has no registration window, while one linked to an approved athlete has via family, and an open registration invitation still gives via invitation`; `advance payment needs an approved linked athlete (403 for a pending-only account)`; `setOwnAthleteActive refuses to activate a pending athlete (409) and the athlete stays inactive`; `linkGuardian refuses a pending athlete`; `listFamilies and getAdminDashboard exclude pending athletes while getParentDashboard lists them under registrations only`; `redeemInvitation links approved and pending athletes but skips rejected and withdrawn ones` (set the status with direct SQL); `the total athlete limit counts pending and approved rows only`.
- [ ] **Step 2: Run** the file. Expected: FAIL on each new test.
- [ ] **Step 3: Implement** in `domain.ts`: `registerAthletes` inserts the new status and `active=0`; pending-per-account count (`guardian_links` join, `approval_status='pending'`, `active=1`, plus the new rows `> 6` → `fail(..., 409, "limit")` with a Spanish message that says how many are waiting); the 300 cap query and the per-account duplicate query filter `approval_status IN ('pending','approved')`; `getRegistrationWindow` family branch joins `athletes` with `approval_status='approved'`; `requireLinkedAthlete` joins approved athletes; `setOwnAthleteActive` loads `approval_status` and fails 409 "Esta inscripción aún no está aprobada." when not approved; `linkGuardian` fails 409 for a non-approved athlete; `redeemInvitation` insert statements gain `AND EXISTS(SELECT 1 FROM athletes WHERE id=? AND approval_status IN ('pending','approved'))`; `getParentDashboard` filters athletes to approved and runs one extra query for `registrations`; `listFamilies` link query and the admin dashboard athlete query filter approved. `needsAthleteRegistration` is intentionally unchanged.
- [ ] **Step 4: Run** the file, then `npm test` and `npm run check`. Expected: green; fix any older test that assumed immediate activation (they must assert the new pending behavior instead; record each in the ledger).

### Task 3: Review actions and the queue

**Files:**
- Modify: `src/lib/portal/domain.ts`, `src/lib/portal/types.ts`, `src/lib/portal/http.ts`
- Test: `tests/portal-inscription-approval.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces (all in `domain.ts`): `approveRegistration(db, actor, athleteId: string, input?: { category?: string }): Promise<void>`; `rejectRegistration(db, actor, athleteId: string, reason: string): Promise<void>`; `withdrawRegistration(db, actor, athleteId: string): Promise<void>`; `dismissRejection(db, actor, athleteId: string): Promise<void>`; `listPendingRegistrations(db): Promise<PendingRegistration[]>`; `countPendingRegistrations(db): Promise<number>`; `interface PendingRegistration { id; name; category; feeMinor; birthDate: string | null; age: number | null; school: string | null; nationalId: string | null; registeredAt: string; guardian: { id: string; name: string; email: string; approvedAthletes: number }; duplicates: Array<{ id: string; name: string; status: AthleteApproval; reason: "cedula" | "name_birth" }> }`. In `http.ts`: `parseRegistrationReview(form: FormData): { action: "approve"; category?: string } | { action: "reject"; reason: string }` (throws `InputError('invalid_fields')` otherwise).

- [ ] **Step 1: Failing tests:** approve sets `approved`, `active=1`, `reviewed_by/at`, `start_period = billingStartPeriod(now)` and writes one `approve_registration` audit; an approved athlete then appears in the monthly preview and a sibling approved later gets the 25 % discount; approving with another `category` takes that group's fee from the fee schedule and the audit records requested and approved groups; a second approval of the same athlete throws `PortalError` 409 and writes no extra audit; two approvals racing through `beforeBatch` leave exactly one audit row; reject needs a reason of 3 to 300 characters after trimming, keeps `active=0`, stores the note, and the family's `registrations` entry shows status `rejected` with the reason; withdraw works only for the linked guardian of a pending athlete (other accounts 404, approved athletes 409), deactivates that guardian's link; dismiss hides a rejected athlete from `registrations` for that guardian only; non-administrators get 403 on approve, reject and the queue; an administrator can approve a request from their own family; `listPendingRegistrations` returns oldest first with `duplicates` for the same cédula and for the same name and birth date (approved or pending others only) and `guardian.approvedAthletes`; the same child can be registered again after reject or withdraw and not while pending; `parseRegistrationReview` accepts approve (with and without category) and reject with reason and rejects everything else.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.** Approve and reject follow `setAthleteFee`: first an audit `INSERT ... SELECT ... FROM athletes WHERE id=? AND approval_status='pending'`, then the guarded `UPDATE ... WHERE id=? AND approval_status='pending'`; zero changes on the update → 409 `conflict` "Esta inscripción ya fue revisada." Validate the category against `ATHLETE_CATEGORIES` and read the fee from `getFeeSchedule(db)`. `listPendingRegistrations` is three bounded queries (pending athletes with guardian, per-guardian approved counts, one self-join for duplicates), assembled in code.
- [ ] **Step 4: Run** the file, then `npm test` and `npm run check`. Expected: green.

### Task 4: Administrator surfaces

**Files:**
- Create: `src/pages/admin/inscripciones.astro`, `src/pages/api/admin/athletes/[id]/review.ts`
- Modify: `src/layouts/PortalLayout.astro` (nav entry "Inscripciones" with count badge for admins, inside "Más" on phones), `src/pages/admin/index.astro` (one line in the next-step card when requests wait), `src/components/portal/Notice.astro` (`registration_approved`, `registration_rejected`), `src/styles/portal-ux.css`
- Test: `tests/portal-inscription-approval.test.ts` (route source/markup assertions in the repo's existing style, see `tests/portal-family-form-ux.test.ts`)

**Interfaces:**
- Consumes: Task 3 functions and `parseRegistrationReview`.
- Produces: `POST /api/admin/athletes/{id}/review` (form fields `action`, optional `category`, `reason`) redirecting to `/admin/inscripciones` with the notices above; the badge count comes from `countPendingRegistrations` wrapped in `.catch(() => 0)` so a failure never breaks a page.

- [ ] **Step 1: Failing tests:** the review route calls `parseRegistrationReview` and the matching domain function through `portalMutation`; the layout and admin home call `countPendingRegistrations(...).catch(`; the page uses `listPendingRegistrations` with a `.catch` guard and renders duplicates warnings, the group select and a reason field.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the route (follow `src/pages/api/admin/athletes/[id].ts`), the page (one card per request: athlete name, age, group and monthly fee, school, cédula, registered date, parent name and email, family context such as "Ya tiene 1 atleta: se aplica descuento de hermanos", duplicate warnings; group select preselected; approve button; reason textarea with reject button; empty state "No hay inscripciones por revisar."), the nav badge and the admin-home line.
- [ ] **Step 4: Run** tests, `npm run check`; open the page on the local server as the demo admin at 390 and 1280 px.

### Task 5: Family surfaces

**Files:**
- Modify: `src/pages/portal/inscribir.astro`, `src/pages/portal/index.astro`, `src/pages/portal/pagos/nuevo.astro`, `src/pages/api/portal/athletes/[id].ts` (actions `withdraw`, `dismiss`), `src/components/portal/Notice.astro` (`athletes_registered` copy; `registration_withdrawn`, `registration_dismissed`), `src/styles/portal-ux.css`
- Test: `tests/portal-inscription-approval.test.ts`

**Interfaces:**
- Consumes: `ParentDashboard.registrations`, `withdrawRegistration`, `dismissRejection`.
- Produces: the pending and rejected cards and the next-step wording from the design.

- [ ] **Step 1: Failing tests:** the portal athlete route dispatches `withdraw` and `dismiss`; `athletes_registered` notice mentions the review; `inscribir.astro`, `index.astro` and `pagos/nuevo.astro` read `registrations` and a family with only pending requests is not shown payment prompts (source assertions as in earlier tasks).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `inscribir.astro`: pending cards ("En revisión", the one sentence, "Retirar solicitud" with `data-confirm`), rejected cards (reason, "Entendido", link to the form), the "Compartir acceso" list stays approved-only; the new-account `mustRegister` rule keeps using approved athletes **and** registrations so a waiting family is not sent back to the form. `index.astro`: a family with no approved athlete and a pending request gets "Tu inscripción está en revisión" as the next step and no payment prompts; mixed families get one line. `pagos/nuevo.astro`: the "no athletes" panel says the inscription is not approved yet when requests are pending.
- [ ] **Step 4: Run** tests and `npm run check`.

### Task 6: Docs, walkthrough and full verification

**Files:**
- Modify: `docs/PORTAL-OPERATIONS.md` (approval flow, "apply migration 0011 before deploying", where admins find requests, what parents see, no email yet)

- [ ] **Step 1:** Update the docs paragraph.
- [ ] **Step 2:** Apply the migration to the local demo database (`npm run db:local`), then walk in a browser on demo data: parent registers (pending, publish makes no charge), admin approves (billed from the right month), admin rejects (parent reads the reason), parent withdraws, a stale second approval answers 409; Chrome at 390 and 1440 px plus WebKit and Firefox; axe on the new page.
- [ ] **Step 3:** `npm test`, `npm run check`, `npm run test:portal`, the 320–1440 px sweep. Expected: all clean.
