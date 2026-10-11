# Separate Cloudflare staging portal

The exact isolated infrastructure rollout is now owner-approved. The new D1 database and private R2 bucket have been created through the Cloudflare dashboard; all four remote D1 migrations have applied, and the Worker is deployed with the portal disabled. The 40-case live disabled-route verification passed; authenticated portal operation remains gated. The public Worker `ajedrez-belen` and root/www hostnames remain separate. Local preparation scripts themselves create no remote resources, routes, secrets, OAuth grants or migrations.

## Account evidence and approved resources

Initial read-only Cloudflare dashboard inspection on **11 October 2026** found Workers **Free**, one Worker (`ajedrez-belen`), no D1 databases, and an already active R2 account. The existing R2 bucket `docklet` held 6 objects / 25.25 MB, with 12 Class A and 12.87k Class B operations and $0 current billable usage for September 23–October 23. This unrelated bucket must not be reused or altered. Following explicit approval, the isolated D1 and R2 resources below were created in the approved account. All four D1 migrations have now applied. No receipt object was uploaded or OCR request made.

| Setting | Approved value and current status |
| --- | --- |
| Account | `7d3e79129c4f0b3619a419cabbfa021e` — pinned in staging configuration |
| Worker | `ajedrez-belen-portal-staging` — **deployed**, version `f2fd0fd3-9bf4-4aed-9911-58e0cad29628`; 40/40 disabled-route checks passed |
| D1 database | **Created:** `ajedrez-belen-portal-staging`, UUID `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`, binding `DB`; all four migrations applied, final list **No migrations to apply** |
| R2 bucket | **Created:** `ajedrez-belen-portal-staging-slips`, binding `SLIPS`, **Standard**, **0 B / 0 objects**; **Public Access Disabled**, no custom domain, public development URL disabled |
| Deployed hosted URL — portal disabled | `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev` |
| Source configuration | `wrangler.staging.jsonc` + `astro.staging.config.mjs` |
| Generated deployment configuration | `dist-staging/server/wrangler.json` |

R2 is already active; an activation or card prompt is not an established blocker. Its free allowance is shared with existing account usage, and excess usage can be billed. Workers Free CPU limits also require deployed measurement. Do not promise zero cost or accept a plan change. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Local build and deployment preflight

