# Brevo setup and approval handoff

## Readiness on 11 October 2026

**Domain, sender and encrypted Worker-secret setup are complete. The newly authorized controlled message was accepted by Brevo and has a matching provider-reported delivered event.** The application received **HTTP 201 at 13:01:03.403 UTC on 11 October 2026**; its provider message ID is retained only in restricted evidence. Two status lookups followed, with the second returning HTTP 200 and the matching delivered event. **The owner confirmed receiving this message on 11 October; the controlled delivery test is complete.** The first attempt at 12:41 remains unknown and unchanged; the later attempt used a fresh, separately authorized durable claim, not an automatic retry. Global `EMAIL_MODE=dry_run`, OCR off and the exact owner/organization gate remain enforced. Final cleanup **`cc50f75b-6486-4973-b7db-c8b24475e591`** is deployed; both temporary test paths are removed.

| Layer | Current evidence |
| --- | --- |
| Account | Existing **Asociacion de ajedrez Belen** account observed. Do not create a duplicate account. |
| Domain | **ajedrezbelen.com — Authenticated** after three separately approved Cloudflare additions; existing DMARC and website records preserved. [Exact completed DNS records](SETUP-HANDOFF.md#approved-domain-setup-update). |
| Sender | **no-reply@ajedrezbelen.com / Ajedrez Belén — Verified**, with domain DKIM and DMARC configured. Optional branding skipped; previous freemail sender preserved. |
| Local credential/configuration | Owner privately entered/corrected the API key. Boolean-only validation passed API-key type and rejected SMTP-key type; sender/name, `EMAIL_MODE=dry_run` and `EMAIL_TIMEOUT_MS=10000` match. Values were never read or displayed. This is not provider authentication. |
| Hosted credential | Owner-installed encrypted `BREVO_API_KEY` Secret confirmed; the separately approved message received HTTP 201 using the hosted credential. No key value was read or displayed; do not reinstall or rotate it as a routine next step. |
| Transactional account panel | Read-only **Transactional usage and plan** showed **Free plan**, **300 emails left**, **0 paused emails**. Configuration/Verification onboarding was visible at that observation. The later controlled message was accepted; this does not guarantee future quota or production readiness. This is a dated observation, not a current quota guarantee. |
| Local implementation | HTML/plain-text rendering, request validation and outbox behavior have synthetic/mocked tests. Final candidate totals belong in [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md). |
| Historical financial outbox | The completed fictional payment workflow processed the original receipt only in dry-run, then cancelled it on void; one void notice remained `dry_run`, with zero provider IDs/live-budget attempts at that milestone. The separate controlled test did not process that backlog. |
| First, historical attempt | At **12:41:19.076 UTC**, returned `unknown`, `httpStatus=null`, `messageId=null`. Its original claim/result remain unchanged; no automatic retry. |
| Newly authorized attempt | Fresh approval and a distinct durable claim allowed exactly one later application send at **13:01:03.403 UTC**. Brevo returned **HTTP 201** and a provider message ID, retained privately. No outbox/backlog processing. |
| Delivery evidence | The second of two status lookups for the newly accepted message returned **HTTP 200 with a matching delivered event**; the owner UI displayed “Brevo informa delivered”. Provider-reported delivery is established; the owner subsequently confirmed receipt. A subsequent dashboard refresh independently showed **Sent and Delivered** for the matching approved subject/sender/recipient/test tag, displayed **11/10/2026 07:01**. Earlier zero-entry observations are superseded for this second message. |

The initial empty domain/key lists are historical observations superseded by the approved setup and private local/Worker key entry. Do not generate a replacement key, recreate the domain/sender or repeat DNS changes as a routine next step.

## Controlled attempt, diagnosis and cleanup

The first approval covered exactly one nonfinancial message from **no-reply@ajedrezbelen.com**, subject **“PRUEBA — Portal de pagos Ajedrez Belén (sin validez financiera)”**, to one fixed owner-approved mailbox. Its personal address is retained only in restricted local evidence. That first temporary path recorded one unknown application attempt. Its status lookup at **12:41:32.434 UTC** had a null HTTP status and empty events, and filtered dashboard logs showed zero entries. **The first result remains unknown**; the subsequent independent approval and successful message do not retroactively establish what happened to it.

An independent, network-free reproduction in real `workerd` deterministically threw a `TypeError` for `redirect: 'error'` before transport; `redirect: 'manual'` worked. This is a strong explanation for the observed attempt, **not direct evidence of the hosted exception**. Both permanent email helpers now use manual redirect handling and classify 3xx responses as `unknown`, non-retryable; they do not follow redirects with the API credential. At the first transport-fix cleanup milestone, **39 focused tests**, **231 aggregate tests**, a clean **122-file Astro check** and a **110-input / 287-output build** passed.

The first cleanup deployed successfully as `81927314-9d61-4893-8957-41abf881c88d` (`output/brevo-transport-cleanup-deploy.log`). Temporary source/route/test files were removed; the audit and private archival evidence were retained. **8/8 anonymous post-cleanup checks passed** (`output/brevo-cleanup-read-checks.json`); the authenticated owner's fresh GET of `/admin/brevo-delivery-test` returned **404 Not Found**. Direct SELECT-only audit verification retained four rows (one claim, one unknown result, one status lookup and one empty observation), with no deletion or financial/outbox write; `output/brevo-single-test-audit-query.json`. Evidence: `output/brevo-single-test-evidence.json` and restricted `output/brevo-single-test-artifacts/`, under the isolated workspace identified in [SETUP-HANDOFF.md](SETUP-HANDOFF.md). No personal recipient or secret value belongs in checked-in docs.

A fresh exact-one-message approval then authorized a distinct owner-only test at temporary version `392a1fc3-a565-403b-97bb-4b7fff7f92b8`, path `/admin/brevo-delivery-test-2`. It kept the same approved nonfinancial payload/sender/recipient and global dry-run/OCR-off, made no queue calls, and preserved the first unknown claim. **18 synthetic tests independently passed**, with **125 clean Astro files** and a **112-input / 288-output build** for that temporary test version. The attempt received HTTP 201; its second read-only status lookup established the matching provider-reported delivered event. Evidence: `output/brevo-second-test-evidence.json`; raw message ID and personal recipient remain private. Final cleanup `cc50f75b-6486-4973-b7db-c8b24475e591` passed a **110-input / 287-output build**, preflight/dry-run, **8/8 anonymous checks** and authenticated owner GET of removed `/admin/brevo-delivery-test-2` returned **404**. Its 110 source hashes match the already-reviewed permanent code; the earlier 231-test/122-file evidence is reused, not newly rerun. SELECT-only verification retained ten audit rows: the first four byte/value-identical plus six for the new claim, acceptance, two lookups and two observations. Delivered event time: **13:01:05 UTC**, observed **13:02:30.393 UTC**. Final evidence: `output/brevo-second-cleanup-{build,dry-run,deploy}.log`, `output/brevo-second-cleanup-read-checks.json` and `output/brevo-second-test-audit-after-cleanup.json`. No deletion or financial/outbox mutation occurred.

**Any further send requires fresh approval** of the exact recipient, content and controlled runtime. The transport correction does not authorize consuming another attempt, processing the outbox, changing global dry-run or launching production email.

## Sender, receipts and current safe configuration

The user explicitly chose a no-reply sender with no receiving mailbox or Cloudflare forwarding. HTML and plain text say **“Correo automático. Las respuestas a este correo no se atienden. Para consultas, escribinos por WhatsApp.”** and link to <https://wa.me/50687686102>. There is no separate Reply-To. This describes unattended replies; it does not claim SMTP rejects incoming messages. Sender branding does not change the financial receipt's association identity.

There is no Brevo-hosted template to upload and no marketing contact-list import to perform. The app sends its own escaped HTML/plain text from `src/lib/portal/receipt.ts`; `src/lib/receipt.ts` serves the older prominently marked PRUEBA laboratory.

| Setting | Meaning |
| --- | --- |
| `EMAIL_MODE` | Exact `live` permits provider requests; `dry_run` or any other value sends nothing. Current staging policy requires `dry_run`. |
| `BREVO_API_KEY` | Secret API key, not an SMTP key. Owner installation is complete locally and as an encrypted Worker Secret. Preserve it; never expose its value. |
| `EMAIL_FROM` | Approved sender `no-reply@ajedrezbelen.com`. |
| `EMAIL_FROM_NAME` | Approved display name `Ajedrez Belén`. |
| `EMAIL_TIMEOUT_MS` | Optional integer 10–30,000; current/default value 10,000. |
| `EMAIL_TEST_RECIPIENT` | **Only constrains the older prototype. It does not constrain portal delivery.** |

In portal live mode, bank approval/annulment attempts the receipt's stored authorized recipient, and backlog processing can attempt other pending rows. Only a separate synthetic-only database and approved recipient policy make a controlled live test appropriate. Upload/OCR is never bank confirmation. Current owner-only staging keeps provider calls off even while exercising outbox records.

Self-service receipt mail targets the original authenticated family uploader. Staff-assisted receipt mail targets the selected designated family adult's verified stored account. No student address, arbitrary input, secondary-guardian preference or fallback recipient is used. Invalid/inactive contact holds delivery as `recipient_pending`; the financial receipt remains renderable when core payment/account invariants hold.

## Smallest external handoff

The historical fictional payment workflow used dry-run only. Two separate exact-one-message authorizations have now been consumed: the first remains unknown; the later message was accepted and reported delivered by Brevo. No further send is permitted under either approval. No further send is needed: the owner confirmed receiving this controlled message. The following are future operating decisions, not new prerequisites to repeat this test:

| Service/action | Consequence | Smallest owner decision or handoff |
| --- | --- | --- |
| Brevo account operation | The approved message established the working sender/provider path | Do not repeat activation/domain/sender setup. Future account-recovery, permissions or support changes are separate owner decisions, not required follow-up sends. |
| Brevo privacy/allowance | Provider retention, tracking, branding and shared quota affect receipts | Review account controls and free-plan presentation. The adapter does not explicitly disable tracking; do not assume it is disabled. |
| Runtime credential | Existing encrypted Secret provides a persistent account capability | Installation is complete. Keep global dry-run; no routine recreation, rotation or permission change. |
| Another controlled message | Would consume a new external send attempt | Obtain fresh approval for exact sender, one controlled recipient, content and isolated action. The removed temporary test path must not be restored or another attempt made automatically. Global portal live mode remains blocked. |
| Mailbox confirmation | Establishes inbox/spam placement separately from Brevo-reported delivery | The owner confirmed receiving the message on 11 October; this gate is complete. Preserve both independent attempt records and do not send another message to check delivery. General receipt/outbox delivery remains a separate untested workflow. |
| Production email | Future bank approvals/annulments may mail real families | Separate go-live approval after real authentication/MFA, association wording, recipient rules, quota, recovery and delivery handling are verified. |

The two consumed exact-one-message approvals do not cover any further message or real receipt delivery. Do not test by processing real backlogs, fabricating a production bank confirmation or enabling the blocked prototype. `dry_run` outbox rows do not automatically become pending when live mode is enabled.

Brevo's Free documentation describes 300 emails/day; the app limits live attempts to 250/day, but other applications share the provider allowance. Verify current account allowance before a future test; do not promise zero-cost unlimited delivery or accept a paid upgrade. [Free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

The completed manual domain setup preserved existing DMARC `p=quarantine`. Automatic DNS setup can propose replacing DMARC; any further domain-security change is separate approval. [Domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)

## Held receipt recovery

In the general portal, administration can use **Preparar correo** after account/contact repair. `POST /api/admin/email` with `action=prepare` and `receiptId` resolves the authorized stored recipient, creates the first receipt outbox row and records an audit without sending. It requires an issued receipt, verified payment and no previous original receipt outbox row for any recipient. Equivalent repeated preparation is idempotent; it cannot retarget, replace/revive history or prepare a void receipt. Contact edits do not release email automatically. Backlog processing is a separate operation.

**This route is blocked in owner-only hosted staging.** These recovery instructions describe the general portal capability, not an available current staging action. See [PORTAL-EMAIL.md](PORTAL-EMAIL.md) for outbox semantics.

## Adapter and outbox contract

Both adapters validate and render messages before sending, use one HTTPS request with a timeout and return safe result codes rather than raw provider errors/addresses. The durable outbox owns an immutable UUIDv4 idempotency key, receipt and recipient.

| Result | Required treatment |
| --- | --- |
| `dry_run` | No provider request or delivery; keep separate from live acceptance. |
| `accepted` + provider message ID | Accepted by Brevo, delivery unconfirmed; persist ID and do not automatically resubmit. |
| `blocked` | Nothing sent; configuration or recipient needs correction. |
| `rejected` | Explicit refusal; authentication/validation needs correction, or defer an eligible rate-limited attempt. |
| `unknown` | Provider may have accepted it; inspect provider logs before another attempt. Do not blindly retry or change providers. |

Acceptance must never mark delivery. Persist an attempt before the request, keep ambiguous attempts held and prevent simultaneous processing. Webhook reconciliation remains separate production work. The API key is transmitted only as the provider authentication header and must never appear in error output.

The adapter places UUIDv4 `idempotencyKey` in the JSON body's `headers`, following Brevo's dedicated guide. Its guide, older changelog and generic endpoint examples differ on retry-window/details; do not depend on a presumed provider deduplication window. Verify with explicitly approved fictional sends before production. The durable application outbox remains necessary regardless. [Idempotency guide](https://developers.brevo.com/docs/heterogenous-versions-batch-emails), [earlier changelog](https://developers.brevo.com/changelog/2021/11/10), [endpoint reference](https://developers.brevo.com/reference/send-transac-email).

## Local tests and earlier laboratory

`/prototype` remains a separate synthetic compatibility laboratory and is blocked in current hosted staging. Its live adapter accepts only its configured `EMAIL_TEST_RECIPIENT`, adds no CC/BCC or proof attachment, and renders a prominent PRUEBA warning. That restriction does not apply to the portal.

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node --import tsx --test tests/email.test.ts tests/receipt.test.ts tests/portal-email.test.ts tests/portal-receipt.test.ts
```

These use synthetic fixtures and mocked provider requests. They cannot prove account eligibility, actual delivery or provider deduplication. A key shape check also cannot prove any of those.

Additional primary references: [API-key authentication](https://developers.brevo.com/docs/api-key-authentication), [transactional request guide](https://developers.brevo.com/docs/send-a-transactional-email), [activation troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP), [delivery events](https://developers.brevo.com/docs/transactional-webhooks).
