# WorkOS setup

For the current portal, start with the [focused setup handoff](SETUP-HANDOFF.md#workos-why-login-returns-503): it separates exact callback/logout values, non-secret identifiers, private secrets and owner security decisions. Both original-local login 503 responses were confirmed to be the application's missing/invalid configuration guard before any WorkOS request; no secret values were inspected.

## Current portal configuration update — 11 October 2026

After separate direct owner approval, both hosted WorkOS **Staging** entries are saved, reopened and screenshot-verified: callback `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback` and logout `https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/`. The local callback `http://127.0.0.1:4322/auth/callback` and logout `http://127.0.0.1:4322/` remain **Default**. No other WorkOS rows changed. Hosted authentication is still untested. Logout return-to is computed from the runtime `WORKOS_REDIRECT_URI`, so the preserved local dashboard default does not override the hosted callback once runtime configuration is completed.

The application **Ajedrez Belen’s Project / Staging** and public client ID `client_01M4M8D1P0W2N2WANHTC4SF921` are unchanged. Organization, administrator, MFA and credential settings were untouched by the URL changes. The generated **Test Organization / example.com / Test Provider** is not an approved association staff organization.

The original local `.dev.vars` has the approved public client ID, local callback and `EMAIL_MODE=dry_run`. At its confirmed restart, `/demo` returned **200** and both login entry points returned **503**. The last boolean-only local check found WorkOS key absent, cookie-password minimum check false, and organization/admin IDs absent. No secret value was displayed. The corrected private Brevo setting matched an API-key type, sender address/name, timeout and dry-run; no provider request or email occurred.

The isolated test Worker is deployed, its four migrations are applied and its **40/40** disabled-route checks passed. The public sites remain **ajedrezbelen.com** and **www.ajedrezbelen.com**; **workers.dev is test-only**. Hosted secrets, approved staff access and real authentication remain incomplete. [Cloudflare rollout evidence and future production plan](CLOUDFLARE-STAGING.md).

## Owner-only private staging secrets

Use only the existing WorkOS **Staging** environment and Cloudflare Worker **ajedrez-belen-portal-staging**, in account `7d3e79129c4f0b3619a419cabbfa021e`:

1. Privately obtain the WorkOS Staging API key and generate a unique random cookie password of at least **32 characters**, separate from the API key and any production password. Keep both in the owner's password manager; do not paste values into chat, source, screenshots or logs.
2. In Cloudflare **Workers & Pages → ajedrez-belen-portal-staging → Settings → Variables and Secrets → Add**, choose type **Secret** for `WORKOS_API_KEY` and enter the Staging key privately. Add another **Secret** named `WORKOS_COOKIE_PASSWORD` with the new password.
3. The owner reviews the exact Worker and uses **Deploy** to apply these private bindings. This is a deployment of the secret configuration; it does not authorize enabling the portal. Confirm binding names/presence only afterward, without revealing values. [Cloudflare secret configuration](https://developers.cloudflare.com/workers/configuration/secrets/)

Later, a reviewed policy/configuration change must add the non-secret server settings: existing `WORKOS_CLIENT_ID=client_01M4M8D1P0W2N2WANHTC4SF921`, exact hosted `WORKOS_REDIRECT_URI=https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback`, the **owner-approved** association `WORKOS_ORGANIZATION_ID`, and comma-separated immutable `user_...` IDs in `ADMIN_USER_IDS`. No student/free-form email or generated **example.com** test organization substitutes for these decisions. Staff membership and MFA require owner review.

Keep `PORTAL_ENABLED=false`, `PORTAL_DEMO=false`, both prototype flags false, `EMAIL_MODE=dry_run` and `OCR_MODE=off` until that policy/configuration change is reviewed and a fresh build/preflight passes. Then use explicitly approved controlled accounts and synthetic data to test login, verified email, wrong-org/unlisted-user denial, refresh/revocation, logout and payment access. WorkOS may send authentication emails during these tests. Secret entry and URL registration alone do not establish readiness.

## Future production origin — proposed only

Recommend `https://ajedrezbelen.com` as the single authenticated origin while preserving the public landing on both main hosts. Proposed Production callback: `https://ajedrezbelen.com/auth/callback`; logout: `https://ajedrezbelen.com/`. These Production URLs and routing changes are **not approved or applied**. Canonicalize only authenticated GET/HEAD navigation from www to apex before starting PKCE; reject cross-origin POSTs. Host-only verifier/session cookies cannot support a www login start with an apex callback. See the [production architecture runbook](CLOUDFLARE-STAGING.md#future-production-on-the-main-domains--proposed-only).

WorkOS Production requires separate configuration/credentials and its billing-information gate. Association organization, immutable admin IDs and staff MFA still require owner decisions. Staging credentials/resources must not become production credentials/resources.

The instructions below describe the earlier compatibility laboratory. Its `PROTOTYPE_*` flags and `/auth/login` flow do not replace the portal's `PORTAL_ENABLED=true`, `PORTAL_DEMO=false`, `/auth/parent` and `/auth/admin` setup.

No WorkOS account is needed to run the separately guarded synthetic local lab.
Without credentials, the login endpoints return a setup response (503), and no
real authenticated identity is produced. The prototype must be enabled to expose
its routes; otherwise they return 404.

## Earlier laboratory setup reference

1. Reuse the existing WorkOS Staging project; do not create a duplicate account or application.
2. Create an organization for the association. Invite the administrator into that
   organization and complete the invitation using their own account.
3. Configure the AuthKit redirect URI as
   `http://127.0.0.1:4322/auth/callback` for local development. A deployment needs
   its exact HTTPS origin and the same `/auth/callback` path.
4. Add the homepage origin as an allowed post-logout redirect in WorkOS.
5. Copy the client ID, API key, and organization ID into the local `.dev.vars`
   file. Generate a separate cookie encryption password with
   `openssl rand -base64 32`. Do not put keys into tracked files or chat.
6. Set `ADMIN_USER_IDS` to the administrator's immutable WorkOS `user_...` ID.
   Multiple IDs are comma-separated. An email address or role alone grants no
   administrative access. Missing IDs deny administrator access.
7. Set `PROTOTYPE_ENABLED=true`. To exercise real login locally, leave
   `PROTOTYPE_LOCAL=false`; the synthetic local mode is a separate test path.
8. Require MFA for administrators in the WorkOS configuration before using real
   family or payment information.

Required runtime settings:

| Setting | Purpose |
| --- | --- |
| `WORKOS_API_KEY` | Staging secret API key |
| `WORKOS_CLIENT_ID` | Staging client ID |
| `WORKOS_REDIRECT_URI` | Exact callback URL |
| `WORKOS_COOKIE_PASSWORD` | Random secret of at least 32 characters |
| `WORKOS_ORGANIZATION_ID` | The association's WorkOS organization |
| `ADMIN_USER_IDS` | Explicit administrator user IDs |

For a future deployment, store secret values in Workers secrets and use the
appropriate WorkOS environment. Do not reuse staging keys in production.

## Integration behavior

- `GET /auth/login` starts an organization-scoped PKCE login and returns to
  `/prototype`. The caller cannot select another organization or redirect target.
- `GET /auth/callback` delegates the code exchange and PKCE verification to the
  official SDK. Failure messages omit provider internals.
- `POST /auth/logout` ends the session; use a same-origin form submission. A GET
  does not sign the user out.
- AuthKit's runtime session service validates and refreshes encrypted sessions server-side.
  HTTP-only cookies use the SDK's SameSite policy, are secure with HTTPS callback
  URLs, and have an eight-hour browser lifetime. Configure the WorkOS session
  expiry policy separately.
- Identity is accepted only for the configured association organization.
  Administrative access also requires an allowlisted user ID; impersonated
  sessions cannot administer the prototype.
- All prototype mutations require a same-origin `Origin` header. Auth and
  prototype responses are private and uncached. Tokens are never serialized to
  the browser by the application.

The account-free prototype can establish module/build compatibility and test
authorization policy. It cannot prove live account login, MFA, token refresh,
session revocation, or logout at WorkOS. Once staging is configured, verify a full
login/logout round trip, an unlisted user's denial, a wrong-organization user's
denial, and session expiry before a pilot with real families.

## Compatibility finding

`@workos/authkit-astro` 0.2.1 imports the build-time `astro/config` module from its
root entrypoint. With Astro 7.3.8 and the Cloudflare adapter, both dynamic and
static named runtime imports pulled build tooling into the Worker bundle and
failed the build. The application therefore uses the same official session
engine directly: `@workos/authkit-session`, pinned to the tested 0.5.4 version.

`src/lib/workos-runtime.ts` contains only the documented Astro cookie adapter.
WorkOS still provides PKCE, callback-state checks, encryption, token verification,
and refresh; none of those mechanisms are implemented by this application.
The runtime toolkit is prerelease, so upgrades must rerun the compatibility and
session-lifecycle checks. No private package paths or build-module shims are used.

Implementation references: [official runtime session toolkit and adapter guide](https://github.com/workos/authkit-session)
and [official Astro SDK documentation](https://workos.com/docs/sdks/authkit-astro).

## Repeat the compiled Worker checks without an account

From the repository root, build the production Worker:

```sh
WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false npm run build
```

In the same terminal, start the compiled Worker with the fixed synthetic
fixtures below. Port **4323** is required by the test script. `--env-file
/dev/null` prevents loading any local `.dev.vars` account credentials. The
fixture values are intentionally unusable with a real WorkOS account. Keep this
server on loopback and stop it with Ctrl-C when the test finishes.

```sh
WRANGLER_LOG_PATH=.wrangler/logs WRANGLER_SEND_METRICS=false \
  ./node_modules/.bin/wrangler dev \
  --config dist/server/wrangler.json \
  --env-file /dev/null \
  --local --ip 127.0.0.1 --port 4323 \
  --inspector-ip 127.0.0.1 --inspector-port 9233 \
  --var PROTOTYPE_ENABLED:true \
  --var PROTOTYPE_LOCAL:true \
  --var EMAIL_MODE:dry-run \
  --var WORKOS_API_KEY:sk_test_COMPATIBILITY_ONLY \
  --var WORKOS_CLIENT_ID:client_compatibility \
  --var WORKOS_COOKIE_PASSWORD:synthetic-compatibility-cookie-password-only-32 \
  --var WORKOS_REDIRECT_URI:http://127.0.0.1:4323/auth/callback \
  --var WORKOS_ORGANIZATION_ID:org_compatibility \
  --var ADMIN_USER_IDS:user_compatibility
```

In a second terminal, from the repository root:

```sh
node scripts/test-worker-auth.mjs
```

The script checks that the production build ignores the local-development
bypass, denies unauthorized file/receipt access and writes, creates PKCE state
and an HTTP-only SameSite=Lax verifier cookie, rejects tampered callback/session
cookies, and restricts logout to a same-origin POST. Its requests stay on
loopback, never follow the WorkOS redirect, and never submit a valid PKCE/code
pair for exchange. It prints only check results, without cookie or state values.

The HTTP loopback fixture does not set `Secure` on its cookies; HTTPS cookie
behavior is covered separately by the runtime adapter unit test. Passing these
checks confirms local Worker compatibility, not a live WorkOS session lifecycle
or Cloudflare's deployed CPU budget.
