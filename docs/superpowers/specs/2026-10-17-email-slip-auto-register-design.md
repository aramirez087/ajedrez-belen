# Emailed slips register themselves

**Date:** 17 October 2026 · **Status:** approved (allocation and required-data choices confirmed by the owner)

## Problem

A family that emails a slip to `pagos@ajedrezbelen.com` gets a reply saying the email does not register the payment, then has to log in, pick the file, review fields, pick mensualidades and submit. The email path costs more steps than uploading in the portal, even though the worker already reads amount, date and reference.

## Decision

When the worker reads the slip well enough, it registers the payment itself. Only an incomplete read sends the family to the portal, and the reply names what is missing.

A registered payment is `pending` (en revisión): no balance changes until an administrator verifies the bank entry and confirms the final allocations, exactly as for a portal submission.

## Rules

**Never auto-register** — these senders keep today's save-and-reply behavior, because a person has to choose where the file goes:
- An administrator (`ADMIN_USER_IDS` or an active staff grant), unless the transfer detail uniquely names one of their own linked athletes (then it is their own family's payment). Their other emailed files feed staff-assisted registration for other families; the reply links Registrar pago in administration.
- A family with a payment in `needs_info`. The file may be the requested correction; the reply links that payment first and the new-payment form second.

**Complete read** — all must hold:
- JPG/PNG read by Groq with status `ready`.
- `amount` and `transferDate` present after the existing parser sanitizing (it already drops uncertain/future dates and non-CRC amounts).
- No `not_transfer`, `unreadable` or `ambiguous` warning.

Payer name: read value, else the account name. Reference: read value, else empty.

**Duplicate** — the same file hash, or the same non-empty bank reference, already belongs to one of the sender's payments that is not rejected or void. Nothing new is registered; the reply links that payment. A same-hash duplicate is detected before storing, so no draft is kept. A same-reference duplicate is detected after reading and keeps the draft (it may be a different transfer with a misread reference); the reply still links the matching payment.

**Allocation** — same as «Pagar todo lo que vence»:
1. Open = family charges with balance, minus amounts already requested by the family's `pending`/`needs_info` payments.
2. Candidates = open charges whose period ≤ current Costa Rica month; if none, all open charges.
3. If the slip detail uniquely names one linked athlete (`suggestAthletes`), that athlete's candidates go first; otherwise oldest period first.
4. Fill in order up to the amount; the last line may be partial. Any remainder stays as credit.
5. No candidates → not registered (nothing due, or already covered by a payment in review).

The payment carries the note `Registrado por correo. Mensualidades elegidas automáticamente; confírmalas al verificar.` so the reviewer double-checks.

## Replies (one per message, from the receiving address)

| Outcome | Subject | Body |
| --- | --- | --- |
| registered | Registramos tu pago | Read facts, lines paid, credit if any. "No tienes que hacer nada más." Link to the payment. |
| incomplete | Falta un dato de tu comprobante | What was read, what is missing. Send a clearer photo to this address, or finish in one minute at `/portal/pagos/nuevo?correo=<draftId>` (opens with the file chosen). Expiry. |
| pdf | Envíanos una captura de tu comprobante | PDFs are not read by email; send a JPG/PNG screenshot, or finish at the same link. Expiry. |
| duplicate | Ese comprobante ya está registrado | Link to the payment. |
| nothing due / covered | Recibimos tu comprobante | Why it was not registered; link to finish later. Expiry. |
| registration failed | Termina el registro de tu comprobante | Generic: could not register it automatically; link to finish. |
| payment needs correction | Recibimos tu comprobante | Not registered; link to the payment awaiting correction, then the new-payment link. |
| administrator | Recibimos tu comprobante | Saved; register it from administration (link). |

Bounces (unknown sender, bad file, auth failure, draft budget) stay as they are.

## Portal copy

- Email help panel: two short lines — send from the account email; it registers itself and we reply; if something is missing we say what.
- Dashboard and Registrar pago notices for emailed drafts now mean "this one still needs you": copy says so and links straight to the preselected form.
- `?correo=<draftId>` preselects that saved file in step 01 (the existing change handler reuses the stored reading).

## Out of scope

No schema change, no new email provider (the worker's `message.reply` is used), no change to admin verification, no PDF reading in the worker.

## Tests

Pure allocation (ordering, athlete priority, partial, pending subtraction, future fallback). Worker: registered happy path (payment pending, draft attached, allocations, note, reply), missing date, PDF, duplicate hash, duplicate reference, nothing due, covered by pending payment, registration error fallback. Existing reply tests updated.
