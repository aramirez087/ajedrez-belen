# WorkOS setup

## Current verified state — 11 October 2026

At approximately **17:36 UTC**, after the owner’s exact approval and rechecking the sole active member, Staging Authentication MFA was changed **Off → Optional**, then MFA was required only for organization `org_01M4MK3YVA8B4WC0F659G28MCJ`. Both saved states were visibly verified. Global Sign-up remains Enabled. No Production MFA, global Required policy, membership or SSO policy was changed.

**Enrollment confirmed:** the owner reported completing enrollment. A read-only check of non-secret user details shows Active, verified and **Multi-factor Authentication — One-time password (TOTP)**; the organization Required policy was rechecked. The agent did not open, generate, read or capture a QR code, seed or recovery code. A fresh successful MFA challenge, cancelled-enrollment denial and recovery remain untested. The existing owner admin session reloaded after deployment; that is not evidence of a fresh challenge.

Earlier read-only inspection at about 17:00 UTC found MFA Disabled and the organization Not required. Those observations are historical. Production remains accessible (`environment_01M4M8D28MCESFP37FPY1JQEJW`), and team billing already has a payment method. Billing presence is not a spending approval or proof of future zero cost.

Billing was rechecked read-only: **Pay as you go, 11 October–1 November 2026**, next payment due **1 November**, last bill **—**; no itemized usage/estimated total was displayed. No payment details are retained. Published AuthKit pricing includes MFA and the first **1 million monthly active users free**; each additional million is **$2,500/month**, enterprise SSO/Directory Sync start at **$125/connection/month**, and optional custom auth domain is **$99/month**. None of those paid additions was selected; no billing commitment was made in this task. Team billing presence alone is not a hard spending cap. [WorkOS pricing](https://workos.com/pricing), [billing fields](https://workos.com/docs/dashboard/billing).

The approved scope was environment **Optional**, allowing organization-based enforcement, with MFA required only for the existing one-member organization. Environment-wide **Required** would affect all users and was not selected. Organization MFA applies to non-SSO members; IdP/SSO enforcement needs separate verification. [WorkOS organization policies](https://workos.com/docs/authkit/organization-policies).

The latest deployed parent-access correction expires matching pending invitation tokens atomically on revocation, rechecks current account/email during redemption, records one winning redemption audit, and prevents a queued refresh cookie surviving logout. **243 aggregate tests passed**, including the real Astro cookie serialization regression; an independent reviewer passed 68 targeted tests. This unchanged reviewed source is now deployed as `d0507041-4b53-4ba3-b407-fa6cba4fb7fd`; `cc50f75b` is the previous cleanup milestone. Existing historical invitations to previous email addresses are not backfilled. Distinct-parent hosted login, callback/refresh/logout, cross-family denial and invitation lifecycle still require specifically approved test identities and access; the sole owner's family view cannot establish those results.

**Hosted owner authentication and the normal-UI fictional payment workflow are verified.** The browser displayed **“Inicio de sesión verificado”** at `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/setup`. The workflow completed on functional version `2da871a0-da6e-482a-8e92-fab00742d1df`. Previous cleanup version `cc50f75b-6486-4973-b7db-c8b24475e591` preserved the permanent email transport correction and removes the latest temporary one-message test path. Brevo accepted and reported delivery of the separately authorized controlled message; the owner subsequently confirmed receiving the message. Previous browser version `1a00044c-276e-4daf-bc7b-b2746544ade7` added positive monthly-allocation validation and explicit session recovery/manual retry for upload authentication errors. The owner/organization gate and financial authorization are unchanged. Previous version `308c8a37-ce96-4a12-b41c-0a6bb1ff332e` fixed revoked-guardian dashboard links and added the favicon. Presentation version `23dbcd2f-f55d-4009-a949-2550618239b6` passed 320 px mobile checks and one-page portrait print preview; no PDF was saved or printed. Authentication-only rollback: `5a697300-bc6e-4eff-b78d-1466f7d5e40d`.

| Setting | Current value/status |
| --- | --- |
| Application/environment | Existing **Ajedrez Belen’s Project / Staging** |
| Client ID | `client_01M4M8D1P0W2N2WANHTC4SF921` |
| Approved organization | `org_01M4MK3YVA8B4WC0F659G28MCJ` |
| Sole approved owner | `user_01M4MJY2GGNK2GTTH9AYRDTP78`; membership **Active** |
| Hosted callback — **Default** | `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback` |
| Hosted logout — **Default** | `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/` |
| Local callback — registered | `http://127.0.0.1:4322/auth/callback` |
| Local logout — registered | `http://127.0.0.1:4322/` |
| Private Worker bindings | `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` installed by owner; values never read |
| Organization membership policy | “All users must be invited to this organization to become members.” Read-only observation; no policy change. |
| Environment MFA | **Optional**, saved and verified under exact owner approval |
| Organization MFA policy | **Required**, saved and verified for the sole approved organization; owner enrollment confirmed; fresh challenge untested |

No additional member, generated `example.com` organization, email address or WorkOS role label is a substitute for the approved immutable IDs. Organization invitations are required; global AuthKit Sign-up is enabled as observed above. The application's independent owner gate limits this staging test.

## Exact controlled parent test scope — proposed only

An owner opening `/portal` retains administrator privileges. Existing staging blocks ordinary parents at the route gate, callback/setup/logout owner predicate, middleware before database access, and portal authorization. A second identity cannot be tested by just linking an athlete or adding a role label.

The smallest useful approval designates **one owner-controlled Staging WorkOS account/mailbox with verified email and a distinct immutable user ID**, excluded from `ADMIN_USER_IDS` and preferably without staff-organization membership. Normal parent identity does not require an organization. Approve an exact nonstaff tester allowlist and narrowly scoped parent login/callback support while retaining the sole-owner administration policy, dry-run email and OCR off. Separately approve the resulting minimal adult-profile synchronization and one audited fictional athlete link. Do not grant staff access, use impersonation or disable the staging gate. Creating an account, provider verification mail and application invitations must each be within the specifically approved identity workflow; none was performed here.

One nonstaff parent can exercise callback/refresh/logout and deny admin/export/foreign owner-fixture records. Two nonstaff identities linked to disjoint fictional families are required for symmetric family isolation. Test revoked links and inactive accounts using the same session. Active uploaders intentionally retain their own raw proof after link revocation; account deactivation denies it too. Email-bound invitation redemption is a separate permission/test scope from a direct owner-created guardian link.

**MFA distinction:** provider policies are now saved and verified as environment Optional and organization Required; owner enrollment is confirmed and a TOTP method is visible, while fresh challenge/recovery remain untested. The app verifies SDK identity, verified email, no impersonation, staff organization and immutable admin IDs; it has no separate MFA/AMR or financial step-up predicate. Staff protection depends on WorkOS enforcement; a fresh owner challenge still needs verification, rather than inferring it from an app flag or existing successful login. No explicit session-revocation or logout action was performed by the agent.

## Owner-only private staging secrets

**This step is complete. Do not recreate or rotate either secret as part of setup.** The owner privately installed both Secret bindings on `ajedrez-belen-portal-staging` in account `7d3e79129c4f0b3619a419cabbfa021e`, and confirmed a fresh cookie password. Any future recovery/rotation is a separate owner action and can invalidate existing sessions. Inspect binding names/presence only; keep values out of source, arguments, chat, screenshots and logs. [Cloudflare secret configuration](https://developers.cloudflare.com/workers/configuration/secrets/)

Runtime configuration still validates `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD` and `WORKOS_ORGANIZATION_ID`. The cookie password must contain at least 32 characters. The callback must use exactly `/auth/callback`, HTTPS except loopback development, and no credentials/query/fragment. A failed configuration produces a private generic 503 before contacting WorkOS. `ADMIN_USER_IDS` separately controls financial administration. The earlier original-local missing-settings/503 observations do not describe current hosted readiness.

## Approved fictional portal staging

Current release `d0507041-4b53-4ba3-b407-fa6cba4fb7fd` passed the approved deployment and eight anonymous checks; the existing owner admin reload passed without financial writes. The deployed staging policy pins the IDs and callback above and requires `STAGING_AUTH_SETUP=true`, `STAGING_PORTAL_TEST=true`, `PORTAL_ENABLED=true`, `PORTAL_DEMO=false`, both prototype flags false, `EMAIL_MODE=dry_run` and `OCR_MODE=off`. The earlier `cc50f75b` cleanup passed eight anonymous checks and authenticated owner GET of the removed second test route returned 404. Its 110 source hashes match the permanent code already covered by 231 aggregate tests, 39 focused email tests and a clean 122-file check; those historical checks were not rerun after removing the temporary path. The temporary second test separately passed 18 independent synthetic tests and a clean 125-file check. The preceding browser release passed 228 tests; its local demo-session recovery check was not a WorkOS parent/provider lifecycle test. The previous `308c8a37` release passed 222 tests, a clean 118-file check and 51 live read-only checks, including unauthenticated denial of the actual test payment, receipt and private original. The earlier functional version passed 10 compiled HTTP groups / 367 requests and 47 live unauthenticated GET checks, followed by the full owner UI fictional workflow. Financial/OCR/concurrency and version-specific deployment evidence are maintained in [CLOUDFLARE-STAGING.md](CLOUDFLARE-STAGING.md) and [PORTAL-VERIFICATION.md](PORTAL-VERIFICATION.md).

- `/auth/admin`, `/auth/callback` and `/auth/setup` accept GET/HEAD; logout accepts only same-origin POST. The provider flow uses fixed organization/callback configuration, SDK PKCE and encrypted sessions.
- The business gate requires a verified, non-impersonated session with the exact owner and organization before any user synchronization or payment database access. Missing authentication redirects business HTML GET/HEAD to `/auth/admin`; unauthenticated APIs/mutations return 401. A verified wrong owner/organization is denied with 403.
- Only the approved admin/family business paths are available to that owner. Public family login/invitation entry, invitation APIs, email administration, demo, prototype and `/login` stay blocked, including nested/encoded variants. A legitimate stored guardian link lets the same owner test family access; it does not bypass authentication or establish a live multi-user isolation test.
- Business mutations require the exact same-origin `Origin`. Auth/business responses are private and uncached. The SDK manages encrypted HTTP-only cookies, callback state, PKCE, token verification and refresh. Tokens are not serialized to the browser by the application.
- Restarting via `/auth/admin` intentionally clears the local session before fresh login. This known forced-logout tradeoff grants no access and changes no financial data.

The successful owner login proves that hosted callback, installed secrets and the owner’s provider session work together. The subsequent fictional financial workflow has separate recorded evidence. Local application-level checks also passed 6 groups / 91 HTTP requests for administrator, two guardians and an unrelated user, including existing-cookie revocation, inactive-account denial and 30 ordinary-user export denials; a 15-request follow-up verified revoked/restored links. Those supported DEV sessions do not establish WorkOS session refresh/revocation, every provider logout/error path, another user's live denial or MFA enforcement. An owner viewing a legitimately linked family account is not an actual parent/multi-user provider test. The required organization policy and owner TOTP enrollment are established; a fresh challenge and recovery still need verification. Neither real family/payment records nor production are authorized.

The owner separately installed encrypted `BREVO_API_KEY`; two independent exact-one-message approvals changed no WorkOS roles, membership, MFA, callback/logout or owner gate. The first application attempt remains unknown. The later attempt, under a distinct durable claim, received HTTP 201 and matching Brevo delivered evidence; this establishes provider delivery for that controlled message, with owner receipt subsequently confirmed; general receipt processing remains unverified. Both temporary paths were removed; global email remains dry-run and OCR off. No further send is needed for the test; another send would require fresh approval; [Brevo evidence](BREVO-SETUP.md#controlled-attempt-diagnosis-and-cleanup). The two WorkOS secrets above remain distinct from the later Brevo Secret.

## Repeat local verification without provider access

Use the installed dependencies and explicit minimal environment. Unit tests and the staging builder do not require a live account or credential values:

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp npm test
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp npm run check
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node scripts/build-staging.mjs
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node scripts/preflight-staging.mjs
```

`scripts/test-staging-auth.mjs` covers the earlier authentication-only compiled mode; `scripts/test-staging-portal.mjs` covers the owner-only portal mode. They require a separately started compiled loopback Worker on **127.0.0.1:4325** with synthetic WorkOS fixtures, the matching mode flags, local bindings and `--env-file /dev/null`. Never run them against a live provider with real cookies. They do not follow provider redirects or submit a valid code/verifier pair; they test unauthorized boundaries, PKCE start, malformed callbacks/cookies, methods, path variations and CSRF. Choose the script matching the build/mode; the authentication-only script intentionally expects business routes to be disabled.

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node scripts/test-staging-portal.mjs
```

Synthetic fixtures cannot establish a live session lifecycle. HTTP loopback lacks HTTPS Secure-cookie transport; adapter tests cover cookie options, and deployed behavior needs its own evidence. Never enable a demo authentication bypass on the hosted Worker.

## Compatibility finding

The tested `@workos/authkit-astro` 0.2.1 root import pulled build-time `astro/config` tooling into the Astro 7.3.8 Cloudflare Worker bundle. The app therefore uses the same official session engine directly: `@workos/authkit-session`, pinned to tested version 0.5.4. `src/lib/workos-runtime.ts` provides the Astro cookie adapter; it does not reimplement PKCE, encryption or token verification. The toolkit is prerelease; upgrades must rerun compatibility and session-lifecycle checks. No private package paths or build-module shims are used.

References: [official runtime session toolkit and adapter guide](https://github.com/workos/authkit-session), [official Astro SDK documentation](https://workos.com/docs/sdks/authkit-astro).

## Future production origin — proposed only

WorkOS Staging is for internal controlled tests, not a real-family pilot. Production is already accessible and billing is present; do not repeat billing entry or an unlock step. Production still needs an approved configuration, its own privately installed credentials/cookie secret, staff decisions and MFA. No key was created or inspected, no paid add-on purchased, and no production setting changed during this inspection. Continue using the default hosted AuthKit domain. [WorkOS environments](https://workos.com/docs/authkit/environments)

Recommend `https://ajedrezbelen.com` as the future single authenticated origin, preserving the public landing on both main hosts. Proposed Production callback: `https://ajedrezbelen.com/auth/callback`; logout: `https://ajedrezbelen.com/`. These are **not approved or applied**. Redirect authenticated www GET/HEAD navigation to apex before PKCE, reject cross-origin POSTs, and keep host-only session/verifier cookies. See the [future production runbook](CLOUDFLARE-STAGING.md#future-production-on-the-main-domains--proposed-only).
