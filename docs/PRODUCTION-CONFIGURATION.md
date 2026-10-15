# Configuration recipe — incomplete decisions cannot become a deployment

**Later production state:** The repository now contains `wrangler.production.jsonc` with active portal, email, and OCR settings, and the production D1 has migrations `0001`–`0010` applied. This document preserves the earlier preparation recipe; it does not describe or validate the current deployed Worker. See [the 0010 production migration record](PRODUCTION-D1-MIGRATION-0010-2026-10-14.md) for the verified database change. Review the live Worker and Git pipeline before another code deployment.

Use the [manifest](production-release-plan.template.json) to resolve decisions
before generating a dedicated production configuration. No deployable config or
production artifact is supplied here. The verified configuration candidate was
built for staging; its test counts and staging build do not validate a future
production target. The integration record verifies the combined parent-login/callback source and financial guard in the actual repository. All application source is reconciled; the unchanged isolated candidate remains historical release evidence. Local verification passed 302 tests, 132 clean Astro files, build/preflight and 54 independent focused regressions. Before an approved production release, record that target's final configuration/artifact digest; this preparation supplies no production resource or deployment approval.

## Preserve the public site and choose the authenticated origin

The proposed target is the existing public Worker `ajedrez-belen` in account
`7d3e79129c4f0b3619a419cabbfa021e`. These are proposal values until the exact account,
Worker identity, routes and full current rollback version are read back and
approved for the release. Preserve independent HTTPS 200 landing responses at
`https://ajedrezbelen.com` and `https://www.ajedrezbelen.com`.

Approve the proposed authentication origin `https://ajedrezbelen.com`, callback
`https://ajedrezbelen.com/auth/callback`, and logout URL
`https://ajedrezbelen.com/`. The proposed protected-URL policy canonicalizes www
GET/HEAD requests before PKCE starts, rejects cross-origin mutation requests
without redirecting or replaying them, and keeps host-only cookies. This policy
requires implementation and verification; documentation alone does not provide
it. Do not change the public www landing to a redirect as part of this decision.

Protected routes `/portal`, `/admin`, `/auth`, `/login`, `/api`, `/demo` and
`/prototype`, with their descendants, must pass through the Worker. Protected
pages, private file URLs and receipt PDFs must not become static assets or an
SPA fallback. Demo and prototype remain unavailable. Keep workers.dev and preview
URLs disabled; preserve reviewed public domain routing instead of inventing a
new route or custom domain.

The isolated assets-only public pipeline is an interim landing release path. It
cannot host this portal. Once a production portal is approved, the public Git
pipeline must use its reviewed production build and config rather than later
overwriting it with the assets-only build. A source push can trigger the current
unsafe hosted pipeline; source integration, a push and hosted command changes
must be coordinated and separately approved.

## Dedicated resources and nonsecret runtime bindings

Do not replace the base prototype config's zero UUID with a real database ID.
Do not reuse the staging config or assets-only config for a production portal.
Prepare a separate production config only after each required target value is
approved. A reviewed guard must compare the final target to the completed
manifest before any future deployment; these documents are not such a guard.

| Runtime binding or setting | Source of value and release requirement |
| --- | --- |
| `DB` | Proposed new D1 name `ajedrez-belen-portal-production`; actual provider-issued production UUID must be recorded separately, nonzero, and distinct from staging/prototype. Verify account, name and UUID together. |
| `SLIPS` | Proposed new private Standard R2 bucket `ajedrez-belen-portal-production-slips`; verify the account plus exact bucket name. R2 uses that scoped bucket identity, not an invented UUID. No r2.dev or public custom domain. |
| `WORKOS_CLIENT_ID` | Exact immutable client ID from the separate approved WorkOS Production environment; never infer it from an email, display name or staging client. |
| `WORKOS_ORGANIZATION_ID` | Exact approved production staff organization ID. |
| `ADMIN_USER_IDS` | Only explicitly approved immutable user IDs. Empty until approved; do not create or grant Walter an account based on his name. |
| `WORKOS_REDIRECT_URI` | Exact approved production callback. Provider callback/logout settings and staff MFA policy require their own approval. |
| `PAYMENT_BANK_NAME` | `SINPE Móvil`: the confirmed payment rail, not a claim about an unconfirmed bank. |
| `PAYMENT_ACCOUNT_ID` | `87686102`, confirmed by the owner as the SINPE destination. This generic field does not require an IBAN. |
| `PAYMENT_DESTINATION` | `SINPE Móvil: 8768-6102`, recorded in the local decision record. Any added reference/holder instructions remain pending. Do not derive a holder name from the association, WhatsApp profile or receipt label. |
| `ASSOCIATION_RECEIPT_NAME` | Explicitly approved receipt issuer identity; currently unset. Confirm whether the existing receipt format satisfies the required legal wording. |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Sender address `no-reply@ajedrezbelen.com` was verified in a controlled test. Approve its production use and exact display name; sender verification alone does not activate receipts. |

