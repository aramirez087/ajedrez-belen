# Inscription approval — design

Date: 2026-10-21. Status: the owner chose "go with sensible defaults" instead of answering questions, so every open point below is my call (marked **Call**). Not committed (the owner commits).

## Why

Today a guardian who holds a registration invitation, or who is already linked to a family, can add athletes (`registerAthletes` in `src/lib/portal/domain.ts`). Each athlete is created active, linked and billed from the next monthly publish. No administrator ever looks at it. The association needs the opposite: nobody becomes a member of the team just because they filled in a form. An administrator confirms every self-registered athlete first.

Success: a parent registers an athlete, sees "En revisión", is not billed and does not count for the sibling discount. An administrator sees the request, approves or rejects it (a rejection carries a reason the parent can read), and only an approval makes the athlete a billed member.

## Goals

1. Every self-registered athlete starts **pending** and stays out of billing, sibling discounts, rates, rosters and exports until an administrator approves it.
2. Administrators have one queue ("Inscripciones") with everything needed to decide, and can approve (optionally correcting the group) or reject with a reason.
3. Parents always see where each request stands, can withdraw a pending one, and read the reason when one is rejected.
4. The database refuses an unapproved athlete that is active, even if application code is wrong.
5. Nothing already enrolled changes.

## Non-goals and anti-goals

- No email or push notification in this round. The mail outbox is tied to receipts (`email_outbox.receipt_id NOT NULL`, `kind IN ('receipt','receipt_void')`); a new message type needs its own table and templates. Administrators are told by an "Inscripciones" badge on every admin page and a line on the admin home. Parents see the status in the portal. Follow-up if wanted.
- No editing of a pending request. A typo means withdraw and register again (cheap, and keeps the audit trail honest). Administrators can correct only the group when approving.
- No approval of admin-enrolled athletes: `enrollAthlete` is the administrators' own path and stays trusted and immediate.
- Anti-goal: a pending, rejected or withdrawn athlete must never be billed, discounted, rated, exported as a member or linked to a payment by any existing code path, including ones this project does not touch.
- Anti-goal: the approval gate must not become a way to dodge the "needs an invitation" rule (see "Registration window").
- No change to money rules, ledger or receipts.

## Design

### Data

Migration `0011_athlete_approval.sql` adds to `athletes`:

- `approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected','withdrawn'))`
- `reviewed_by TEXT REFERENCES users(id)`, `reviewed_at TEXT`, `review_note TEXT`

**Call: grandfather everyone.** Existing rows take the default `approved`; nothing changes for current families.

**Call: not-approved means `active=0`.** Billing, sibling discount counting, family rates, rosters and the cron all already filter `active=1`, so a pending athlete is excluded everywhere by default, including code written later. Triggers make that a database rule:

- `athlete_unapproved_inactive_insert` / `_update`: abort `athlete_unapproved_active` when `approval_status<>'approved'` and `active=1`.
- `athlete_approval_final`: abort when `approval_status` changes away from a non-pending value (approved, rejected and withdrawn are final; only pending moves).

The domain `batch()` wrapper maps these aborts to a `PortalError` 409 like the allocation triggers.

### Registering (family)

`registerAthletes` inserts `approval_status='pending'`, `active=0`, the link as today, and the audit `self_register`. It keeps the invitation/window rules and the existing duplicate check, which now ignores rejected and withdrawn rows.

**Call: spam limits.** At most 6 pending athletes per account at a time; the existing 300-athlete cap counts only pending and approved rows.

**Registration window.** The "already linked family" route (`getRegistrationWindow`, `via: 'family'`) requires a link to an **approved** athlete. Otherwise one pending registration would open permanent self-registration with no invitation. `needsAthleteRegistration` still treats any link as having done the first step, so a family waiting for approval is not trapped in the form.

Other guards: `requireLinkedAthlete` (advance payments) needs an approved athlete; `setOwnAthleteActive` refuses to reactivate anything not approved (a parent must not be able to flip a pending athlete on); `linkGuardian` (admin) refuses a non-approved athlete; `redeemInvitation` does not link an athlete that is rejected or withdrawn.

