# Families can discard an emailed file

**Date:** 17 October 2026 · **Status:** approved by the owner (scope A + B)

## Problem

A family that emails a slip to `pagos@ajedrezbelen.com` may end up with a saved file that cannot become a payment: the read was incomplete, no month is owed, or it was a test. Today the family cannot remove it.

- The file stays until it expires (7 days) and then only disappears when a cleanup runs.
- Each account may hold five open drafts (`draft_upload_budget` trigger on `slip_drafts`). The trigger counts `state IN ('draft','deleting')` with no expiry condition, so an expired file still counts until it is cleaned.
- Web uploads run `cleanupOwnExpiredDrafts` before saving; the email worker does not, and nothing is scheduled. Five emailed files therefore block the sixth email indefinitely, until an administrator presses "Limpiar" or the family uploads through the web form.
- The bounce text says "regístralos", which is impossible when no month is owed.

## Decision

**A. Descartar.** A family can discard any one of its own emailed files that is still a draft. The file is deleted from storage and its slot is freed at once.

**B. Expiry frees slots.** The email worker removes the sender's expired drafts before saving a new one, as the web upload already does. The bounce text offers discarding.

Out of scope: discard-all, administrators discarding for a family, a scheduled cleanup, an audit event (the `slip_drafts` row stays with `state='deleted'`, and its `email_inbound` row stays too), any schema change.

## Rules for discarding

`discardEmailDraft(db, actor, bucket, draftId)` in `src/lib/portal/ocr.ts`, beside the cleanup helpers:

1. `assertCanUploadSlip` (active account; guardian link unless administrator), like every draft function.
2. The draft must be the actor's own, `state='draft'`, and have an `email_inbound` row. Anything else is `draft_not_found` (404), so a foreign or unknown id is indistinguishable.
3. Claim: `UPDATE slip_drafts SET state='deleting', cleanup_token=?` guarded by owner, `state='draft'`, no `payment_files` row for the key, and no `slip_extractions` row `status='sending'` with a live claim. No row changed: if the draft is still a live draft the cause is a read in flight (`draft_busy`, 409), otherwise `draft_not_found`.
4. `bucket.delete(key)`, then `UPDATE ... SET state='deleted' WHERE cleanup_token=? AND state='deleting'` guarded again by "no payment file for the key".
5. If the storage delete (or the final update) fails, put the row back: `state='draft', cleanup_token=NULL WHERE cleanup_token=?`, and throw `draft_discard_failed` (503). No row is left in `deleting`.

An expired draft may be discarded too (it is still `state='draft'` until cleaned).

## Endpoint

`POST /api/portal/slips/[id]/discard` through `portalMutation` (`back: '/portal'`): signed-in actor, same-origin check, no body. Success: `successRedirect('/portal', 'draft_discarded')`. Errors redirect to `/portal?error=<code>`.

The existing `draft_not_found` and `ocr_busy` messages are written for the payment form ("vuelve a adjuntarlo"), so the dashboard gets its own wording:

- `draft_discarded` (notice): "Comprobante descartado."
- `draft_gone` (notice): "Ese comprobante ya no estaba en la lista." The route turns a `draft_not_found` into this redirect, so a double click, a second tab or a stale row (the file was attached to a payment meanwhile) tells the truth without an error.
- `draft_busy` (error, 409): "Se está leyendo ese archivo. Espera unos segundos y vuelve a intentarlo."
- `draft_discard_failed` (error, 503): "No pudimos descartarlo ahora. Inténtalo otra vez; si se repite, escríbenos por WhatsApp."

Each error code is added to `errorCodes` in `http.ts` and to `Notice.astro` (a test enforces that every code has a message).

## Interface

On the dashboard panel for emailed files (every state), each file row gets a quiet "Descartar" button in its own POST form with `data-confirm`:

> ¿Descartar este comprobante? Se borra el archivo. Si ya transferiste, tendrás que enviarlo otra vez para registrar el pago.

The single-file "Terminarlo ahora" variant gets the same quiet action beneath the button. After success the dashboard shows "Comprobante descartado." and the row is gone.

## Email worker

In `handleEmail`, after the sender is confirmed and before the `slip_drafts` insert, call `cleanupOwnExpiredDrafts(env.DB, actor, env.SLIPS)` for that sender (the same function `saveSlipDraft` uses). A failure there must not stop the email: it is swallowed and the insert proceeds (and may still hit the cap, which bounces as today).

Bounce text on `draft_limit`: "Ya tienes varios comprobantes guardados sin registrar. Entra a tu cuenta en el portal, regístralos o descártalos, y vuelve a enviar este archivo."

The worker is deployed on its own (`workers/email-inbound`): part B takes effect only after that deploy.

## Tests

Real SQLite with the migrations, as in `tests/portal-ocr.test.ts`; storage is a fake bucket.

- discarding frees a slot: with five drafts a sixth insert is refused, after one discard it succeeds;
- the object is deleted and the row ends `deleted`; the `email_inbound` row remains;
- another family's draft, a non-email draft and an unknown id give `draft_not_found`;
- a draft attached to a payment is refused and its file is untouched;
- a second discard of the same file is `draft_not_found`;
- a failing `bucket.delete` restores `state='draft'`, keeps the file and the slot count, and throws `draft_discard_failed`;
- a read in flight gives `draft_busy` and changes nothing;
- worker: five expired drafts no longer block a new email; five live drafts still bounce, with the new text.

Verification: `npm test`, `npm run check`, `npm run test:portal`, a visual pass of the dashboard in all three states with seeded demo drafts (removed afterwards), and an axe scan.
