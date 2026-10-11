# Payment portal operations

This is the local MVP. Production accounts, real login/MFA, real Groq reading, mail delivery, cloud performance and a backup restoration have not yet been verified. Keep deployed `PORTAL_ENABLED=false` and `OCR_MODE=off` until their setup and launch checks pass. Use only fictitious family records in the local demo; its reading action returns a fixed example without analyzing the selected file or calling Groq.

## Monthly administration

1. Enroll athletes with the confirmed ₡12,000 or ₡15,000 rate and a start month. Enter a manual discount and its reason when applicable. Changing a rate or discount affects future published months; an adjustment changes an existing charge without rewriting its original values.
2. Invite each responsible adult separately to the athlete records they may access. Invitations expire, are bound to the signed-in verified email, and grant only the selected athletes. A second adult can share a child's balance without access to another adult's bank evidence. New receipt emails have one policy recipient: the original family uploader, or the designated family adult for a staff-assisted payment. An older shared-receipt consent permits historical document access only; it never adds new email copies.
3. Preview and publish the month in **Mensualidades**. Charges are due on the eighth. Repeating publication is safe. The MVP has no monthly publication scheduler, automatic reminders or late fees.
4. Review uploaded evidence against the actual receiving bank account. Pending uploads do not reduce balances. Confirm the bank reference, amount, date and destination independently, then choose the amounts applied to each month. A reason is required when reconciled values differ from the submission.
5. Request corrections or reject with a readable reason. A correction keeps prior evidence and fields. For an approved transfer, use an audited annulment and a replacement payment where appropriate; never edit the issued receipt.

One transfer may cover several athletes/months. Several transfers may pay one charge. An excess amount remains visible as credit assigned to the designated adult; an administrator can apply it to that adult's linked athletes later. The original receipt stays frozen at issuance, including its original credit amount. The current payment detail shows subsequent applications.

Review/correction forms carry the displayed payment revision and state. If either changes, reload and inspect the current evidence before making a decision. Charge adjustments and credit applications carry a durable operation UUID: retrying that same request is a no-op after success; reusing it with changed data is a conflict. A newly loaded form starts a new deliberate operation. Preserve `financial_operations` along with the ledger during backups/restores; these records prevent delayed duplicate writes. Migration `0004_financial_operations.sql` is required.

An administrator recording for a family must select its responsible adult and provide an audit reason. Sharing the uploaded bank evidence with that adult is explicit. The recording staff member and payment's responsible adult remain separate. For an assisted payment, the selected family adult’s verified stored account supplies the receipt recipient; no student address, arbitrary email field or staff fallback is used.

## Receipt and email

Approval atomically records the allocation, immutable `AB-YYYY-NNNNNN` association receipt and eligible recipient rows. Email failure never reverses an approved payment. A void preserves the number and original data, marks the receipt as annulled, releases its allocations, and queues a separate notice. This is an association receipt, not Hacienda electronic invoicing.

The receipt opens in the authenticated portal and supports printing/Save as PDF. There is no PDF attachment generator in this version. An additional adult linked to only one child in a sibling payment can see that child's balance, but cannot open the full sibling receipt.

### Recovering a held first email

When a valid financial receipt was issued without an eligible email recipient, the document remains available and its email state is **Destinatario por revisar** (`recipient_pending`). Review and repair the policy recipient’s stored contact details, verified identity, active account and required family access. Core ownership corruption, such as a missing designated account, must be investigated rather than bypassed.

Account repair alone does not queue or send email. Administration must explicitly choose **Preparar correo** in **Comprobantes**. `Receipt.canPrepareEmail` shows the action only for an issued receipt whose payment is verified and which has no original receipt outbox row for any recipient, including legacy/cancelled rows. The request is `POST /api/admin/email` with `action=prepare` and `receiptId`; it takes no email address. It rechecks eligibility, queues the first email and records an audit entry without contacting Brevo. Repeated equivalent actions cannot duplicate the row. Review the queued recipient and then use **Procesar correos pendientes** separately.

An existing email row is never retargeted, revived or replaced by this recovery action. Legacy/cancelled history and void receipts have no first-email preparation button; preserve their records and investigate their state. The receipt remains available in the authenticated portal. Accepted or ambiguous provider results still require the investigation described below, not a new send.

Default `EMAIL_MODE=dry_run` sends nothing. Live approval attempts only its receipt's recipients; the pending-email button attempts at most five due messages per action; it may also cancel more legacy rows that no longer satisfy the recipient policy. The application reserves at most 250 live attempts per UTC day. There is no background mail scheduler or delivery webhook. See [email states, setup and retry rules](PORTAL-EMAIL.md). Brevo acceptance means accepted for delivery, not confirmed inbox delivery. Inspect provider records for ambiguous results; the app does not blindly resend them.

