# Portal verification

## Converged source staging release — 428d0d13

**Live staging version: `428d0d13-f1ce-4f59-901e-58c23f0fed34`, 100% traffic**, independently read back on **12 October 2026 at 00:00:42 UTC**. Deployment `e89fcdff-d3aa-4f65-b3a5-964154e6f45d` was created at 23:57:30 UTC on 11 October. The reviewed converged source is now deployed to the existing `ajedrez-belen-portal-staging` Worker. The exact owner and approved Yahoo-parent pins, existing D1/private R2, compatibility settings and secret binding names match the reviewed configuration. Secret values were not inspected. Email remains `dry_run`; OCR remains `off`.

The deployed artifact retains **302/302 passing local tests**, **132 Astro files with zero diagnostics**, **111 build inputs / 288 artifacts**, preflight and **54 independent focused checks**. Those checks preceded release; all 338 non-document source files, full build-input inventory, artifact hashes and unchanged Git index were independently reverified afterward. **18/18 new anonymous live checks passed**, including setup, owner/family login boundaries, API denial, blocked invitation/email/demo/prototype routes and three safe callback-recovery cases.

The two public roots still return direct HTTPS 200. Four diagnostic responses, excluding their sole script element, match the preserved 9,704-byte local landing HTML (SHA256 `86ba74c96b6d01658632b6b36f300b726fb2b06b2c6249ddd99b907970e3122b`). Cloudflare injects a variable challenge script, so raw pre/post response equality is not established. This is an HTML comparison, not a new pixel/asset verification. The initial verification stop was this overly strict comparison, not a demonstrated staging-route failure.

One bounded existing-family-context check at 00:04:17 UTC found no allowed app tab and stopped with **zero requests**. No new authenticated or visual pass is claimed on this version, and no login or logout was started. Earlier owner-confirmed relogin and the eight-check family/revocation/audit/logout results retain their recorded version scope. No migration, record mutation, resource provisioning, external email, production/pipeline change, Git commit or push occurred in this release.

The initial automatic-approval rejection occurred before execution. The same staging-only command was retried once after the exact owner permission was supplied; that retry was approved and completed. This is a resolved historical gate. Evidence: `portal-work/output/converged-staging-release/{deploy,after,live-after,public-diagnosis,family-read-result}.json`. Production actions remain separate.

## Controlled family and callback-recovery release — 694d5c9f

**Historical controlled-family release:** version `694d5c9f-bb32-431b-b9cf-e06b232ce2e5`, deployment `988ee686-e0de-43e4-adce-564027a835d6`, 100% traffic. Fresh readback: **11 October 2026, 22:23:36 UTC**; creation: 20:51:19 UTC. This read changed no deployment. Evidence paths below are relative to the isolated `portal-work/output` directory, not the original checkout.

| Check | Actual result and scope |
| --- | --- |
| Latest candidate | 278 aggregate tests; 129 Astro files with zero diagnostics; 110 source inputs / 287 artifacts; build/preflight; 63 independent focused checks and 10 anonymous live checks. Recorded under `hosted-parent-candidate/output/auth-recovery/`; not rerun for this documentation update. |
| Authentic parent access | At 21:50 and 21:55, eight checks passed each time: own portal 200 before/after, admin/families/export 403, known foreign payment/receipt/original-file generic 404. All private/no-store and noindex. Exactly one approved fictional athlete, three zero totals and zero displayed financial rows. `family-session/initial-isolation-result.json` and `family-session/post-relink-isolation-result.json` under the candidate output. |
| Same-session revocation/restoration | One normal owner-form revoke at 21:53:36; fresh Yahoo reload at 21:54:29 showed zero athletes. Same pair restored once at 21:55:05; fresh same-session reload at 21:55:11 showed the same athlete. No intervening login. `revoked-fresh-view.json`, `relinked-fresh-view.json`. |
| Persisted audit and final access | Exactly enrollment → link → revoke → link for the approved fixture, all owner-actor matches and all guardian targets matching the pinned parent. Both link events record receipt access false; final link visible with the checkbox off. Existing authorized audit export filtered in browser memory; no raw export saved. `revoke-relink-audit.json`. |
| Logout | Native Salir at 21:56:47 returned to the clean landing; portal required authentication and admin API returned 401. `logout-result.json`. This proves application-session logout, not every provider/device session. |
| Final private relogin | Owner confirmed at **22:20 UTC** that the athlete returned (message `Sentinel_a8d7ecdf07a88191aadce95772da5872`). Subsequent bounded nonnavigating checks could not find an allowed app page in the existing controlled context and stopped with zero requests. Record as **owner-confirmed**, not a new independent eight-check pass. No new logout/login cycle or private-auth inspection followed. |
| Independent review | Read-only reviewer verified saved isolation, fresh-render, audit and logout evidence and guarded scripts. One-sided hosted denial is established; **a symmetric second non-admin parent flow remains untested live**, with reciprocal synthetic coverage recorded separately. |

The final link remains active, historical receipt access false, financial mail dry-run and OCR off. This phase created no charges, payments, receipts, uploads, invitations or financial emails. Zero displayed rows is not a global database-count assertion. The approved enrollment/link/revoke/relink audit remains intact. `relinked-fixture.png` is a synthetic main-panel capture with a narrow right-edge screenshot crop; it is not complete viewport/layout validation. The callback recovery UI is deployed; the earlier OAuth-state-loss cause remains unverified.

