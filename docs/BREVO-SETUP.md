# Brevo setup and approval handoff

**Current setup update:** the owner-approved `ajedrezbelen.com` domain is now **Authenticated** in Brevo after the separately approved three Cloudflare DNS additions. The three exact records and existing DMARC preservation requirement are in [SETUP-HANDOFF.md](SETUP-HANDOFF.md#approved-domain-setup-update). The separately approved sender **no-reply@ajedrezbelen.com / Ajedrez Belén** is now **Verified**, with DKIM `ajedrezbelen.com` and DMARC configured. Optional branding was skipped; sender creation required no new DNS change. Private API-key creation/installation and any sending remain pending; dry-run continues. Existing DMARC protection and website records were preserved. Earlier empty-domain observations below precede this approved change.

Brevo is the selected email provider. The payment portal and the older compatibility laboratory use separate receipt/email flows. Read [PORTAL-EMAIL.md](PORTAL-EMAIL.md) for the portal's durable backlog and [PORTAL-SETUP.md](PORTAL-SETUP.md) for the complete installation.

**`EMAIL_TEST_RECIPIENT` restricts only `/prototype`. It does not restrict portal email.** In portal live mode, bank approval or annulment immediately attempts that receipt's stored authorized recipients. The pending-email button can process other queued receipts. Keep `EMAIL_MODE=dry_run` during setup and never test against a database containing real family records.

## Readiness on 11 October 2026

| Layer | Verified status |
| --- | --- |
| Repository configuration | Tracked Worker defaults keep the portal disabled and email in `dry_run`; the example local configuration uses synthetic demo accounts. |
| Local rendering and provider behavior | Current aggregate: **158 unit tests passed**, clean **99-file Astro check**, successful build. The final **15-group payment HTTP run passed**; the intermittent Vite preview transport limitation remains documented in PORTAL-VERIFICATION.md. Earlier 27-test receipt/email results are a historical baseline. Provider requests are mocked; no email was sent. |
| Brevo account | Observed in a read-only account check: the account display name is **Asociacion de ajedrez Belen**. Earlier notes saying an account had not been created are superseded by this evidence. |
| Sender | The initial read-only inspection found one verified freemail sender, whose personal address is omitted. After checking that existing list, the exact separately approved sender **no-reply@ajedrezbelen.com**, name **Ajedrez Belén**, was created. Its row shows **Verified**, DKIM `ajedrezbelen.com`, and DMARC configured. Optional branding was skipped; no extra sender, DNS change, key or email was part of this action. |
| API key | The initial **API keys & MCP** listing contained no API keys. No key has been created or opened, and no secret value or credential file was read during this continuation. Private owner installation remains pending. |
| Sending domain | **ajedrezbelen.com — Authenticated** in Brevo after separately approved domain creation and three exact Cloudflare DNS additions. Authoritative DNS verifies all three records; existing DMARC `p=quarantine` and root/www routing were preserved. Both website origins returned HTTPS 200. |
| Account allowance / transactional activation | Follow-up read-only inspection of **Transactional usage and plan** confirms **Free plan**, **300 emails left** and **0 paused emails**. The Transactional page shows the Configuration/Verification onboarding flow; activation and actual sending remain unverified. No wizard step was advanced. |
| Acceptance and inbox delivery | Unverified. No live provider request, delivery webhook or mailbox check was performed. |

There is no Brevo template to create or upload: the application supplies its own HTML and plain text with every request. It also does not require importing students or parents into a Brevo marketing contact list. The source templates are `src/lib/portal/receipt.ts` for association receipts and `src/lib/receipt.ts` for the older `PRUEBA` laboratory receipt. Association identity and final receipt wording still need approval.

## Smallest external handoff

The steps below are the remaining approvals or owner actions. The separately approved domain addition, exact three DNS additions and verified sender creation are complete; do not repeat them. Private API-key creation and installation are the next owner action. Free plans only; do not enable trials, paid add-ons or an upgrade to complete them. Secret creation/entry, account/domain security changes, deployment and each external email require explicit user approval.

| Service / exact action | Affected setting or data and consequence | Smallest approval or owner handoff |
| --- | --- | --- |
| Brevo: confirm ownership/recovery and transactional activation of the existing account | The existing account is visible, but association ownership/recovery and transactional sending eligibility are not yet established | Owner confirms this is the intended account and its recovery owner; inspect the Transactional area and complete activation only with approval. Do not create a duplicate account, grant persistent access or accept new permissions on their behalf. |
| Brevo + server secret store: create and enter a transactional API key | No keys were present at the initial read-only check; creating one adds a persistent credential that can send mail through the account | Owner explicitly approves key creation and enters it directly in the intended local/staging secret store. Never paste it into chat, logs, Git, screenshots or public variables. Keep `EMAIL_MODE=dry_run`. |
| WorkOS + Cloudflare: verify staging prerequisites | Existing WorkOS Staging has no callback/sign-out URLs; its generated Test Organization is not approved for staff. Real staff authentication, approved admin IDs, MFA, isolated D1/private R2 and a staging deployment remain pending | Follow [portal setup](PORTAL-SETUP.md). Provisioning, auth-security settings, secrets, migrations and deployment require their own approval. Use synthetic records only. |
| Brevo: review privacy and allowance settings | Provider retention, open/click tracking, branding and shared daily quota | Owner confirms account-specific controls and accepts the free-plan presentation. Do not assume the API adapter disables tracking; it does not request that. |
| Staging: one intentional live message | Sends the prepared receipt data to one external mailbox | Obtain approval for the exact sender, recipient, synthetic content and staging environment. Use the `PRUEBA` laboratory for a first single-recipient smoke test if explicitly enabled; it requires real WorkOS admin authentication. Portal testing additionally requires an isolated database containing only approved controlled recipients. Never fabricate a bank-confirmed production payment for a test. |
| Production: enable portal email after acceptance checks | Subsequent bank approvals/annulments can send to real families | Separate go-live approval after association wording, real authentication, receipt permissions, quota and recovery checks pass. Do not bulk requeue simulated historical receipts as a test. |

Brevo's free-plan documentation currently describes 300 emails/day, mandatory Brevo branding and one account owner. The application permits at most 250 live attempts/day; sends from other applications still share the provider allowance. The follow-up **Transactional** panel confirms Free plan and 300 remaining emails; this read-only observation does not prove activation or successful delivery. [Brevo free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

Brevo's domain guide describes a guided DNS connection that can propose replacing an existing DMARC record. The completed manual setup used the exact approved records and preserved the existing DMARC policy. Any further domain-security change remains a separate approval. [Domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)

After an approved send, record the receipt/outbox ID, provider message ID, acceptance time and actual mailbox result in restricted association records. Confirm accents, mobile appearance, printed receipt and free-plan branding. Acceptance is not delivery. Restore `EMAIL_MODE=dry_run` after a controlled test; inspect Brevo logs before touching an ambiguous item. Enabling live mode does not itself requeue rows already marked `dry_run`.

## Held receipt recovery

Self-service email targets only the original family uploader’s verified account; staff-assisted email targets the selected designated family adult’s verified stored account. Secondary-guardian preferences, student addresses and free-form fields never determine delivery. Contact/eligibility problems retain `recipient_pending`; they do not create an alternate recipient.

After account repair, administration explicitly chooses **Preparar correo** for an eligible issued receipt. `POST /api/admin/email` with `action=prepare` and `receiptId` queues the first receipt email with an audit entry and does not send it. `Receipt.canPrepareEmail` requires an issued receipt, verified payment and no original receipt outbox row for any recipient. The action is idempotent and cannot retarget, replace or revive existing history, or prepare a void receipt. Review the resulting recipient, then process the batch separately. Neither account repair nor the preparation action triggers an automatic send.

## Earlier `/prototype` laboratory

The rest of this page describes only the older synthetic laboratory. Local preview, rendering and mocked request tests work without an account, API key, sending domain or outbound email. No real email was sent as part of its implementation.

### What is implemented

- A provider-independent HTML and plain-text receipt, with escaped dynamic HTML and a frozen snapshot of the payer, athlete, month, CRC amount, manual discount, long bank reference, transfer date and issuance date.
- Every output is prominently marked **PRUEBA**, uses synthetic data, and explicitly says it does not acknowledge a real payment.
- A Workers-compatible HTTPS adapter with `fetch`, `AbortController` and no Brevo SDK dependency. Its default is `dry_run`; no network request occurs unless `EMAIL_MODE` is exactly `live`.
- Live mode accepts only the exact configured `EMAIL_TEST_RECIPIENT`. It sends one receipt to one address; it does not attach a bank slip or add CC/BCC recipients.
- One request per invocation. Provider errors and exceptions are reduced to safe codes; they never return raw provider messages, API keys or email addresses.

Run the isolated checks with Node 24:

```sh
node --import tsx --test tests/email.test.ts tests/receipt.test.ts
```

These tests inject a mock `fetch`; they prove local request construction and error handling. They do not establish actual Brevo delivery, account eligibility or provider deduplication.

### Laboratory setup after the approvals above

1. Use the existing account after the owner confirms association ownership and recovery. Verify its transactional sending activation; the Transactional Free allowance was observed, but no email was sent.
2. Reuse the already authenticated `ajedrezbelen.com` domain. Reuse its already created and verified sender `no-reply@ajedrezbelen.com`, name **Ajedrez Belén**. Do not repeat sender creation or the completed DNS additions.
3. Generate an API key and put it in a local ignored environment file or the deployment's secret store. Never paste it into chat, commit it, or expose it in a client-side/public environment variable.
4. Configure one test recipient controlled by the person performing the test. Keep `EMAIL_MODE=dry_run` while reviewing the synthetic receipt in `/prototype`. This recipient setting does not restrict the portal.
5. Only after an intentional test-send action is ready, set `EMAIL_MODE=live` and use that action. The server route must enforce authenticated admin access and CSRF/origin protection; the adapter does not implement authentication. The recipient comes from server configuration, not form input.
6. Inspect the returned provider message ID, Brevo transactional logs and the actual mailbox/spam folder. Confirm branding, accents, mobile rendering, print output and the test warning. Return to dry-run when the test is complete.

| Server configuration | Meaning |
| --- | --- |
| `EMAIL_MODE` | `dry_run` or omitted prevents all sending; only exact `live` sends. |
| `BREVO_API_KEY` | Secret API key, live mode only. |
| `EMAIL_FROM` | Configured Brevo sender email, live mode only. |
| `EMAIL_FROM_NAME` | Sender display name, live mode only. |
| `EMAIL_TEST_RECIPIENT` | Exact, single allowed recipient, live mode only. |
| `EMAIL_TIMEOUT_MS` | Optional integer 10–30,000; defaults to 10,000. |

The sending domain is chosen and authenticated. The sender is created and verified. Private key installation and an owner-selected controlled test recipient remain required before a live test. Parent invitations and real receipt delivery remain outside this prototype.

## Adapter and outbox contract

`sendReceiptEmail(config, { to, idempotencyKey, receipt }, fetcher?)` uses a UUIDv4 saved with the outbox item. Store and reuse the same immutable receipt, recipient and key for the life of that item.

| Result | Outbox treatment |
| --- | --- |
| `dry_run` | Preview only; no provider request and no actual delivery. Keep separate from live acceptance. |
| `accepted` + `providerMessageId` | Brevo accepted the request; delivery is still unconfirmed. Persist the ID and do not resubmit automatically. |
| `blocked` | Nothing sent. Fix the missing/invalid configuration or disallowed recipient before another deliberate attempt. |
| `rejected` | Explicit refusal. Authentication/validation needs correction; HTTP 429 can be deferred. The adapter never retries automatically. |
| `unknown` | A request may have been accepted. Check Brevo logs before another attempt; do not blindly retry or switch providers. |

Provider acceptance must never mark a receipt as delivered. Later delivery webhooks or provider-log reconciliation are separate production work. Persist an outbox attempt before making the request so crashes or simultaneous clicks cannot cause unrestricted re-sends. The root prototype routes own that durable guard.

### Idempotency limitation to verify with the real account

The adapter follows Brevo's dedicated guide: it places `idempotencyKey` inside the JSON body's `headers`, with a UUIDv4 value. The guide currently describes a 30-minute expiry, whereas Brevo's older changelog describes 15 minutes and the generic endpoint reference uses a differently spelled example header. These primary sources are inconsistent. Do not rely on a presumed provider retry window; verify deduplication using synthetic test sends before production. Application-owned durable outbox state is necessary regardless of the provider window.

- [Dedicated idempotency guide](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)
- [Earlier idempotency changelog](https://developers.brevo.com/changelog/2021/11/10)
- [Transactional email endpoint reference](https://developers.brevo.com/reference/send-transac-email)

## Remaining external checks

The initial read-only check established account existence, the freemail sender, an empty API-key list and an empty domain list. Free plan and 300 remaining emails were also observed. The empty-domain observation is now historical: `ajedrezbelen.com` is authenticated after the approved domain and three DNS additions. The exact sender **no-reply@ajedrezbelen.com / Ajedrez Belén** has since been approved, created and verified, with domain DKIM and DMARC configured. Private API-key setup, remaining transactional activation, real acceptance and inbox delivery, message presentation, and provider deduplication remain pending. Before launch also confirm the association's approved receipt wording and identity, authorized recipients, tracking settings, and delivery webhook handling. Sibling discounts remain explicit manually entered amounts; the renderer never calculates a percentage or changes the amount paid.

Primary setup references, checked 10 October 2026:

- [Brevo transactional email setup and request guide](https://developers.brevo.com/docs/send-a-transactional-email)
- [Transactional platform activation troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP)
- [Transactional delivery events](https://developers.brevo.com/docs/transactional-webhooks)