The prototype table remains in the migration chain, but no prototype routes or
synthetic data are enabled or copied into production. Keep all seven flags
explicit in the disabled release:

```json
{
  "PORTAL_ENABLED": "false",
  "PORTAL_BUSINESS_CONFIG_APPROVED": "false",
  "PORTAL_DEMO": "false",
  "PROTOTYPE_ENABLED": "false",
  "PROTOTYPE_LOCAL": "false",
  "EMAIL_MODE": "dry_run",
  "OCR_MODE": "off"
}
```

Omit **all `STAGING_` bindings**, including parent test identity/allowlist values.
Omit `EMAIL_TEST_RECIPIENT`: it does not restrict portal receipt recipients. With
OCR off, omit Groq credentials/model settings. Do not copy staging data, old
outbox attempts, fictional payment labels, WorkOS identities or cookie secrets.

No automatic resource creation is permitted. A later reviewed deploy command
must name the dedicated config explicitly and disable Wrangler provisioning
with `--experimental-provision=false`; use the lockfile-pinned executable and
reviewed environment-file handling. No deployment command is supplied or run by
this preparation. Neither an implicit Wrangler target nor a dry run is a
substitute for verifying the intended resources.

## Business approval is a separate gate

The owner confirmed SINPE `87686102` and financial confirmation authority for
all explicitly authorized administrators, with an actor audit. Walter is the
intended treasurer/operator. This authorizes neither bank access nor money
movement, and it grants nobody a production account or role.

The manifest requires an explicitly approved **account holder name**, independent
of whether an IBAN exists. The current business resolver validates four runtime
strings and the approval flags; it does **not** check an account-holder field,
legal sufficiency, banking ownership or all business decisions. Therefore a
nonempty receiving number is insufficient justification for setting
`PORTAL_BUSINESS_CONFIG_APPROVED=true`.

The confirmed SINPE details need no reconfirmation. Approve the holder, any added
payment instructions and receipt identity before that flag can change. Existing
receipts use CRC and an annual `AB-YYYY-` sequence; there is no
separate legal/tax identifier field. If required information cannot be correctly
represented in the current format, complete and verify that code change first.
Do not invent legal identity, holder details, account data or receipt wording.

All current administrators also have family and financial administration powers.
Confirm that wider scope for each approved administrator; a WorkOS role label
does not implement treasurer-only or read-only permissions.

Monthly fees already confirmed are ₡12,000 for iniciación and ₡15,000 for cadetes,
intermedios and avanzados, due during the first eight days. Opening balances,
dataset, cutoff and reconciliation remain undecided. The exact sibling-discount
rule remains pending; do not apply an automatic or retroactive rule. Obtain the
rule or an explicit decision to launch with it deferred. A technical release
does not authorize importing a roster, changing monetary records or generating
opening balances. A receipt upload never constitutes bank confirmation.

The integrated business guard is expected to hold new submissions, eager slip
uploads and approval until readiness is approved. Authorized historical
corrections, native replacement uploads, rejection and void workflows remain
available when the portal is enabled. The business flag is not a general
maintenance or security kill switch; do not rely on it to freeze all writes.

## Secrets and email require distinct handoffs

Only private binding **names** belong in these files: `WORKOS_API_KEY`,
`WORKOS_COOKIE_PASSWORD`, `BREVO_API_KEY`. Obtain specific permission for private
production installation through an owner-controlled channel. Do not extract,
print, copy staging credentials, or place secret values in command arguments,
repository files, screenshots or evidence logs. Verify presence and environment
without displaying values; production binding presence is not yet verified.

Keep `EMAIL_MODE=dry_run`. The controlled Brevo message was received; another
diagnostic email is not required by this preparation. Live mode authorizes
automatic delivery attempts after future payment approvals and receipt voids,
so the approval must explicitly cover those effects. The immutable recipient
policy binds a self-service receipt to its original uploader and a staff-assisted
receipt to the selected verified adult. A guardian link is not a subscription.

Before any later mail activation, approve production sender/display name,
privacy/tracking/retention, exact eligible outbox entries and recipient policy.
Separately approve a specific queued batch. Never replay dry-run, cancelled or
unknown attempts to test delivery. Do not treat a test-recipient variable as a
production recipient restriction.

## Free-tier operation and recovery

No paid plan or upgrade is authorized. Reuse existing free offerings only after
representative shared-account capacity and limits are checked. R2 Standard has
usage-based exposure beyond included allowances; the prior evidence does not
establish a hard spending cap. If capacity or a required operation would require
payment, stop for a user decision instead of upgrading or weakening safeguards.

Record a recovery owner/deputy, encrypted off-host destination, retention, and
acceptable data loss/downtime. Fresh R2 CLI retrieval remains unresolved; do not
repeat a failing auth flow, broaden credentials, or substitute an old local copy
without an exact approved next action. A local synthetic restore drill and old
staging capture do not prove current production D1/R2 recovery. See the
[migration and release checklist](MIGRATION-RELEASE-CHECKLIST.md).
