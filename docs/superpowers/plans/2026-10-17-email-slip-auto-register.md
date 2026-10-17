# Emailed Slips Register Themselves — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family that emails a readable slip to pagos@ gets a registered (pending) payment and a "nothing else to do" reply; only incomplete reads ask for a manual step, naming what is missing.

**Architecture:** A new pure-plus-D1 module `src/lib/portal/email-payment.ts` decides allocations and calls the existing `submitPayment` + `attachSlipDraft`. The email worker calls it after the existing Groq read and picks one of several reply copies. Portal copy shrinks and a `?correo=<draftId>` link preselects the saved file.

**Tech Stack:** Cloudflare Email Worker (postal-mime), D1, R2, Astro 7, node:test with node:sqlite D1 shim.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-email-slip-auto-register-design.md`.
- No schema migration. `email_inbound.status` stays within `draft_created|duplicate|rejected`.
- Registered payments are `pending`; admin verification is unchanged.
- Administrators and families with a `needs_info` payment never auto-register.
- Spanish copy, tú form, one or two short sentences per block.
- Do not commit (owner's standing rule). Verify with `npm test` and `npm run check`.

---

### Task 1: Allocation and registration module

**Files:**
- Create: `src/lib/portal/email-payment.ts`
- Test: `tests/portal-email-payment.test.ts`

**Interfaces — Produces:**
- `EMAIL_PAYMENT_NOTE: string`
- `readAmountMinor(amount: string | null | undefined): number | null`
- `chooseEmailAllocations(charges: readonly Charge[], requested: ReadonlyMap<string, number>, amountMinor: number, description: string | null, currentPeriod: string): EmailAllocation[]`
- `findRegisteredPayment(db, userId, { sha256 } | { reference }): Promise<string | null>`
- `findPaymentAwaitingCorrection(db, userId): Promise<string | null>`
- `registerEmailedSlip(db, actor, draft: { id: string; file: SlipMetadata }, reading: OcrSuggestions | null, now?: Date): Promise<EmailPaymentResult>`
- `EmailAllocation = { chargeId; amountMinor; athleteName; period }`
- `EmailPaymentResult = registered{paymentId, amountMinor, allocations, creditMinor} | incomplete{missing: ("amount"|"date")[]} | unsure | duplicate{paymentId} | nothing_due | covered`

- [ ] Step 1: Write pure tests for `chooseEmailAllocations`: oldest period first; partial last line; amount above due leaves the rest unallocated (credit) and never spills into future months when something is due; nothing due → all open charges (advance); requested-in-review amounts are subtracted and fully covered charges skipped; unique athlete in description goes first; ambiguous description keeps period order; all covered → `[]`. Tests for `readAmountMinor`: `"12000.00"` → `1200000`, `"0.00"`/`"12,000"`/`null` → `null`.
- [ ] Step 2: Run `node --import tsx --test tests/portal-email-payment.test.ts` → FAIL (module missing).
- [ ] Step 3: Implement the module (`suggestAthletes` for athlete priority, `billingPeriod(now)` for the current month, `listParentCharges` for balances, `payment_requested_allocations` joined to `pending|needs_info` payments for in-review amounts).
- [ ] Step 4: Re-run → PASS.

### Task 2: Worker uses the module and new replies

**Files:**
- Modify: `workers/email-inbound/src/index.ts`
- Modify: `tests/email-inbound.test.ts`

**Interfaces — Consumes:** everything from Task 1.
**Produces:** `slipReplyCopy(reply: SlipReply)` replacing `slipReceiptCopy`.

Flow after authentication and `pickSlip`:
1. Non-staff sender and `findRegisteredPayment({sha256})` hit → record `duplicate`, reply duplicate, store nothing.
2. Save draft (unchanged), read with Groq (now returns raw `OcrSuggestions | null`).
3. Staff → `staff` reply (link `/admin/pagos/nuevo?correo=<id>`).
4. `findPaymentAwaitingCorrection` → `correction` reply.
5. PDF → `pdf` reply.
6. `registerEmailedSlip` → map result; a thrown error → `unsure` reply (logged code).

- [ ] Step 1: Add migrations `0004`, `0006` to the test shim; add `addCharge` helper and an alternate PNG (same magic bytes, different hash).
- [ ] Step 2: New tests: registered happy path (pending payment, allocations oldest-first, note, draft `attached`, reply subject `Registramos tu pago`, link to `/portal/pagos/<id>`); date missing → no payment, `Falta un dato`, `?correo=<draftId>`; same file again → `Ese comprobante ya está registrado`, one draft, inbound `duplicate`; same reference on another image → duplicate reply, no second payment; `not_transfer` warning → `Termina el registro`; `needs_info` payment → correction reply linking it; nothing due → `estás al día`.
- [ ] Step 3: Update existing reply assertions (`no registra el pago`, `Guardamos el PDF`, `Disponible en tu cuenta`) to the new copy.
- [ ] Step 4: Run `node --import tsx --test tests/email-inbound.test.ts` → FAIL, implement, → PASS.

### Task 3: Portal copy and preselect link

**Files:**
- Modify: `src/components/portal/SlipUploader.astro` (preselect `?correo=` after the saved-select listener)
- Modify: `src/components/portal/EmailSlipHelp.astro` (two short lines)
- Modify: `src/pages/portal/pagos/nuevo.astro` (draft banner = "falta completar", button links `?correo=`)
- Modify: `src/pages/portal/index.astro` (same notice wording, button links `?correo=`)
- Modify: `src/pages/portal/pagos/[id].astro` (correction help no longer says the email never registers)

- [ ] Step 1: Edit copy and script.
- [ ] Step 2: `npm run check` → 0 errors; `npm test` → PASS.

### Task 4: Docs

**Files:** `docs/PORTAL-EMAIL.md` (inbound section), `docs/PAYSLIP-OCR.md` (allocation sentence).

- [ ] Step 1: Replace "Emailing never registers a payment by itself" paragraph with the new rules; note the exception in PAYSLIP-OCR.
- [ ] Step 2: Final `npm test` + `npm run check`.