Current external setup: `ajedrezbelen.com` is **Authenticated** in Brevo after approved domain creation and three exact Cloudflare DNS additions. Authoritative DNS verification passed; existing DMARC `p=quarantine` and root/www HTTPS 200 were preserved. The separately approved sender **no-reply@ajedrezbelen.com / Ajedrez Belén** is now created and **Verified**, with DKIM `ajedrezbelen.com` and DMARC configured. Optional branding was skipped, with no new DNS changes. No API key was created or read, and no email sent. Private owner key creation/installation is next; dry-run continues. Replies are unattended; questions go to the official WhatsApp, https://wa.me/50687686102. No receiving mailbox or forwarding is required. See [the current handoff](SETUP-HANDOFF.md).

## Evidence and reading

Original files and all submitted revisions remain private and unchanged. JPG/PNG previews enlarge in the review page; PDFs offer a first-page browser preview and full-original download. Local browser evidence and its remaining limits are recorded in [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md). A first-page image is only a viewing/reading aid, so review the complete PDF when needed. Extracted suggestions are separate from the family's declared values and the actual bank-confirmed fields. Never use an extracted amount or reference as evidence that money arrived. Requested corrections remain editable and the independent-bank checkbox is still required.

`OCR_MODE=off` keeps manual submission available; `demo` is fictitious and local only; `groq` requires an authenticated WorkOS account, a server key and the explicit external-reading action. Quota exhaustion, an unreadable file or provider failure does not block the manual form. See [reading configuration and budgets](PAYSLIP-OCR.md). Keep the key out of exports and chat, and do not upload real slips to an unconfigured provider account while testing.

Drafts expire after one hour. In `/admin/comprobantes`, **Limpiar borradores vencidos** checks up to 20 expired drafts per action after an additional hour of grace. It removes only unreferenced temporary objects; financial evidence and previous revisions are protected, including records whose draft-attachment follow-up was interrupted. There is no background cleanup scheduler. Check temporary-storage usage during the pilot; this cleanup is not a financial-record retention policy.

## Exports and history

Administrative CSV/JSON exports contain the complete database history for charges, payments, receipts, audit events and email outbox. UI tables have labelled display limits and prioritize actionable work; dashboard totals are computed across the ledger, independently of those limits. Exports require an active administrator session and contain personal information, so keep them in restricted association storage.

Money columns ending in `_minor` contain integer cents: divide by 100 for CRC amounts. CSV protects text against spreadsheet formulas and forces long bank references to text with an apostrophe marker. JSON retains the original exact strings without spreadsheet markers. Neither export should turn bank references into numeric values.

Server limits are 3 MB per upload, 10 open submissions per responsible adult, 20 submissions per recording user per UTC day, 300 athlete records, and 5 GB of retained evidence metadata. These are application safeguards, not a provider-wide billing cap. Retained evidence includes revisions. The MVP does not silently remove old financial records to stay within free allowances.

## Backup and restoration before launch

Assign association owners for the domain, WorkOS, Cloudflare, Brevo and Groq accounts, recovery access and renewals. Decide an evidence retention/archive policy with the association before storing real records. Keep screenshots, exports and secrets out of Git and public assets.

For a database backup, use Wrangler's D1 export against the intended database and environment, for example `npx wrangler d1 export DB --remote --output ./association-backup.sql`. Keep the backup outside the source checkout in restricted storage; SQL contains personal records. Verify that the selected binding points to the intended database before running any remote command.

Back up the private R2 objects separately using the bucket's S3-compatible API and restricted credentials. A database export does not include uploaded evidence. Preserve the exact object keys referenced by `payment_files.file_key`; record backup time, object count and hashes. Include backups in storage budgeting. Backup automation is not implemented in this MVP.

A restore drill must use a new staging D1 database and private R2 bucket: import the exported SQL into the empty database, copy evidence under its original keys, point a staging Worker at those bindings, and keep mail in dry-run and OCR off. Verify receipt snapshots/numbers, charges and allocations, audit history, file hashes and guardian access. Do not apply migrations over an already imported full schema. Do not publish staging or switch production until the association has reviewed the result. An independent backup and this drill remain required launch work; they were not performed during local implementation.

## Launch checks

- Real parent sign-in, session refresh, logout, email-bound invitation redemption and revoked family access.
- Real staff organization with required MFA, exact allowed administrator IDs, and denial of admin access through a parent session.
- Private cloud storage and cross-family file/receipt denial using synthetic records.
- Optional real Groq reading with a synthetic file, a real WorkOS session, explicit action/disclosure, verified account data controls and observed quota usage; otherwise keep OCR off.
- One deliberately authorized receipt email to its intended recipient: verify sender/domain, provider records, inbox and free-plan branding.
- Deployed CPU measurements for successful authentication/refresh, upload, approval and rendering; verify current account-specific free allowances.
- Association-approved receipt identity and bank instructions, opening balances if needed, retention ownership, and a successful restore drill.

After those checks, pilot one monthly cycle with a few families before inviting the remainder.