From the project root, using the existing installed dependencies:

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin node scripts/build-staging.mjs
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin node scripts/preflight-staging.mjs
```

The builder uses a temporary, allowlisted source copy under ignored `output/`, an explicit child environment, isolated XDG configuration/cache directories, no remote bindings, and no original local database. It does not copy root dotenv files or `.wrangler/`. Environment-file names or symlinks inside copied source/public inputs are rejected without reading their contents. A legacy global Wrangler directory causes a refusal rather than credential inspection. PDF assets are generated inside that temporary copy. The existing `dist/`, `.wrangler/deploy/config.json`, local preview and public Worker configuration are not changed. The final staging static assets include `X-Robots-Tag: noindex, nofollow`.

The preflight verifies exact Worker/account/storage names, safe variables, no routes or additional bindings, generated entry/assets/migration paths, and hashes of build inputs and output. A modified, stale or incomplete artifact fails. The lead recorded the verified new D1 UUID above in source configuration. The staging build and preflight passed with **102 inputs / 283 outputs**. Wrangler deployment **dry-run** with `--experimental-provision=false` also passed: **364.89 KiB gzip**, **212 asset files**, only the approved DB/R2/assets bindings and disabled synthetic variables. Those local checks preceded the completed remote migrations and successful updated deployment. The Worker is deployed at `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev`, version `f2fd0fd3-9bf4-4aed-9911-58e0cad29628`. The updated upload was **364.74 KiB gzip**, with **204 new assets** uploaded; reported startup was **16 ms**, which is not request CPU measurement. Only the new DB/private R2/assets bindings are present. Portal/prototype/demo remain disabled, OCR off and email dry-run. Live route, storage and existing-landing checks passed as recorded below. An all-zero placeholder deliberately fails preflight. Dashboard review has confirmed the database account/name and private R2 settings; local validation alone cannot establish those facts or deployment authorization.

The current preparation keeps `PORTAL_ENABLED`, `PORTAL_DEMO`, both prototype flags and `preview_urls` false. `workers_dev=true` prepares the exact named staging host for the approved deployment; editing this file does not publish it. It keeps `EMAIL_MODE=dry_run` and `OCR_MODE=off`, with synthetic payment instructions and a clearly marked test receipt name. Secrets never belong in `vars`; the current disabled configuration also excludes WorkOS non-secret settings until a reviewed policy/configuration update. These guards are checked in `scripts/staging-policy.mjs`; enabling the portal later requires a reviewed configuration/policy update and a fresh build. This artifact alone is not an operational authenticated portal.

Use the generated staging configuration explicitly for future Wrangler commands. Do not use bare `wrangler deploy`, the existing `dist/server/wrangler.json`, the landing Worker name, or a deploy-time environment override. The Astro/Cloudflare environment is selected during the build. [Astro adapter configuration](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) and [Cloudflare environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

## Approved rollout and verified Wrangler access

The owner approved one isolated infrastructure rollout in the pinned account: the named Worker, new D1 database, reviewed migrations `0001_prototype.sql` through `0004_financial_operations.sql` only on that database, the named private Standard R2 bucket, and only the named workers.dev host. **D1 and R2 creation are complete; do not repeat them.** All four migrations are applied and the Worker is deployed; 40/40 disabled-route checks passed. Keep the portal disabled, email simulated and OCR off. Preserve all existing Workers, buckets, root/www DNS and domain-security settings. Do not import families, students, slips or existing financial records.

The owner personally approved the displayed Wrangler consent. CLI login exited successfully, and `whoami` confirmed account `7d3e79129c4f0b3619a419cabbfa021e` with only `account:read`, `user:read`, `workers_scripts:write`, `d1:write` and `offline_access`. Access is stored encrypted through the keychain; no credential values were read. These scopes are not limited to the new resources. Do not put credentials into chat, source, arguments or logs.

The rollout uses the exact staging source config for migrations and the generated staging config for deployment. The migration commands below are a record of the completed run, not a request to repeat them:

```text
wrangler d1 migrations list DB --remote --config wrangler.staging.jsonc --env-file /dev/null
wrangler d1 migrations apply DB --remote --config wrangler.staging.jsonc --env-file /dev/null
wrangler deploy --dry-run --experimental-provision=false --config dist-staging/server/wrangler.json --env-file /dev/null
wrangler deploy --experimental-provision=false --config dist-staging/server/wrangler.json --env-file /dev/null
```

Remote migrations and deployment dry-run have passed. Infrastructure approval and owner authorization are recorded; the updated Worker deployment succeeded. The commands above are rollout evidence, not a request to redeploy. The verified new D1 ID is now recorded in staging configuration. Both deployment commands disable experimental provisioning to avoid Wrangler’s default R2 lookup/creation. Rebuild and pass preflight after every configuration change. Review dry-run output and confirm the new staging target before publishing. A Worker version rollback does not undo D1 schema or data changes; keep the new staging database isolated.

## Remote migration recovery and verification

All four remote migrations are **APPLIED** on the exact new staging database; the final migration list reports **No migrations to apply**. The initial `0002` attempt hit the remote parser’s nested `CASE … END` handling and rolled back its portal changes. A syntax-only rewrite of 18 clauses in `0002`/`0003` uses `RAISE` with `WHERE`, preserving conditions and error messages. All 158 unit tests and schema-equivalence checks including 10 NULL cases passed; the remote retry applied `0002`–`0004` successfully. No real student, family, slip or payment data was imported. A Worker rollback does not undo these applied migrations.

## Live disabled-staging verification

Live verification passed **40/40 GET cases**: root **200** with noindex and 39 protected routes **404**, with private/no-store, noindex, DENY, nosniff, same-origin referrer policy and Vary Cookie headers; no Location or Set-Cookie. No provider request or write occurred. Remote D1 verification confirmed all four migrations, **23 tables** (including `d1_migrations`), **15 indexes**, **29 triggers**, and zero rows in all 12 checked business tables; database size **360,448 B**. Dashboard checks reconfirmed R2 Standard/private, no custom domain and disabled public development URL, and Workers **Free** as the current plan. Existing root and `www` independently returned HTTPS **200**. Evidence: `output/staging-db-verification.json` and `output/staging-lockdown-verification.json`. These checks establish a deployed, disabled staging shell; hosted authentication and payment workflows remain unverified.

## Hosted access and operational verification

After separate direct owner approval, both hosted WorkOS **Staging** entries are saved, reopened and screenshot-verified: callback `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback` and logout `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/`. The local callback `http://127.0.0.1:4322/auth/callback` and logout `http://127.0.0.1:4322/` remain **Default**. No other WorkOS rows changed. Hosted authentication is still untested. The staff organization, administrator IDs and MFA policy need the owner's security decision. Even the family entry point currently requires a valid `WORKOS_ORGANIZATION_ID` configuration. The generated test organization must not be assumed to be the staff organization.