### Reviewing (admin)

New domain functions, all admin-only and each one guarded batch (audit insert and update together, `WHERE approval_status='pending'`, zero changes means another administrator got there first and answers 409 "Esta inscripción ya fue revisada."):

- `approveRegistration(db, actor, athleteId, { category? })`: sets `approval_status='approved'`, `active=1`, `reviewed_by/at`. **Call:** `start_period = billingStartPeriod(now)` (the existing 8th rule counted from the approval date), because months published while the request waited cannot be charged retroactively by the cron. If `category` differs from the requested one, the fee is taken from the fee schedule and the audit records both values. Audit `approve_registration`.
- `rejectRegistration(db, actor, athleteId, reason)`: reason required, trimmed, 3–300 characters; sets `rejected`, keeps `active=0`, stores `review_note`. Audit `reject_registration`.
- `listPendingRegistrations(db)`: pending athletes oldest first with birth date, age, group and fee, school, cédula, who registered (name, email, how many approved athletes that account already has, so the administrator sees the sibling discount that will apply), and **possible duplicates**: other pending or approved athletes with the same cédula, or the same name and birth date. A duplicate is shown, never blocking (**Call**).
- `countPendingRegistrations(db)`: for the badge.

**Call:** an administrator may approve their own family's request (the association is small); the audit row records who did.

### Family actions

- `withdrawRegistration(db, actor, athleteId)`: the person linked to a pending athlete sets `withdrawn` and their link inactive. Audit `withdraw_registration`.
- `dismissRejection(db, actor, athleteId)`: sets the actor's own link inactive for a rejected athlete (it disappears from their list). Audit `dismiss_rejection`.

### Where it shows

Family (`/portal/inscribir` "Mis atletas", `/portal`, `/portal/pagos/nuevo`):

- Success notice after registering: "Recibimos la inscripción. La Asociación la revisa antes de cobrar mensualidades; aquí verás el resultado."
- Pending card: status "En revisión", one sentence, "Retirar solicitud". A WhatsApp button to the association with a prefilled message is the optional nudge (the number is already used on the page).
- Rejected card: "No aprobada" plus the reason, "Entendido" (dismiss) and a link back to the form.
- Home: a family with no approved athlete sees "Tu inscripción está en revisión" as the one next step and no payment prompts; mixed families see a short line.
- Payment page: "no athletes" copy becomes "Tu inscripción aún no está aprobada" when requests are pending.

Admin:

- New page `/admin/inscripciones`: one card per request, newest-first sections kept simple (oldest first, so nothing waits), group select preselected, "Aprobar", and a rejection reason field with "Rechazar". Empty state "No hay inscripciones por revisar."
- "Inscripciones" in the admin navigation (phones: inside "Más") with a count badge when above zero; the admin home next-step card mentions pending requests.
- Familias: "Atletas inscritos" and account cards list approved athletes only; pending ones live in the queue.

## Constraints

- Presentation and domain changes are approved for this feature (the owner asked for it). Keep existing invariants: financial tables untouched; audit for every state change; single D1 batches.
- Local demo data only. Do not commit, push or deploy. The migration must apply on D1 and in the SQLite test adapter.
- Mobile first, short Spanish copy, one next action on top, existing `portal-*` classes.
- Workers budget: queue and badge are single bounded queries (at most 300 athletes).

## Left to the builder

- Exact markup and class names; wording within the copy above; the query shape for duplicates (one self-join is enough at this size).
- Test design: real SQLite with triggers, following `tests/portal-advance-payments.test.ts`.

## Verification

`npm test`, `npm run check`, `test:portal` against `http://127.0.0.1:4400`, the 320–1440 px sweep and axe. Walk the flows on demo data in a browser: parent registers (pending, no charge after publish), admin approves (billed from the right month, sibling discount appears), admin rejects (parent reads the reason), parent withdraws, a stale second approval answers 409.

## Deferred (not in this round)

Email or WhatsApp notification to administrators and parents; editing a pending request; bulk approval; a rejected-then-resubmit shortcut; an admin screen for rejected history.
