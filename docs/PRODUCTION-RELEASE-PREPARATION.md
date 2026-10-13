# Production release preparation — local documents only

These files prepare a future production configuration for Ajedrez Belén. They do
not configure a service, provision a resource, install a credential, apply a
migration, deploy code, invite a person, import records or send mail.

- [Decision manifest](production-release-plan.template.json): deliberately not a
  Wrangler configuration. Proposed targets are separate from approved values;
  missing identities and approvals remain `null` or `false`.
- [Configuration recipe](PRODUCTION-CONFIGURATION.md): how approved decisions map
  to the actual runtime bindings, including a SINPE-only destination.
- [Migration and release checklist](MIGRATION-RELEASE-CHECKLIST.md): target checks,
  the exact four migrations, activation gates and recovery limits.
- Local preparation evidence: `portal-work/output/production-release-prep/verification.json`; final integration evidence: `portal-work/output/guard-integration/final-source-verification.json`. Neither establishes production/provider verification.

Source context is the private task decision record (`portal-work/output/production-preparation/production-decisions.json`), the isolated business/public candidates, and the actual repository's setup and staging runbooks. The owner's later clarification
`Sentinel_a209f8d4b96c8191b9d77cdc7144c6b2` confirms SINPE Móvil at `87686102`
(display `8768-6102`) and permits every explicitly authorized administrator to
confirm funds with an actor audit. It does not approve a holder identity, receipt
identity, Walter's account/grant, opening ledger, external action or live email.

The source decision record incorporates the clarification and completed source convergence. The actual checkout includes the deployed parent-login/callback behavior and financial guard. A reviewed 22-file merge passed 302 tests (297 application + five diagnostics), Astro checks on 132 files with zero diagnostics, a 111-input/288-artifact build, preflight and 54 independent focused regressions. All 333 deployed-baseline files are accounted for, with deliberate guard changes; unrelated files and the Git index are preserved. The local source-divergence gate is closed.

The complete converged source is now deployed to restricted staging as `428d0d13-f1ce-4f59-901e-58c23f0fed34`, with 100% readback, exact preserved bindings and 18 anonymous checks. The bounded existing-family recheck stopped before any request; no new authenticated pass is claimed. The previous isolated candidate remains historical release evidence, not unfinished copyback. A production target and configuration still need the explicit decisions below; passing a staging build does not approve a production artifact.

This directory contains no executable configuration builder. Completion of its
manifest is a review step, not an activation command. An incomplete manifest must
never be translated into a deployable configuration. Keep `PORTAL_ENABLED=false`,
`PORTAL_BUSINESS_CONFIG_APPROVED=false`, `EMAIL_MODE=dry_run` and `OCR_MODE=off`
through preparation and any separately approved disabled-shell release.
One explicit approval may cover several precisely identified actions; the
separate manifest entries record scope and do not require repeated confirmation
of an action already authorized. The confirmed SINPE details need no new decision.

These reviewed preparation files and the portable diagnostics are saved in the repository. Generated builds, credentials, private data, capture helpers and the enclosing `output/` directory remain outside it.

## Smallest next production setup bundle — proposed, not executed

In Cloudflare account `7d3e79129c4f0b3619a419cabbfa021e`, the next reviewable action is creation of **empty D1 `ajedrez-belen-portal-production`** (future `DB` binding; actual returned UUID recorded afterward) and **private Standard R2 `ajedrez-belen-portal-production-slips`** (future `SLIPS` binding, no public access). Preserve public Worker `ajedrez-belen`; this bundle changes no Worker, DNS, route or hosted pipeline, runs no migration, installs no secret and copies no staging records. Resource creation is not yet approved. Migrations `0001`–`0004` need approval tied to the actual target UUID.

The WorkOS owner handoff is the separate Production client ID, staff organization ID and exact approved administrator identities, plus approval of `https://ajedrezbelen.com/auth/callback` and logout `https://ajedrezbelen.com/`. Staff-organization TOTP is proposed; this does not impose global family MFA. Private Production API key and a fresh cookie password require an approved owner-controlled installation. Billing was already observed; no new card or paid custom-auth domain is needed. Protected-www canonicalization before PKCE still requires implementation and verification after the origin decision; public roots remain independently direct 200.

Any later disabled production shell must explicitly retain `PORTAL_ENABLED=false`, `PORTAL_BUSINESS_CONFIG_APPROVED=false`, `PORTAL_DEMO=false`, `PROTOTYPE_ENABLED=false`, `PROTOTYPE_LOCAL=false`, `EMAIL_MODE=dry_run`, `OCR_MODE=off`, and omit staging/test-only bindings. Holder/receipt identity, opening ledger and sibling rules remain unresolved; SINPE 8768-6102 is already confirmed and needs no IBAN. Brevo's completed diagnostic need not be repeated; production private binding and deliberate financial-mail activation remain separate.

Free-tier planning is bounded by Workers' 100,000 requests/day and 10 ms CPU/invocation, D1's 5 million rows read/100,000 written per day and shared 5 GB allowance, and Standard R2's shared 10 GB-month/1 million Class A/10 million Class B included monthly usage. R2 overages are billable; no account-wide zero-cost cap is verified. Measure shared usage and representative CPU before live use; do not upgrade automatically. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

Fresh recovery still needs one explicitly approved, existing read path for the known synthetic R2 object and a private destination. The old `remote_auth_denied` classifier did not prove a provider denial; it conflated several authentication failures, so the precise cause remains unknown. No access retry or new grant occurred. New acquisition needs independently reviewable provenance; the previous reused-original verification does not certify a fresh download.