The valid earlier private recovery bundle is a **dated logical-D1/reused-original** capture; it predates these new family/audit records. It does not close fresh R2 retrieval, off-host backup or isolated cloud-restore rehearsal. No further diagnostic email or login handoff is required to restate completed checks. [Remaining launch gates](LAUNCH-CHECKLIST.md#essential-remaining-launch-gates).

## Converged portal source — verified and deployed to restricted staging

The actual checkout now includes the deployed parent-login and callback-recovery behavior **together with the financial configuration guard**. A reviewed 22-file merge reconciled the isolated source; all unrelated premerge files and the Git index remain unchanged. Recovery copies, before/after hashes and the complete premerge source inventory are retained under `portal-work/output/source-convergence`. All 333 deployed-baseline files are present; the 16 deliberate differences are the financial guard. The combined source matches the reviewed guard candidate except for the independently reviewed resolver/test composition that holds incomplete parent configuration.

**Final combined-source checks:** **302/302 tests** (297 application + five offline backup diagnostics), zero failures/skips; **132 Astro files with zero errors/warnings/hints**; build **111 inputs / 288 artifacts** and preflight passed; independent focused regression **54/54**. The clean verification snapshot matches installed application source. Earlier 261-test and 295-test counts describe earlier integration/candidate states. The initial build snapshot omitted the unchanged staging Astro config; it was restored before the successful build. No commit, push, external access retry, login loop or provider message occurred during source convergence. The subsequent approved staging deployment is recorded above.

Normal financial operation still requires approved payment/receipt values and exact `PORTAL_BUSINESS_CONFIG_APPROVED=true`; the default remains false. Parent staging requires complete canonical email and distinct immutable-ID configuration, then separate authenticated identity, role and family checks. Partial/enrollment-only pins cannot enable collection. The guard preserves historical receipts, corrections, rejection, credit and void behavior and deferred-upload recovery; receipt upload never confirms bank funds.

Confirmed **SINPE Móvil 8768-6102** needs **no IBAN** and provides no bank access or money movement. Holder and receipt identity, opening balances and sibling-discount handling remain pending. All explicitly authorized admins may confirm actual bank funds with actor audit; Walter's intended role does not grant access. The holder decision is an organizational approval gate, not a separate runtime field.

**The local source-divergence gate is closed and the combined source is deployed to staging as `428d0d13`.** The current release section records the new readback/anonymous checks and the unavailable authenticated recheck. Use the explicit reviewed staging configuration for staging; a production target/configuration and public pipeline change still require the decisions in [production preparation](PRODUCTION-RELEASE-PREPARATION.md). Financial mail remains dry-run and OCR off. [Recovery limits](PRIVATE-BACKUP-RECOVERY.md).

<a id="launch-readiness-follow-up--local-changes-11-october-2026"></a>

## Historical launch-readiness release — d0507041, 11 October 2026

The preceding 16-file implementation/test/documentation batch was hash-verified into `/Users/aramirez/Code/ajedrez-belen`; the Git index remained unchanged with zero staged files. No commit or push was made. The subsequent owner-approved staging deployment is recorded below. Private evidence stays in the isolated `portal-work/output` directory.

**Historical staging release: `d0507041-4b53-4ba3-b407-fa6cba4fb7fd`.** After the owner directly approved the reviewed staging deployment with email off and the private D1/R2 capture including identity/email records, deployment succeeded (`output/launch-readiness-approved-deploy.log`). Readback confirms deployment `0d279da8-d66d-4d2c-8857-4bba44dcc540`, version `d0507041-4b53-4ba3-b407-fa6cba4fb7fd`, **100% traffic**, created **2026-10-11T17:54:33.263929Z** (`output/launch-approved-deployment-readback.json`). Independent review reconfirmed unchanged source/artifact hashes and exact owner-only bindings. The same source retains **243 passing tests**, **124 clean Astro files** and the **110-input / 287-output build/preflight** evidence; no new aggregate rerun is claimed. The earlier approval-review rejection ran no deployment and is now a resolved historical gate. Previous cleanup `cc50f75b-6486-4973-b7db-c8b24475e591` remains a historical staging rollback candidate, not the active release.

The owner confirmed receipt of the earlier authorized Brevo message. That diagnostic is complete; automatic email remains `dry_run`, OCR remains off and no further message was sent. The parent-access fixes below are now deployed. The private logical-D1/referenced-file recovery bundle passed independent complete verification with the provenance and limits below.

| Area | Verified now | Remaining gate |
| --- | --- | --- |
| Parent access | Revocation atomically expires matching pending invitations; redemption checks the active account/current email at commit and audits only its winning claim. Logout clears a queued refresh cookie before SDK deletion. **243/243 aggregate tests**, **124 Astro files with zero diagnostics**, **110-input / 287-output isolated build and preflight**; independent read-only reviewer passed **68 targeted tests**. | These fixes are deployed. Previous-address/historical invitations are not backfilled. An approved distinct parent identity and scoped access are needed for hosted callback/refresh/logout, cross-family and invitation tests. |
| Recovery | Private bundle **`output/private-capture-BpmOGW/report.json` passed independent complete verification**: 23 application/migration tables, 41 rows, four migrations, one referenced original and zero unavailable files; schema, local integrity/foreign keys, typed rows/rowids/counters and equal before/after D1 snapshots passed. Zero remote writes requested. Helper **15/15 independent tests** and workerd compatibility passed; the separate synthetic replay drill remains **27/27**. | The original was **reused from a previously authenticated download**, matched to current D1/UI key, size and SHA; **no fresh R2 download**. Direct R2 CLI permission remains unresolved. Independent verification also confirmed file permissions and unchanged bundle inventory; native export, cloud restore, unknown/orphan objects, R2 HTTP/custom metadata and off-host backup remain outside this result. |
| WorkOS MFA | Staging MFA **Optional** and the existing one-member organization **MFA Required** were saved at about 17:36 UTC; the required organization policy was rechecked. The owner confirmed private enrollment, and non-secret user details show Active, verified and **One-time password (TOTP)** under Multi-factor Authentication. | Enrollment is established; a fresh challenge, cancelled-enrollment denial and recovery have not been tested. No QR code, seed or recovery code was accessed by the agent. Production/global Required and SSO policies were not changed. |
| WorkOS Production | Production is accessible and billing information already exists. No key, setting or billing change made. | Approve exact production configuration/private credential handoff; do not repeat billing entry or purchase an add-on. |
| Cloudflare Free | Dashboard shows Workers **Free / $0**, **383 / 100,000 requests today**, **1.09k ms aggregate CPU**, **$0 billable usage so far** in the displayed period (23 September–23 October). | This dated aggregate view does not establish representative per-request CPU, D1/R2 headroom, a billing cutoff or future zero cost. |
| Public-site build integration | Read-only logs establish compilation succeeded, then deployment failed on placeholder D1 ID (API 10181); that historical build created prototype R2 bucket `ajedrez-belen-prototype-slips` first. Main-branch builds remain enabled (`*` paths), `npm run build` / bare `npx wrangler deploy`. Public active version **6c49cb5b**, commit **89b1989**, still serves 100%; failed build created no version. | Do not retry or merely replace the D1 ID: review an exact public build/configuration with automatic provisioning disabled. No public retry, setting change or bucket cleanup was performed. |
| Business handoff | [Pamela/Walter checklist](LAUNCH-CHECKLIST.md#information-to-confirm-with-pamela-and-walter) covers receiving bank, receipt identity, authority, sibling discount and retention/recovery. | Record association decisions; no contact, real-data import or invented discount rule. General receipt email activation remains a separate approval. |

The **post-deployment anonymous probe passed 8/8 checks** (`output/launch-approved-live-read-checks.json`), without business mutations. The existing owner admin browser was reloaded successfully: fictional balance **₡12,000**, zero pending and the voided payment unchanged; no financial action was taken. This existing-session read does not establish a fresh MFA challenge. The earlier 17:31 UTC pre-MFA probe remains separate historical evidence in `output/launch-followup-live-read-checks.json`.

Evidence in the isolated workspace: `output/launch-readiness-{tests,typecheck,build,preflight}.log`, `output/launch-readiness-account-checks.json`, `output/launch-readonly-capture-known-original-tests.log`, `output/launch-readonly-capture-workerd-result.json`, `output/private-capture-BpmOGW/report.json` (independently verified logical D1 and referenced file bundle), `output/launch-capture-independent-complete-verification.json`, and `output/restore-drill-DhoaBt/report.json` (independent repeat of `restore-drill-LF56Gp`). The new browser check is limited to the existing owner admin reload above; earlier financial/mobile/print evidence retains its version scope. Exact [MFA handoff](WORKOS-SETUP.md), [private recovery capture](PORTAL-OPERATIONS.md#private-hosted-to-local-capture) and [launch approvals](LAUNCH-CHECKLIST.md) are prepared. The approved Staging MFA policies and reviewed Worker release are applied, and owner enrollment is confirmed. No production, billing, membership/access grant, financial record or email change was made. Fresh MFA challenge/recovery remains separate. The authorized local recovery bundle passed; fresh R2 retrieval and cloud/off-host recovery remain separate operating gaps.

<a id="latest-staging-continuation--deployed"></a>

## Historical cleanup deployment — version cc50f75b

**Historical cleanup `cc50f75b-6486-4973-b7db-c8b24475e591` was deployed** (`output/brevo-second-cleanup-deploy.log`). The newly authorized controlled message was **accepted and reported delivered by Brevo**. The owner subsequently confirmed receiving the controlled message. The original unknown claim remains untouched, and the successful message used a separate durable claim and fresh exact-one-message approval. No queue or financial-outbox processing occurred.

| Evidence | Confirmed result and scope |
| --- | --- |
| New accepted attempt | Exactly one application send under the new approval: **2026-10-11 13:01:03.403 UTC**, **HTTP 201**, provider message ID retained privately. Same approved nonfinancial payload/sender/recipient; no automatic retry. |
| Delivered event | Second of two targeted lookups returned **HTTP 200** with a matching delivered event at **13:01:05 UTC** (provider timestamp `2026-10-11T07:01:05.000-06:00`), observed at **13:02:30.393 UTC**. The first lookup had not yet shown delivery. |
| Independent dashboard observation | Refreshed Brevo logs showed **Sent and Delivered**, matching the approved subject, sender, recipient and unique test tag; display **11/10/2026 07:01**. Earlier empty dashboard observations are superseded for the new message. |
| Temporary test verification | Version `392a1fc3-a565-403b-97bb-4b7fff7f92b8`, route `/admin/brevo-delivery-test-2`: **18 synthetic tests independently passed**, **125 clean Astro files**, **112 inputs / 288 outputs**. These counts belong to the temporary test, not the final cleaned source. |
| Final cleanup/build | Temporary route/module/test removed; **110 inputs / 287 outputs**, preflight and dry-run passed. Logs: `output/brevo-second-cleanup-{build,dry-run,deploy}.log`. All **110 final source hashes match** the already-reviewed/tested permanent code (tool `f95cdb`). The earlier **231-test / 122-file** results apply to that identical code; no new aggregate/typecheck rerun is claimed. |
| Live cleanup checks | **8/8 anonymous checks passed**, `output/brevo-second-cleanup-read-checks.json`; both public roots remain direct HTTPS 200. Authenticated owner's fresh GET of removed `/admin/brevo-delivery-test-2` returned **404**, and the temporary tab was closed. Scoped Sent/Delivered logs remained visible. |
| Retained audit | SELECT-only verification found **10 rows**: the original **four rows byte/value-identical**, plus **six new rows** (one claim, one accepted result, two lookups, two observations). `output/brevo-second-test-audit-after-cleanup.json`. No deletion or financial/outbox write. |

`output/brevo-second-test-evidence.json` retains the restricted message evidence; personal recipient and raw provider ID are not copied into checked-in docs. All evidence remains under isolated `/Users/aramirez/Documents/Codex/2026-10-10/task/portal-work/output`. The fixed sender/provider path is verified for this controlled message; general live receipt delivery was not enabled. Exact owner/organization, DB/private R2, encrypted Worker Secret, global `EMAIL_MODE=dry_run` and `OCR_MODE=off` remain unchanged.

Both single-attempt approvals are consumed. **No further send is required for this test or permitted under those approvals.** The owner subsequently confirmed receipt. Any additional send would require fresh approval; no production, real-record, MFA or OCR change follows from this result. [Brevo handoff](BREVO-SETUP.md).

## Historical first controlled attempt and cleanup — version 81927314

**The first cleanup version `81927314-9d61-4893-8957-41abf881c88d` was deployed** at the existing staging Worker (`output/brevo-transport-cleanup-deploy.log`). The owner-installed encrypted `BREVO_API_KEY` Secret is confirmed; values were never inspected. Global email remains `dry_run`, OCR off, with the same exact owner/organization and existing D1/private R2. The temporary controlled-test route, module and test were removed; retained evidence does not constitute another send capability.

| Check | Confirmed result and limit |
| --- | --- |
| Exact one-message scope | The user approved one fixed nonfinancial message from `no-reply@ajedrezbelen.com`, subject **PRUEBA — Portal de pagos Ajedrez Belén (sin validez financiera)**, to one owner-approved mailbox. Personal recipient retained only in restricted local evidence. |
| Application attempt | Exactly **one**, at **2026-10-11 12:41:19.076 UTC**: `status=unknown`, `httpStatus=null`, `messageId=null`. **No retry or second send.** Application invocation does not prove a request reached Brevo. |
| Status lookup | At **12:41:32.434 UTC**, returned a null HTTP status and empty events. This was a lookup, not another send. |
| Provider dashboard | Refreshed logs filtered to the exact approved mailbox and 11 October 2026 showed **zero entries**. This supports investigation but establishes neither acceptance nor definitive non-delivery. |
| Transport diagnosis | Independent network-free reproduction in real `workerd` deterministically threw a `TypeError` for `redirect: 'error'` before transport; manual mode worked. Strong explanation, **not direct proof of the hosted exception**. |
| Permanent correction | Both email helpers use `redirect: 'manual'`; redirects are not followed and 3xx results are unknown/non-retryable. **39 focused tests passed.** No live resend was used to validate the correction. |
| Cleanup verification | **231 aggregate tests**, **122 Astro files with zero issues**, **110 inputs / 287 outputs**; successful cleanup deployment. The prior browser/financial/restore milestones below retain their separate scopes. |
| Post-cleanup anonymous routes | **8/8 passed**; `output/brevo-cleanup-read-checks.json`. Public roots still direct HTTPS 200; existing staging access boundaries remain intact. No authenticated requests, redirect following or business mutations in this probe. |
| Removed authenticated route | Native Chrome with the verified owner freshly requested `/admin/brevo-delivery-test` and received **404 Not Found**. The temporary tab was closed; scoped Brevo logs remained visible. |
| Retained audit | Direct **SELECT-only** query for the exact email-test entity returned **four rows**: claim at **12:41:18.927 UTC**, unknown result at **12:41:19.076 UTC**, one status lookup and one empty observation. `output/brevo-single-test-audit-query.json`. No audit deletion, financial/outbox write or second send in cleanup verification. |

Attempt evidence is `output/brevo-single-test-evidence.json`; private archived test artifacts remain in `output/brevo-single-test-artifacts/`. All `output/…` references mean the isolated `/Users/aramirez/Documents/Codex/2026-10-10/task/portal-work/output` directory, not automatically copied source files. The historical financial outbox's zero provider IDs/live-budget attempts remain its own milestone; this standalone test did not process receipt backlogs.

**At this first milestone, acceptance and delivery were unverified.** Its unknown claim remains unchanged; the later separately approved message and its outcome are recorded above. No general live-email mode, real records, production deployment, MFA change or OCR operation followed from this single-message approval. [Brevo readiness and next handoff](BREVO-SETUP.md).

## Historical browser continuation — version 1a00044c

**Browser release `1a00044c-276e-4daf-bc7b-b2746544ade7` deployed successfully** at `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev`. It fixes two browser behaviors: a new payment must allocate a positive amount to a monthly charge, and upload 401/403 responses show specific session/access guidance with a manual sign-in link opening a new tab and an explicit retry. Recovery preserves the original form's selected file, amount and bank reference. Previous version `308c8a37-ce96-4a12-b41c-0a6bb1ff332e` retains its distinct 222-test milestone below.

| Check | Confirmed result and scope |
| --- | --- |
| Aggregate unit tests | **228/228 passed**; `output/continuation-unit-tests.log`. |
| Astro diagnostics | **122 files, zero errors/warnings/hints**. `astro check` from `portal-work` under a minimal environment completed with exit 0 in tool chunk `8d5aea` (4.58 seconds). Metadata: `output/continuation-check-evidence.json`; no standalone log or rerun claimed. |
| Staging build/preflight | **110 inputs / 287 outputs**, passed; `output/continuation-staging-build.log`. |
| Deployment dry-run | Passed; `output/continuation-deploy-dry-run.log`. No deployment is implied. |
| Authorized deployment | Exact authorized retry succeeded, exit 0; version **`1a00044c-276e-4daf-bc7b-b2746544ade7`**. `output/continuation-deploy.log` confirms the same owner/organization, existing DB/private R2 bindings, `PORTAL_DEMO=false`, `OCR_MODE=off` and `EMAIL_MODE=dry_run`. Existing staging Worker/URL; no new app-code changes between dry-run and retry. |
| Independent focused review | **6/6 tests passed**, no actionable findings; reviewer tool chunk `383742`. |
| Synthetic local recovery | **21 checks passed**, binary/WAL backup plus SQLite SQL export/import, private-file hashes and negative controls; **zero network calls**. `output/restore-drill-mPfSb3/report.json`; [recovery scope](PORTAL-OPERATIONS.md#current-local-synthetic-restore-check--11-october-2026). No D1/R2 capture or restoration was performed. |
| Native incognito browser | A zero allocation blocked submission. Changing it to **₡9,000** against a **₡12,000** transfer cleared the error and showed **₡3,000 credit**; resetting it to zero restored validation. An expired synthetic session returned upload **401**; manual new-tab sign-in and explicit retry returned **201**, with PDF, amount and reference preserved. No-selected-adult administration showed guidance and a disabled submit. `output/continuation-native-form-checks.json`. |
| Native checks corroboration | Local server/source/database evidence: **16 logged requests**, upload statuses **401 → 201**, **zero payment POSTs**, **zero 5xx**, seven source files matched, **one unsubmitted fictional draft** under normal one-hour expiry. `output/native-allocator-upload-evidence.json`. Incognito closed and isolated port 4334 stopped; ordinary Chrome cookies and original port 4322 unchanged. |
| Pre-deployment anonymous live checks | **8 passed** against the prior hosted release and public roots; preserved as `output/continuation-read-checks-before-deploy.json`. No authentication, redirect following or business mutations. |
| New release's post-deployment route checks | **8/8 passed**, exit 0 (tool chunk `498e5a`); `output/continuation-read-checks.json`. Root/www direct HTTPS 200; `/auth/setup` 200; `/portal` 302 to `/auth/admin`; `/portal/acceso` and `/api/admin/email` 404; `/api/portal/slips` and admin payments export 401. No authenticated requests, redirect following or business mutations. This does not repeat the local native-browser workflow. |

Browser recovery exercised **401**; **403** guidance and restricted-staging link selection were verified by focused unit tests and independent review. No actual WorkOS parent/session refresh, live OCR/email, hosted financial write or full accessibility certification was tested. Disabled SSR attributes were inspected; JavaScript-disabled interaction was not separately exercised. The native retry created only an unsubmitted synthetic local draft, not a financial payment.

**Earlier approval rejection resolved:** automatic approval review initially rejected the Worker update because the original user scope prohibited deployment and superseding authorization could not then be validated. That denied attempt ran no command and changed no hosted state. The user's earlier explicit staging-approval transcript was subsequently supplied; the exact retry was authorized and deployed successfully. No production activation, real records, live email/OCR or unrelated account change was authorized by that retry.

## Prior owner-only staging milestone — version 308c8a37

Local evidence paths such as `output/…` in this document refer to `/Users/aramirez/Documents/Codex/2026-10-10/task/portal-work/output`. These ignored artifacts remain in the isolated workspace and are **not automatically copied to the original source checkout**.

**Previous version `308c8a37-ce96-4a12-b41c-0a6bb1ff332e` was deployed** at the same staging URL. It fixed revoked-guardian dashboard links and added the favicon; financial mutations and authorization boundaries were unchanged. Hosted owner login and the complete fictional payment workflow passed on functional version `2da871a0-da6e-482a-8e92-fab00742d1df`. Presentation version `23dbcd2f-f55d-4009-a949-2550618239b6` passed 320 px mobile and one-page portrait print-preview checks; no PDF was saved or printed. This historical evidence does not claim repeated hosted financial or print tests on later versions.

The user authorized only the sole owner's controlled fictional hosted workflow, with email dry-run and OCR off. No real bank transaction, student/family roster, production activation or live provider email was used. Exact resources, owner/organization, completed private setup and remaining gates are in [SETUP-HANDOFF.md](SETUP-HANDOFF.md).

| Check | Confirmed result and scope |
| --- | --- |
| Milestone unit suite | **222 passed**; `output/launch-gap-final-tests.log`. Presentation version passed 221; functional version passed 217. |
| Milestone Astro diagnostics | **118 files**, zero errors, warnings or hints; `output/launch-gap-final-typecheck.log`. |
| Milestone deployment | Successfully deployed version `308c8a37-ce96-4a12-b41c-0a6bb1ff332e`; `output/launch-gap-final-deploy.log`. |
| Milestone staging build/preflight | **108 inputs / 287 outputs**; `output/launch-gap-final-build.log`. |
| Compiled owner-only boundaries | Functional version: **10 groups / 367 requests passed** on loopback with unusable synthetic WorkOS fixtures; no valid cookies or authentication bypass. |
| Synthetic local financial workflow | Functional version: **16 payment HTTP groups passed**. Repeat/idempotency coverage is local, separate from hosted UI evidence below. |
| Synthetic upload/OCR | Functional version: **7 HTTP groups passed**, no external OCR request. |
| Shared-draft concurrency regression | Functional version: **48 local concurrent requests passed** after correction. No hosted concurrent mutations were used. |
| Milestone live unauthenticated checks | **51 post-deployment read-only cases passed**; `output/launch-gap-live.log` and `output/staging-portal-live.json`. Actual void payment/receipt returned 302 to login; private original returned 401; forbidden entry/email/invitation/demo routes blocked; root/www independently HTTPS 200. No redirects followed, authenticated session or business mutations. Presentation-version baseline was 51 cases; functional-version baseline was 47. |
| Local role/session boundaries | **6 groups / 91 HTTP requests passed**, including **30 ordinary-user export denials**, existing-cookie guardian revocation and inactive-account denials. **15 post-fix requests passed** for revoked/restored links without new financial records. Scope and evidence below. |
| Independent review | Complete financial/access/configuration review: **127 focused tests passed**. Subsequent six-file delta: **56 domain tests passed**. No actionable findings or reviewer implementation; `output/independent-launch-review.json`. |
| Hosted owner session/workflow | Owner login, administrator UI and the normal-UI fictional payment sequence below passed on the functional version. The family view used that same owner's legitimate guardian link, not a separate parent session. |
| Milestone hosted owner read checks | On `308c8a37`, the existing verified owner opened `/portal`: **₡12,000 balance, zero pending, zero credit**, with available detail/receipt links. The existing voided payment detail and receipt **AB-2026-000001** opened with **PRUEBA + ANULADO**. Read-only; no new financial actions. Browser restored to desktop with DevTools closed. |
| Local recovery drill | Expanded run **21 checks passed** at `output/restore-drill-mPfSb3/report.json`, with `recovery-manifest.json`; previous binary-only milestone passed 10. Synthetic SQLite/files only, no remote restore. [Scope](PORTAL-OPERATIONS.md#current-local-synthetic-restore-check--11-october-2026). |
| Presentation milestone mobile/print | On version `23dbcd2f`, native Chrome at **320 × 844**: receipt table fully visible with wrapped content, no observed clipping; administrator overview, payment form fields and navigation fit. Earlier **390 × 844** receipt/admin-review checks also fit. Portrait Save as PDF preview showed **one page** with financial details, PRUEBA/ANULADO and footer. No PDF saved or printed. |
| Visual evidence record | `output/staging-visual-final.json` records the presentation milestone's desktop/320 px/390 px/print observations and limits. Browser was then left on `/admin` desktop with DevTools closed. |

The intermediate presentation release exposed a second print page from the receipt footer and tight 320 px table padding. Staging-only CSS and one regression test corrected both before presentation version `23dbcd2f`. Native screenshots/print preview were observed in the task. Two Chrome `runtime.lastError` message-port warnings appeared on the scriptless receipt (no application JavaScript, CSP scripts disabled); their source was not established, and no zero-console-warning claim is made. These spot checks are not complete accessibility or cross-browser certification.

Independent review found the shared-draft concurrency false-failure case before the functional deployment; its correction/regression checks are included. Earlier “no findings” reviews cover their own snapshots, not all later changes.

Source preservation at the preceding presentation milestone: the 46-file implementation/documentation batch was hash-verified into `/Users/aramirez/Code/ajedrez-belen`; the cumulative continuation manifest recorded 82 affected files across all phases. The original Git index stayed unchanged (zero staged files), `git diff --check` passed and a second comparison reported zero remaining differences. No commit or push was made. This preservation note was synchronized in a subsequent documentation-only pass; it does not certify copy-back of the current follow-up. The isolated QA server on port 4334 was stopped; the user's original port 4322 was untouched.

Hosted callback/logout are **Default**, local URLs remain registered, sole owner membership is **Active**, and both private WorkOS Secret bindings are installed. Values were never read. At that historical milestone, organization membership required invitations and MFA read **Not required**. The later owner-approved Staging policies are now Optional / organization Required, as recorded above; owner enrollment is now confirmed; a fresh challenge remains untested. Global Sign-up was observed enabled; organization invitations and the separate owner gate still restrict staging business access.

At that historical milestone, Brevo domain/sender and a local key shape check were complete; the Worker Secret and controlled attempt came later, as recorded above. Global dry-run remains enforced. No production routing or WorkOS Production setup is applied.

### Local role and revocation follow-up on version 308c8a37

`output/family-session-coverage.json` and `output/family-session-boundaries.log` record **6 groups / 91 HTTP requests** using supported local DEV identities: administrator, parent A, parent B sharing an athlete, and an unrelated parent. These establish application enforcement using synthetic sessions, not a WorkOS provider roundtrip.

| Local check | Result |
| --- | --- |
| Parent B independently submits for shared athlete | Passed; sibling/unrelated identities stay scoped. |
| Shared balances, separate private evidence | Passed; both linked guardians see applicable balances while receipt, private original and email remain bound to the authorized payment participant. |
| Ordinary-user exports | **30 denials** across CSV/JSON export kinds; administrator-only financial export remains enforced. |
| Existing-cookie guardian revocation | Current athlete details and receipt access denied. Active uploader retains their own summary/raw proof by existing policy. |
| Inactive parent | Private pages, original, upload, replay and self-reactivation denied using the existing session. |
| Inactive administrator | Admin entry and **10 export requests** denied. |

The 91 requests included 49 responses with status 403, 10 with status 404 and no server errors. They exposed unavailable dashboard links after guardian revocation, although direct detail/receipt routes correctly denied access. The deployed fix derives link availability from the existing access predicate, hides current athlete data/unavailable links and restores working links after an authorized relink. A focused **15-request follow-up** passed without new financial records: `output/family-revocation-links.json` / `.log`. Direct-route restrictions are unchanged. Link revocation intentionally preserves an active original uploader's own raw proof; account deactivation denies that original-file endpoint too.

An independent reviewer made no code changes and reported no actionable findings across financial concurrency/idempotency, fee/month publication, submission retry, immutable receipts/recipients/contact repair, roles/private files and staging configuration; **127 focused tests passed** on the pre-follow-up snapshot. The same reviewer then checked the six-file delta, including the shared access predicate, SQL binding order, strict dashboard flags, receipt links and favicon; **56 domain tests passed**, with no actionable findings. `output/independent-launch-review.json` records both scopes and snapshot distinctions.

Two empty local sign-in previews were saved to Library; both creation results succeeded. `output/handoff/library-artifacts.json` records the exact artifact paths and IDs:

| Preview | Library path | Library file ID |
| --- | --- | --- |
| Desktop | `/Ajedrez-Belen-local-entry-desktop.png` | `libfile_f9c53d0ecb788191aac232b8207fed80` |
| Mobile | `/Ajedrez-Belen-local-entry-mobile.png` | `libfile_e5c973c19f408191a0fd6f9c774d2e01` |

These previews contain no personal/payment records and show local public entry only; hosted public family entry remains blocked. No actual parent WorkOS login, invitation, staff-role change, MFA challenge, hosted multi-user test, provider delivery or remote recovery was performed in this follow-up. The deployed portal remains sole-owner only with email `dry_run` and OCR `off`.

### Hosted fictional workflow on functional version 2da871a0

All mutations used the normal UI under the sole owner. D1 evidence queries were read-only; they verified outcomes without creating financial records.

| Phase | Verified outcome |
| --- | --- |
| Fixture | Fictional athlete `PRUEBA20261011`, one October charge of **₡12,000**, and one synthetic **1,021-byte PDF**. |
| Pending proof | Declared **₡15,000**, requested allocation **₡10,000**. No verified payment, ledger allocation, receipt or email row was created by upload. Evidence: `output/staging-portal-pending-ledger.json`; verification query `rowsWritten=0`. |
| Correction | `pending → needs_info → corrected revision 2`; original retained and two submitted revisions preserved. |
| Explicit simulated bank review | Required independent-bank checkbox completed for this fictional test. **₡15,000** confirmed synthetically, **₡10,000** allocated, **₡5,000** credit; receipt **AB-2026-000001** issued. Evidence: `output/staging-workflow-verified.json`. |
| Credit application | Applied **₡2,000**: charge covered at **₡12,000**, remaining credit **₡3,000**. Evidence: `output/staging-workflow-credit.json`. |
| Annulment | Payment/receipt void; effective applied funds returned to **₡0**, charge balance **₡12,000**. Retained **1 payment**, **1 charge**, **2 allocation-history rows**, **1 receipt**, **1 original**, **2 revisions**, **9 audits**, **1 financial operation**. Evidence: `output/staging-workflow-void.json`. |
| Email safety | Original receipt processed only in dry-run, then cancelled on void; one void notice remains `dry_run`. **0 provider IDs and 0 live-budget attempts**. Internal simulated processing/attempt counters are not provider requests. No email/OCR sent. |
| Private file UI | One-page preview rendered; Escape closed it and returned focus to its button. Full original downloaded through the authenticated UI and matched its stored size/hash. Evidence: `output/staging-original-download.json`. |

Receipt snapshot SHA-256 stayed identical at verification, credit application and void:

```text
8485046843c482a7c0976ad9592c0d5930931a10ae617decf63359e050b1d520
```

Downloaded original SHA-256, **1,021 bytes**:

```text
0f6fcccd6c92689afa23c95acc08a87d1878f02c9363eadebf9cd76d17f835b6
```

This establishes the stated owner-only hosted workflow with fictional records. It does not prove live bank reconciliation, a separate ordinary-parent/wrong-user session, multi-user isolation, hosted duplicate/concurrent requests or provider delivery. Concurrency/repeated-request protection was exercised in local tests.

### Remaining evidence and operating limits

Final mobile/print evidence is recorded above. The browser showed two runtime message-port warnings on the scriptless receipt, so an error-free console is not claimed. Full session refresh/revocation/logout coverage, broader accessibility/browser coverage, ordinary-parent/wrong-user end-to-end access, general live receipt/outbox delivery (the later controlled message has verified provider acceptance/delivered evidence and owner-confirmed receipt), request CPU/quota measurement and coordinated remote D1/R2 restore remain distinct checks.

Rollback target: authentication-only `5a697300-bc6e-4eff-b78d-1466f7d5e40d`. A Worker rollback does not undo D1 schema/data or R2 objects; retain the synthetic financial/audit evidence.

## Historical authentication-only milestone — 11 October 2026

For version `5a697300-bc6e-4eff-b78d-1466f7d5e40d`: **184 unit tests passed**, **113-file Astro check** had zero diagnostics, **11 compiled HTTP groups / 209 requests** and **46 live GET checks** passed. Business routes were disabled, including `/login` and variants. The owner subsequently completed hosted sign-in. These results describe the authentication-only version, not the new payment mode.

Restarting `/auth/admin` intentionally clears the local session before starting fresh PKCE. The known forced-logout tradeoff grants no access and changes no financial data.

## Historical initial Cloudflare rollout — 11 October 2026

The exact approved resources were created in account `7d3e79129c4f0b3619a419cabbfa021e`: D1 `ajedrez-belen-portal-staging`, UUID `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`; private Standard R2 `ajedrez-belen-portal-staging-slips`; and the separate staging Worker. Existing landing Worker and unrelated `docklet` bucket stayed separate. The owner approved Wrangler consent; identity/scopes were verified without reading credential values.

All four migrations applied. The initial `0002` attempt rolled back on remote nested-`CASE … END` parser handling. A syntax-only rewrite of 18 clauses in `0002`/`0003` preserved conditions/messages; 158 unit tests and schema-equivalence checks including 10 NULL cases passed before the successful remote retry. Do not rerun migration/resource creation as routine setup.

Initial build/preflight: **102 inputs / 283 outputs**; dry-run **364.89 KiB gzip / 212 assets**. Disabled-shell deployment `f2fd0fd3-9bf4-4aed-9911-58e0cad29628`: **364.74 KiB gzip**, **204 new assets**, reported startup **16 ms** (not request CPU). **40/40 live GET checks** passed: root 200/noindex; 39 protected 404s with privacy/security headers and no redirect/cookie. D1 had **23 tables**, **15 indexes**, **29 triggers**, zero rows in the 12 checked business tables, size **360,448 B**. R2 was private and empty; root/www each returned HTTPS 200. These are historical pre-workflow counts.

Evidence: `output/staging-db-verification.json`, `output/staging-lockdown-verification.json`. The then-unconfigured hosted authentication has since been completed; its old local-default/missing-secret observations are superseded by current setup.

## Historical designated-family recipient and recovery milestone — 11 October 2026

This stage implemented self-service mail only to its original uploader; staff-assisted mail to the designated adult's stored authorized account; contact holds without undoing an immutable financial receipt; and deliberate idempotent first-email preparation after repair. Missing accounts/required links still fail closed. Preparation queues/audits but does not send, retarget or revive history, and cannot prepare a void receipt. Current restricted staging blocks its email-administration route.

| Check | Result at this stage |
| --- | --- |
| Unit suite | **158/158 passed**, including real SQLite transactions for contact repair, concurrent preparation, frozen snapshots and existing-history protection. |
| Payment HTTP | **15/15 groups passed**, fresh isolated D1/R2; recipient enforcement, bank review, preparation authorization/origin checks, immutable history, simulated mail, annulment and restored balances. |
| Astro/build | **99 files**, zero errors/warnings/hints; build passed. |
| Compiled authorization | **10/10 groups passed** with synthetic unusable WorkOS values. Additional **120** alternating missing-Origin/same-origin unauthenticated email requests returned **60 × 403** and **60 × 401**, no 500. |
| Independent review | **88 targeted tests passed**, no actionable backend finding in that snapshot; UI note corrected to reflect `canPrepareEmail` gating. |
| Native Chrome | Staff-assisted form showed selected synthetic adult/stored email, pending-bank explanation, contact-hold guidance and separate evidence-sharing control. Screenshot captured in the task. |
| Provider setup | Approved Brevo domain/three DNS records authenticated; DMARC and website preserved; exact no-reply sender verified. Later local key shape correction passed. No email sent. |

**Development transport limitation:** earlier Vite HTTP runs intermittently returned 500 with `Miniflare.dispatchFetch` / internal Undici `fetch failed`, including after denied forms. A 120-request probe reproduced 3 failures with unconsumed responses, 5 with consumed responses and 1 using `Connection: close`. Neither workaround proved a fix. The compiled comparison passed all 120; the full 15-group run then passed without automatic request retry. Authorization was not weakened, no unbounded body draining or dependency patch was added, and the root tooling cause remains unproven. Logs: `output/portal/http-payments-transport-failed.log`, `dev-server-transport-failed.log`, `http-payments.log`, `locked-tests-final.log`.

## Historical uploader and unattended-reply milestone — 11 October 2026

This stage preceded the staff designated-recipient decision; its staff-email hold is no longer the current delivery policy. Footer rendering already marked automated email and linked the official WhatsApp; the approved domain/sender setup was completed later.

| Check | Result at this stage |
| --- | --- |
| Unit suite | **139/139 passed**, including uploader-only issuance, original submitter preservation, staff holds, legacy cancellation, claim/retry races and HTML/text footer. |
| Payment HTTP | **14/14 groups passed** in isolated synthetic state; forged recipient fields rejected as policy inputs, staff receipt issued with held mail, void preserved snapshot/restored balances. |
| Upload/OCR HTTP | **7/7 groups passed**, no external provider request. |
| Astro/build | **99 files**, zero diagnostics; build passed. |
| Independent review | **69 targeted tests passed**, no actionable finding in that snapshot. |
| Native Chrome | Reviewed staff hold in receipt table and automated-message/WhatsApp footer on synthetic void receipt. |

One initial run found residual synthetic state; that state was archived inside the isolated workspace and replaced with fresh migrations. A test assertion was corrected because exports omit internal submitter IDs. The complete corrected run passed; no original records/provider settings changed.

## Historical continuation milestone — 10 October 2026

The isolated copy used fresh synthetic D1/R2 and Node 26.0.0 with explicit minimal shell environment; no original credential files, ledger or private uploads were copied into it.

| Check | Result at this stage |
| --- | --- |
| Unit suite | **126/126 passed**: stale revision/status/review note, concurrent/repeated adjustment/credit UUIDs, changed-payload denial, rollback and decimal-zero allocations. The same-state `needs_info` review-note race was fixed with `expectedReviewNote` and transactional predicates before this result. |
| Astro/build | **99 files**, zero errors/warnings/hints; public static page and Worker build passed. |
| Local payment HTTP | **13 groups passed** on 127.0.0.1:4324: durable IDs/replay, one audit per operation, privacy, pending balances, concurrent confirmation, immutable receipts and voids. |
| Upload/OCR HTTP | **7 groups passed**, synthetic PNG/JPEG/PDF originals/revisions, family-scoped suggestions/access denial; no provider request. |
| PDF library check | Two-page synthetic PDF: first page **2048 × 1228**, **22,513 PNG bytes**, local font/CMap rendering; original unchanged, zero network. |
| Compiled Worker | **10 locked-access groups passed** on 127.0.0.1:4325; missing/denied callbacks linked back to portal access. External authorization URLs were inspected, not followed. |
| Native Chrome responsive | Desktop family dashboard and exact **320 px** payment form; synthetic two-page PDF private save/page-one preview; no observed horizontal overflow. |
| Native Chrome failure/retry | Offline synthetic PDF upload displayed a clear error/retry action; retry after network restoration saved original privately. No payment submitted. |
| Browser Back/simulated OCR | Back restored the selected PDF/two-page preview and entered ₡13,000. Explicit save and simulated OCR kept manual ₡13,000 and zero monthly allocations; no payment submitted. |
| Fresh independent review | **52 targeted tests passed**, no actionable finding in the then-final 29-file continuation; callback retry destination also reviewed. |

Original-local status-only checks returned `/demo` 200 and login 503 from the configuration guard. That diagnosis described that local preview, not current hosted readiness. Broader slow/interrupted-network, keyboard and cross-browser matrices were not established.

The 29-file continuation copy-back was hash-verified with the **114-file staged Git index unchanged**, and `git diff --check` passed. Migration `0004` applied only to original local D1 then; no original ledger/upload was tested. A later **24 follow-up / 47 cumulative file** copy-back was similarly verified, and the hosted-URL handoff recorded **56 cumulative files**. These are dated synchronization milestones, not a current latest-file count.

## Historical initial implementation — 10 October 2026

Fixtures were fictional. Two user-supplied BCR/BAC images were only private, unsubmitted local drafts for storage/form checks; no provider transmission or bank confirmation occurred.

| Check | Result at this stage |
| --- | --- |
| Unit suite | **110 passed**: real SQLite financial transactions, invitations/privacy/concurrency, frozen receipts, email claims/budget/failures, OCR lifecycle, bounded adapter and 13 conservative household-name cases. Provider responses mocked. |
| Astro/build | **106 files**, zero diagnostics; static page and Worker build passed. |
| Payment HTTP | **12 groups passed**: submission/correction, concurrent approval, dry-run receipts, partial allocations/credit/void/balances, access/CSRF/file limits and exact numeric references in CSV/JSON. |
| Upload/OCR HTTP | **7 groups passed**: scoped household names, original ownership/hash/bytes, edited values pending, revisions/extraction history, previews/downloads; no ledger/receipt/mail from reading and no provider request. |
| PDF library | First page of two-page PDF: **2048 × 1228**, **22,513 PNG bytes**, local standard-font/CMap text; zero network and original unchanged. |
| Compiled lock checks | **9 groups passed** with synthetic WorkOS values: hosted demo disabled, forged cookies/private resources denied, OCR denied before work, fixed parent/admin PKCE and origin guards. |
| Browser flows | Native upload/correction/approval to printable receipt and dry-run outbox; prior mobile form fit **375 px** with labelled inputs/clean console. |
| OCR browser behavior | Manual ₡13,000 total/₡1,000 allocation survived the fixed ₡12,000 demo suggestion. Partial-name focus did not change amounts; replacing evidence cleared automatic fields while preserving manual values. Escape closed enlargement and restored focus. |
| Browser PDF/responsive | Two-page PDF rendered readable local Courier/Japanese CMap text, enlarged, retained full original; 375 px viewport fit without horizontal overflow or console warnings. |
| Local schema/preview isolation | Tables/indexes/triggers matched migrations 0001–0003; previous synthetic records preserved. Check/build left preview HTTP 200; separate Vite cache and explicit PDF asset sync. |

Local browser artifacts/logs are retained in ignored `output/portal/`. Historical fixture servers were stopped after use. These checks do not establish actual OCR/provider delivery, current server process state, complete accessibility, deployed CPU or remote recovery. Current setup and remaining gates take precedence over the dated account-status observations.