WorkOS **Staging is for controlled internal testing only**, not a family-facing or real-data pilot. A real rollout requires the separate WorkOS Production environment and its own credentials/settings. WorkOS currently requires billing information to unlock Production, including usage within the free AuthKit allowance; that owner decision is a separate gate, not an implied upgrade or authorized checkout. [WorkOS environments](https://workos.com/docs/authkit/environments).

The owner privately adds the WorkOS Staging key as `WORKOS_API_KEY` and a unique random password of at least 32 characters as `WORKOS_COOKIE_PASSWORD`, both **Secret** bindings on the staging Worker, and personally deploys those bindings. [Owner-only private steps](WORKOS-SETUP.md#owner-only-private-staging-secrets). Later non-secret settings are the existing Staging client ID, exact hosted callback, owner-approved organization ID and immutable admin IDs. Keep `PORTAL_ENABLED=false`, email dry-run and OCR off until a reviewed policy/configuration update and fresh build/preflight permit controlled testing. Then verify real family/staff login, email verification, wrong-organization and wrong-user denial, session refresh/revocation and logout. `/demo` intentionally cannot authorize a hosted production build; do not weaken that guard. WorkOS itself may send authentication emails, so use explicitly approved controlled accounts.

Use synthetic data in the isolated staging database to verify invitations, private uploads, multi-family access, explicit bank-review workflow, idempotency, email holds/recovery, receipt printing and voids. Keep OCR off and email dry-run. A live Brevo message or Groq request needs its own approved test and secrets; no test-recipient setting limits portal mail automatically. Measure Worker CPU and D1/R2 usage and verify backup/restore. Passing these checks does not authorize a real-data pilot: WorkOS Production, public-domain routing, production storage and real records remain separate later decisions.

## Future production on the main domains — proposed only

The user confirmed **ajedrezbelen.com** and **www.ajedrezbelen.com** as the main domains. The workers.dev host is test-only. No production routing, Worker replacement or WorkOS Production setting in this plan is approved or applied.

1. Prepare a reviewed future build for the existing **ajedrez-belen** Worker that serves the public landing on both hosts and the authenticated portal through the Worker. Use selective Worker-first handling for the exact paths `/portal`, `/admin`, `/auth`, `/api`, `/demo`, `/prototype` and every descendant; protected pages must never be prerendered or served as public static assets. Keep demo/prototype unavailable in production. Validate this routing in the generated deployment artifact.
2. Recommend **https://ajedrezbelen.com** as the single authenticated origin. Canonicalize only GET/HEAD navigation for authenticated routes from www to apex **before login/PKCE begins**, preserving the public landing on www. Reject cross-origin POSTs instead of redirecting/replaying them. Host-only verifier/session cookies cannot support a www login start followed by an apex callback; do not broaden cookie scope to bypass this design. Callback processing must remain on the configured apex origin.
3. Proposed WorkOS **Production** callback: `https://ajedrezbelen.com/auth/callback`; logout: `https://ajedrezbelen.com/`. Register these only after explicit production approval, using separate Production credentials, an independent cookie secret and owner-approved staff organization/admin IDs/MFA. The WorkOS Production billing-information gate remains unresolved; no billing or plan change is authorized.
4. Provision distinct production D1/private R2 and secrets after approval; do not reuse staging data or credentials. Preserve landing assets and existing domain-security settings. Review migrations, backup/restore, origin/PKCE/cookie behavior, private caching, authorization and the complete financial workflow before launch. Route/domain deployment and any real-data import or live email require their own explicit approval.
