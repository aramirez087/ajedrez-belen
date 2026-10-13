# Association receipts and Brevo email

The payment portal stores a numbered association receipt only after an administrator verifies the bank entry. Its issuance snapshot keeps the payer, reference, bank, receiving account, dates, total, allocation lines and designated responsible adult as immutable values. Later profile or fee edits do not rewrite an issued receipt. The renderer validates that applied amounts plus unapplied credit equal the amount received, escapes HTML, and supplies a printable HTML document and a plain-text email body.

Demo receipts have a visible demonstration notice in the document, text and subject. They are blocked from live email, including when a real administrator session has selected live mode. The earlier `/prototype` receipt and test email remain separate.

**Current state — 11 October 2026:** domain **ajedrezbelen.com** is authenticated and sender **no-reply@ajedrezbelen.com / Ajedrez Belén** verified. The owner privately installed/corrected the local API key; redacted shape/configuration checks passed, but no provider request or email was sent. There is **no Worker Brevo secret**. The deployed owner-only fictional staging mode enforces `EMAIL_MODE=dry_run`, keeps OCR off and blocks `/api/admin/email`; it needs no Brevo credential. Do not recreate completed domain/sender/key setup. Transactional eligibility, provider acceptance and inbox delivery remain unverified. See the [current Brevo readiness table](BREVO-SETUP.md#readiness-on-11-october-2026) and [completed DNS record](SETUP-HANDOFF.md#approved-domain-setup-update).

The completed hosted fictional workflow on functional version `2da871a0-da6e-482a-8e92-fab00742d1df` issued a simulated receipt, applied credit and annulled it. The original receipt email was processed only in dry-run, then cancelled; the void notice remains `dry_run`. Read-only evidence confirms **zero provider IDs and zero live-budget attempts**. Internal processing counters do not mean a provider request occurred. The final presentation-only release preserves this policy; see [versioned workflow evidence](PORTAL-VERIFICATION.md#hosted-fictional-workflow-on-functional-version-2da871a0).

## Durable email backlog

Verification writes the receipt and its email outbox rows in the same D1 transaction. Each row contains the authorized recipient at issuance and a UUID that remains the idempotency key through a safe retry. There is one row per receipt, recipient and notification kind. A receipt annulment has its own notification kind and UUID.

The 11 October user decision is **one family recipient per receipt**. For self-service family payments, the recipient is `payments.submitted_by` (which must equal the designated family account), with the email synchronized from that user's verified WorkOS identity. There is no payment-form, payer-name, student-email or OCR recipient override. Later staff corrections do not change the original submitter or redirect the email. Secondary guardians receive no new email copies, even if an older copy preference is enabled.

For a staff-assisted submission, the owner explicitly selected delivery to the family’s designated adult. The stored authorized account supplies its address, never the staff user, a student or a free-form field. Inactive accounts or missing/invalid stored email hold delivery; receipt display shows `recipient_pending` (**Destinatario por revisar**) and the verification audit records the recipient source and hold. Core missing-account and required guardian-link checks still fail closed. A safe but malformed contact email does not invalidate an otherwise valid frozen financial receipt. Historical shared-document access remains subject to its existing permissions and is not rewritten.

When contact data has been repaired after an email hold, an administrator must explicitly use **Preparar correo**. `POST /api/admin/email` with `action=prepare` and `receiptId` rechecks the stored policy recipient, queues the first receipt email and records the audit; it does not send. `Receipt.canPrepareEmail` exposes this action only for an issued receipt whose payment is verified and which has **no original receipt outbox row for any recipient**, including legacy or cancelled rows. No arbitrary recipient is accepted. An equivalent repeated action is idempotent. Ineligible contact data stays held; existing outbox entries are never retargeted, revived or replaced by this action. A void receipt cannot use it. After successful preparation, the administrator reviews the stored recipient and separately chooses **Procesar correos pendientes**. Editing an account alone never releases email automatically. **This general-portal recovery route is blocked in current owner-only hosted staging**; these semantics do not imply it is available in that mode.

After a successful bank verification, the portal immediately attempts the email rows for the newly issued receipt. A receipt annulment similarly attempts its queued cancellation notices. Email failure does not undo verified payment or receipt issuance. The administrator's **Procesar correos pendientes** action processes the backlog when setup, limits or previous failures prevent an immediate attempt. Every action attempts at most five due messages; it may also cancel additional legacy queued rows that are no longer eligible, including future-dated rows. Other eligible rows stay in D1 until another action processes them; closing the browser or restarting a Worker does not discard them. There is no background scheduler in this version.

Immediately before claiming a row, the service checks the original uploader for self-service or the designated family adult for staff-assisted payments, matching verified/void payment and receipt state, active user, unchanged stored email and active links to every athlete. The same checks protect the atomic claim and explicit retry. Previously queued secondary-guardian copies and staff-uploader copies are ineligible and cancel before sending; no stored address is retargeted. Revoked access, a changed address, or an obsolete issued-receipt notification also cancels the row. Annulment notifications follow the same explicit family-recipient policy.

Claims use a conditional D1 update and a random claim token. Concurrent actions can claim a queued row only once. For live attempts, the same transactional batch reserves capacity in a budget of **250 attempts per UTC day**, leaving room below Brevo's published 300 daily free sends. This allowance is shared by this portal; email sent elsewhere from the same Brevo account still uses the provider's allowance. Requests remain queued when the application budget is full. [Brevo free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

The administrator's outbox view shows at most **100 rows**. Unresolved `queued`, `sending`, `blocked`, `rejected` and `unknown` rows appear first, oldest first; accepted, simulated and cancelled history follows, newest first. This display cap does not discard queued work. Sending remains capped at five due messages per action and 250 live attempts per UTC day, independently of what is visible in the list.

## Safe configuration and a future live check

Current configuration is `EMAIL_MODE=dry_run`. This records `dry_run` on processed rows without making a provider request. The approved sender configuration is below; the key belongs only in a private secret store, never public variables. Hosted key installation is not part of the current fictional payment test.

```text
EMAIL_MODE=dry_run
BREVO_API_KEY=<Brevo transactional API key>
EMAIL_FROM=no-reply@ajedrezbelen.com
EMAIL_FROM_NAME=Ajedrez Belén
EMAIL_TIMEOUT_MS=10000
```

Only exact `EMAIL_MODE=live` permits provider requests. Current staging policy rejects that mode; a future controlled live check requires a reviewed policy change and the exact owner approvals in the [Brevo handoff](BREVO-SETUP.md#smallest-external-handoff). Domain/sender setup and local key entry are complete. Hosted key installation, activation and any message remain separate actions; do not perform them for the dry-run payment workflow.

**`EMAIL_TEST_RECIPIENT` has no effect on this portal.** Live approval and annulment immediately attempt the receipt's stored authorized recipients. A pending batch can send other queued receipts. For a controlled live check, use an isolated staging database with only synthetic records and explicitly approved controlled mailboxes. Do not change production payments, import a family roster or process production backlog as a test. Local demo receipts are deliberately ineligible for live sending.

The WorkOS administrator session and organization must also be configured. The service independently rejects live sending from a local demo actor or a non-administrator. There is no endpoint that accepts a freely supplied email recipient. Uploads, bank-slip files, login information and API credentials are never attached to receipt emails.

Domain authentication, exact sender verification and the local private API-key shape check are complete. No Worker Brevo credential is installed, and local shape validation does not prove provider authentication. Confirm transactional eligibility and obtain approval for the exact fictional message, controlled recipient and isolated environment before any live check. API acceptance alone cannot validate delivery. No live email has been sent. [Brevo transactional email setup](https://developers.brevo.com/docs/send-a-transactional-email)

The application sends its own HTML/plain-text content; no hosted Brevo template or marketing-contact import is required. The latest user decision uses a no-reply sender; `no-reply@ajedrezbelen.com`, display name **Ajedrez Belén**, is now created and **Verified** in Brevo, with domain DKIM and DMARC configured. This does not enable live sending in the app. No receiving mailbox or Cloudflare forwarding is needed. Both receipt formats mark the email as automated and say: “Las respuestas a este correo no se atienden. Para consultas, escribinos por WhatsApp.” They link https://wa.me/50687686102. No separate Reply-To is set and the application does not claim incoming replies are technically blocked. Provider open/click tracking is not disabled by this adapter; verify account data controls before real family data.

## Delivery states and safe retry

| State | Meaning and next action |
| --- | --- |
| `queued` | Durable, ready for a later deliberate batch action once due. |
| `sending` | Claimed by one action. A stale interrupted claim becomes `unknown` after five minutes. |
| `dry_run` | Rendered locally; no provider request. An administrator may explicitly requeue it after the short cooldown. |
| `accepted` | Brevo returned HTTP 201 and a message ID. Delivery is not yet established. |
| `blocked` | Missing/invalid configuration or invalid/demo receipt. Configuration failures can be explicitly requeued after correction. |
| `rejected` | Explicit provider refusal. HTTP 429 receives a bounded `Retry-After` backoff; authentication refusals can be retried after correction. Other request refusals remain for investigation. |
| `unknown` | Timeout/disconnection, 5xx, malformed success, duplicate-key response or interrupted claim. Inspect provider logs; the portal will not blindly retry. |
| `cancelled` | Recipient authorization or receipt state changed before sending. |
| `recipient_pending` | Receipt display only: no eligible recipient email row exists. Review the policy recipient’s stored address and permissions. When `canPrepareEmail` permits it, explicitly prepare the first email after repair, then process the batch separately. Existing email history and void receipts cannot use this preparation action; no fallback address is selected. |

There is one HTTPS request per claimed item, with a 10-second timeout by default and no automatic provider retries. Brevo's JSON `headers.idempotencyKey` uses the stored UUID. Its protection is time limited, so the persisted outbox state is the durable protection against duplicate sends. [Brevo idempotency guide](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)

An ambiguous outcome never becomes retryable because time has passed, the Worker restarted, or another batch was requested. `unknown` and accepted messages remain in their recorded state. An administrator must inspect Brevo's records before resolving an ambiguous delivery; the portal provides no blind resend action for it. Only explicit refusals or corrected configuration can be deliberately requeued through the safe retry action, after its backoff.

The initial portal has no delivery webhook. The administrator can inspect Brevo's delivery records for an accepted or ambiguous attempt; receipt download remains available in the portal regardless of email delivery. Future scheduling or authenticated delivery webhooks can use the same backlog without changing receipt issuance.

## Verification

The receipt and email tests exercise immutable snapshots, allocation totals, escaping, long references, demo/void notices, one-request provider behavior, stored recipients/UUIDs, concurrent claims, the daily budget, revoked permission, explicit retry/backoff, bounded timeout, and ambiguous outcomes. The outbox tests execute the production SQL using SQLite transactions, alongside mocked provider responses. They send no real email.

Historical baseline: the combined portal/prototype receipt-email suite passed **27/27** on 10 October; the later designated-recipient/recovery snapshot passed **158 unit tests**, a clean **99-file check** and **15 payment HTTP groups**. Current deployed-candidate evidence is maintained in [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md), including later concurrency and owner-only boundary checks. Historical snapshots do not certify later changes. Mocked tests do not establish provider deduplication or delivery; domain authentication was verified separately in Brevo and authoritative DNS.

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node --import tsx --test tests/email.test.ts tests/receipt.test.ts tests/portal-receipt.test.ts tests/portal-email.test.ts
```
