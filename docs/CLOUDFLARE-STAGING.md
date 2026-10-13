# Separate Cloudflare staging portal

Historical read-only launch inspection on **11 October, approximately 17:12 UTC** found staging version `cc50f75b` and Workers is on **Free / $0**. The account dashboard displayed 383/100,000 requests today, 1.09k ms aggregate CPU and $0 billable usage so far for 23 September–23 October. These are dated aggregate observations, not representative operation benchmarks or a future spending guarantee. D1/R2 usage still needs inspection. A fresh anonymous probe passed **8/8** route checks, including direct HTTPS 200 on both public origins (`output/launch-readiness-live-read-checks.json`). That inspection made no account, routing or deployed-code change. The later owner-approved parent-access deployment is recorded below; [latest evidence](PORTAL-VERIFICATION.md#launch-readiness-follow-up--local-changes-11-october-2026).

The failed public build **ea837720** at commit `cb5b2c4` compiled successfully. Read-only logs establish deploy failure **10181**: the `DB` binding referenced placeholder `00000000-0000-0000-0000-000000000000`. The same historical log reports automatic creation of R2 bucket `ajedrez-belen-prototype-slips` before failure; no deletion/cleanup was attempted. The failed build created no Worker version. The current public assets-only version is **6c49cb5b**, commit **89b19896745e4486aec12f8b8140548d8f00f20a**, at **100%** traffic. Production branch `main`, builds enabled, include paths `*`, root `/`, build `npm run build`, deploy `npx wrangler deploy`, no build variables/secrets or deploy hooks. No token value was inspected. A future push can trigger this path. Do not merely substitute a real D1 ID or retry: prepare and approve a public-specific artifact/configuration, resource/route intent and `--experimental-provision=false` first. No public build or setting was changed.

## Current state — 11 October 2026

**Current release `d0507041-4b53-4ba3-b407-fa6cba4fb7fd` is deployed** under the owner’s direct approval to publish the reviewed staging changes with email off (`output/launch-readiness-approved-deploy.log`). Readback confirms deployment `0d279da8-d66d-4d2c-8857-4bba44dcc540` at **100% traffic**, created **2026-10-11T17:54:33.263929Z** (`output/launch-approved-deployment-readback.json`). Source/artifact hashes and exact owner-only bindings remained unchanged after independent review; **243 tests**, **124 clean Astro files**, **110 inputs / 287 outputs**, build/preflight and dry-run support this same source. **8/8 anonymous post-deployment checks passed** (`output/launch-approved-live-read-checks.json`). The existing owner admin session reloaded with the same fictional ₡12,000 balance, zero pending and voided payment; no financial mutation was performed. The earlier approval-review rejection ran no deployment and is resolved. Prior cleanup `cc50f75b` is retained as historical staging rollback evidence.

The owner confirmed enrollment, and non-secret WorkOS user details show Active, verified and **One-time password (TOTP)**; organization MFA Required was rechecked. No fresh challenge, cancellation or recovery test was performed. The authorized bundle `output/private-capture-BpmOGW/report.json` passed: 23 captured tables, 41 rows and one referenced original, with schema/local integrity/foreign-key/exact typed-row/rowid checks and equal before/after D1 snapshots; zero remote writes requested. The file was reused from the prior authenticated download and matched to current D1/UI key, size and SHA; **no fresh R2 download occurred**, and CLI object-read permission remains unresolved. Helper 15/15 independent tests and workerd compatibility passed; independent complete review passed (`output/launch-capture-independent-complete-verification.json`), including eight files at 0600, two directories at 0700 and unchanged before/after bundle inventory. This does not establish native export, remote restore, unknown/orphan object or R2 HTTP/custom-metadata recovery, or off-host backup. [Capture status](PORTAL-OPERATIONS.md#private-hosted-to-local-capture).

## Historical cleanup — version cc50f75b

**Previous cleanup release `cc50f75b-6486-4973-b7db-c8b24475e591` was deployed.** The later separately approved controlled message received HTTP 201 and matching API/dashboard delivered evidence. The temporary second test route/module/test are removed, authenticated owner GET returns 404, and **8/8 anonymous cleanup checks passed**. Final build/preflight/dry-run passed with **110 inputs / 287 outputs**; its 110 source hashes match the already-reviewed/tested permanent code from the earlier 231-test/122-file milestone. No fresh aggregate/typecheck rerun is claimed. Encrypted `BREVO_API_KEY` remains installed; global email dry-run, OCR off, exact owner/organization and existing DB/private R2 are unchanged. The original unknown attempt and earlier financial/visual checks retain their own scopes in [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md). Authentication-only rollback remains `5a697300-bc6e-4eff-b78d-1466f7d5e40d`.

The user approved the sole owner's hosted payment testing with fictional records and overnight progress, while retaining `EMAIL_MODE=dry_run` and `OCR_MODE=off`. Two later independent approvals each covered exactly one fixed nonfinancial application attempt: the first remains unknown; the newly authorized message was accepted and reported delivered by Brevo. No automatic retry or queue processing occurred. Both approvals are consumed and authorize no additional send, real family/payment data, production routing, general live email, OCR or paid upgrade. The public `ajedrez-belen` Worker and both **ajedrezbelen.com** and **www.ajedrezbelen.com** remain separate.

## Approved resources and identity

| Setting | Exact approved value / completed state |
| --- | --- |
| Cloudflare account | `7d3e79129c4f0b3619a419cabbfa021e`; Workers **Free** observed |
| Worker | `ajedrez-belen-portal-staging` |
| Test-only origin | `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev` |
| D1 | `ajedrez-belen-portal-staging`, UUID `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`, binding `DB`; migrations `0001`–`0004` applied |
| R2 | `ajedrez-belen-portal-staging-slips`, binding `SLIPS`, Standard/private; public access and public development URL disabled; no custom domain |
| WorkOS client | `client_01M4M8D1P0W2N2WANHTC4SF921` |
| WorkOS organization | `org_01M4MK3YVA8B4WC0F659G28MCJ` |
| Sole approved owner | `user_01M4MJY2GGNK2GTTH9AYRDTP78`; membership Active |
| Installed private Worker secrets | `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` and encrypted `BREVO_API_KEY`; owner installed them privately, values never read |
| Source configuration | `wrangler.staging.jsonc`, `astro.staging.config.mjs` |
| Generated deployment configuration | `dist-staging/server/wrangler.json` |

Resource creation and all four remote migrations are complete; do not repeat them. Preserve the unrelated `docklet` R2 bucket and all existing public/domain-security settings. Initial zero-row/zero-object observations describe the earlier disabled shell, not a future guarantee after authorized fictional tests.

WorkOS hosted callback/logout are now **Default**; local URLs remain registered. Organization membership requires invitations. The owner-approved Staging MFA policies are now saved and verified: environment **Optional**, existing sole-owner organization **Required**. Owner enrollment is confirmed with a visible TOTP method; a fresh challenge remains untested. Production MFA was not changed. Details: [WORKOS-SETUP.md](WORKOS-SETUP.md).

R2 was already active; an activation/card prompt is not an established blocker. Its free allowance is shared and excess usage can be billed. Workers Free request CPU needs deployed measurement; startup milliseconds are not request CPU. No paid plan change is authorized. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Deployed owner-only policy

`scripts/staging-policy.mjs` and source configuration pin the exact account, Worker, D1, private R2, WorkOS client, callback, organization and sole owner. They require:

| Variable | Deployed value |
| --- | --- |
| `STAGING_AUTH_SETUP` / `STAGING_PORTAL_TEST` | `true` / `true` |
| `PORTAL_ENABLED` / `PORTAL_DEMO` | `true` / `false` |
| `PROTOTYPE_ENABLED` / `PROTOTYPE_LOCAL` | `false` / `false` |
| `EMAIL_MODE` / `OCR_MODE` | `dry_run` / `off` |
| `WORKOS_REDIRECT_URI` | `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback` |
| `PAYMENT_BANK_NAME` | `PRUEBA — no transferir` |
| `PAYMENT_ACCOUNT_ID` | `staging-synthetic-only` |
| `PAYMENT_DESTINATION` | `ENTORNO DE PRUEBA — no realizar transferencias` |
| `ASSOCIATION_RECEIPT_NAME` | `PRUEBAS — Ajedrez Belén (datos ficticios)` |

The deployed candidate admits owner-authorized admin/family business routes only after verified identity and exact owner/organization checks, before database access. Public family entry/invitations, invitation APIs, email administration, `/login`, demo and prototype are blocked. The same owner may act as a guardian through an ordinary stored family link; no fake session or demo bypass is permitted. Named `workers_dev` hosting is enabled; version preview URLs, domain routes, additional environments/bindings and secrets in public variables remain forbidden. The encrypted Worker `BREVO_API_KEY` Secret is installed; global dry-run remains mandatory. Both separately approved temporary email-test paths have been removed. No further send is required for this test; another send would require fresh approval.

## Build, preflight and controlled deployment

From the isolated project root, using installed dependencies:

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node scripts/build-staging.mjs
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node scripts/preflight-staging.mjs
```

The builder uses a fresh temporary copy of an explicit source allowlist and a minimal child environment with isolated Wrangler/XDG configuration and cache directories. It excludes root dotenv files, original local databases and `.wrangler/`; it rejects environment files or symlinks inside copied inputs without reading their contents. PDF assets are generated inside the temporary copy. It does not alter the original preview, public Worker configuration or existing `dist/`. Static staging assets receive `X-Robots-Tag: noindex, nofollow`.

Preflight verifies exact resources/variables, generated entry/assets/migration paths and hashes of all build inputs/output. It rejects stale/modified artifacts, placeholders, extra capabilities and protected `auth/login/portal/admin/api/demo/prototype` static assets. Rebuild and preflight after every source/configuration change. A passing local check does not establish remote settings or successful deployment.

The current approved deployment is complete. For a subsequent authorized staging revision, rerun tests/build/preflight and use only the generated staging configuration. The following are the exact target-selection arguments for the authenticated Wrangler CLI; run it in the controlled credential session without reading or logging credential values:

```text
wrangler deploy --dry-run --experimental-provision=false --config dist-staging/server/wrangler.json --env-file /dev/null
wrangler deploy --experimental-provision=false --config dist-staging/server/wrangler.json --env-file /dev/null
```

Inspect the dry-run target/bindings before the second command. Do not use bare `wrangler deploy`, `dist/server/wrangler.json`, the landing Worker name, a deploy-time environment override or experimental resource provisioning. Astro/Cloudflare environment selection occurs during the build. [Astro adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [Cloudflare environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

The owner previously approved the displayed Wrangler consent; CLI login and account lookup succeeded with `account:read`, `user:read`, `workers_scripts:write`, `d1:write` and `offline_access`. Credentials are stored through the keychain and were never read. These scopes are broader than the staging resources, so exact target checks remain necessary. No new grant/login is a routine prerequisite.

## Evidence, next verification and rollback

Local evidence paths such as `output/…` in this document refer to `/Users/aramirez/Documents/Codex/2026-10-10/task/portal-work/output`. These ignored artifacts remain in the isolated workspace and are **not automatically copied to the original source checkout**.

Historical milestones, retained as evidence for their own versions:

- Initial disabled shell: migrations `0001`–`0004` applied; 40/40 live GET cases passed. D1 had 23 tables including migration metadata, 15 indexes and 29 triggers, with all 12 inspected business tables empty. R2 privacy and both public landing origins were verified. Evidence: `output/staging-db-verification.json`, `output/staging-lockdown-verification.json`.
- Authentication-only version `5a697300-bc6e-4eff-b78d-1466f7d5e40d`: 184 unit tests, 113-file check without diagnostics, 11 compiled HTTP groups / 209 requests and 46 live GET checks passed. The owner subsequently completed hosted login.
- Local recovery drill: 10 synthetic SQLite/private-file checks passed; no remote database or bucket was copied/restored. [Recovery evidence and limits](PORTAL-OPERATIONS.md#current-local-synthetic-restore-check--11-october-2026).

The initial remote `0002` migration attempt rolled back on nested `CASE … END` parser handling. A syntax-only rewrite of 18 clauses preserved trigger conditions/messages; schema-equivalence and unit checks passed, then `0002`–`0004` applied successfully. This is completed migration history, not an instruction to retry.

The shared-draft concurrency correction is included in functional version `2da871a0-da6e-482a-8e92-fab00742d1df`. It passed **217 unit tests**, a clean **118-file check**, **10 compiled HTTP groups / 367 requests**, **16 payment groups**, **7 OCR groups** and **48 local concurrency requests**, followed by **47 live unauthenticated GET checks** and the full hosted fictional owner workflow. Presentation release `23dbcd2f-f55d-4009-a949-2550618239b6` then passed **221 unit tests**, a clean **118-file check**, 320 px mobile checks and one-page portrait print preview; no PDF was saved or printed. Its deployment log remains `output/staging-portal-final-deploy.log`.

Previous follow-up `308c8a37-ce96-4a12-b41c-0a6bb1ff332e` fixed revoked-guardian dashboard links and added the favicon. It passed **222 unit tests**, **118 files with zero diagnostics** and a **108-input / 287-output build**, then deployed successfully. Logs: `output/launch-gap-final-{tests,typecheck,build,deploy}.log`. Scoped local role/revocation checks passed **6 groups / 91 requests**, plus **15 post-fix requests** for revoked/restored links; these use local DEV identities and do not establish hosted ordinary-parent access. Independent reviews passed **127 focused tests**, then **56 domain tests** on the delta with no actionable findings.

Previous version `308c8a37` passed **51 post-deployment read-only checks**, recorded in `output/launch-gap-live.log` and `output/staging-portal-live.json`. The presentation version's earlier 51-check log remains `output/staging-portal-live.log`. No redirects were followed, no authenticated session was used and no business mutation was made. The actual void payment/receipt returned 302 to login, its private original returned 401, and root/www independently returned HTTPS 200.

Previous browser version `1a00044c` passed **8 post-deployment anonymous read-only checks** (`output/continuation-read-checks.json`): root/www and `/auth/setup` returned 200, `/portal` redirected to `/auth/admin`, family entry and email administration returned 404, and slip/export APIs returned 401. No redirects were followed and no authenticated request or business mutation was made. `output/continuation-deploy.log` records the successful deployment; `output/continuation-check-evidence.json` links the 228-test, 122-file and 110-input/287-output evidence. Native incognito form checks and the 21-check binary/SQL recovery drill were local synthetic tests, not repeated hosted financial actions or a cloud restore. The initial approval-review denial ran no command; the parent then supplied the user's prior explicit staging authorization and the exact deployment retry succeeded.

The hosted workflow retained pending proof without ledger credit, requested/corrected revision 2, explicitly simulated bank review, issued an immutable receipt, applied credit and annulled the payment. Read-only phase checks confirm restored charge balance and retained audit/receipt/evidence. Original private download matched its stored hash. Email stayed simulated and OCR off. See [workflow evidence](PORTAL-VERIFICATION.md#hosted-fictional-workflow-on-functional-version-2da871a0). The owner-family view does not establish ordinary-parent or multi-user live isolation; repeated/concurrent requests were tested locally, not repeated against the hosted ledger.

If hosted verification fails, restore **authentication-only version `5a697300-bc6e-4eff-b78d-1466f7d5e40d`** on this exact Worker, then verify `/auth/setup` and denial of business routes. Confirm intended secret binding names remain present without exposing values. **A Worker version rollback does not undo D1 schema/data or R2 objects.** Retain fictional records and audit evidence for inspection; do not silently delete them. Coordinated remote D1/R2 restore, off-host backup, performance/usage and complete session lifecycle remain open operational checks.

Historical first cleanup evidence: `output/brevo-transport-cleanup-deploy.log` confirms version `81927314-9d61-4893-8957-41abf881c88d` with unchanged owner/org, existing bindings, `EMAIL_MODE=dry_run`, `OCR_MODE=off` and demo disabled. `output/brevo-cleanup-read-checks.json` records **8/8 anonymous checks**; authenticated owner GET of removed `/admin/brevo-delivery-test` returned 404. A direct SELECT-only audit query preserved four test rows (`output/brevo-single-test-audit-query.json`); no cleanup deletion or financial/outbox write occurred.

That first application attempt had no HTTP status/message ID and remains unknown. Its lookup had no events and filtered dashboard logs showed zero entries at the time. It was not automatically retried. The no-network `workerd` reproduction strongly explains its symptom without proving the actual hosted exception. A later fresh approval produced a distinct accepted message and delivered evidence, without changing the original record. [Controlled test and next approval](BREVO-SETUP.md#controlled-attempt-diagnosis-and-cleanup).

Latest cleanup: `output/brevo-second-cleanup-{build,dry-run,deploy}.log` records restored permanent source and release `cc50f75b-6486-4973-b7db-c8b24475e591`. `output/brevo-second-cleanup-read-checks.json` records **8/8 anonymous checks**; authenticated GET of removed `/admin/brevo-delivery-test-2` returned 404. SELECT-only audit evidence retains ten rows, including the original four unchanged and six for the accepted attempt/two lookups/two observations (`output/brevo-second-test-audit-after-cleanup.json`). No financial/outbox mutation or extra send occurred. The temporary second test's **18 independent tests / 125 clean Astro files / 112-input, 288-output build** are historical, not final cleanup totals. Provider delivery is verified; the owner subsequently confirmed receiving the message.

## Future production on the main domains — proposed only

The main domains are **ajedrezbelen.com** and **www.ajedrezbelen.com**; workers.dev is test-only. No production routing, Worker replacement, real-data import or WorkOS Production setting in this proposal is approved or applied.

1. Prepare a reviewed future build for the existing `ajedrez-belen` Worker, preserving the public landing on both hosts. Route `/portal`, `/admin`, `/auth`, `/login`, `/api`, `/demo`, `/prototype` and descendants through protected Worker handling; never publish protected pages as static assets. Keep demo/prototype unavailable.
2. Recommend **https://ajedrezbelen.com** as the single authenticated origin. Canonicalize authenticated www GET/HEAD navigation before PKCE begins; preserve the public www landing. Reject cross-origin POSTs instead of redirecting/replaying them. Keep host-only session/verifier cookies; callbacks must stay on the configured origin.
3. Proposed WorkOS Production callback: `https://ajedrezbelen.com/auth/callback`; logout: `https://ajedrezbelen.com/`. Register only after explicit approval, with separate Production credentials/cookie secret and approved staff/MFA. WorkOS Staging is for controlled internal testing. Production is already accessible with billing present; approve its exact configuration and private credentials rather than repeating billing entry. No paid custom auth domain is needed. [WorkOS environments](https://workos.com/docs/authkit/environments).
4. Provision distinct production D1/private R2/secrets only after approval. Review migration/recovery, authorization, private caching, origin/cookies, financial workflow, approved wording and real recipient policy before launch. Production deployment and live email remain separate approvals.
