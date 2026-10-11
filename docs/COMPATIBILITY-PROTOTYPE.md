# Payment compatibility prototype

Status: local compatibility work completed on 10 October 2026. Brevo is selected; sibling discounts remain manually entered amounts. Later read-only checks confirmed an existing Brevo account; WorkOS runtime configuration remains incomplete. This prototype work provisioned no service, deployed no portal and sent no email. Current readiness supersedes these earlier prototype notes: [setup handoff](SETUP-HANDOFF.md).

The full local portal has since been implemented alongside this isolated lab. Its setup and current scope are in [PORTAL-SETUP.md](PORTAL-SETUP.md). The results and future-stage wording below describe the earlier compatibility prototype, not the current portal's database or feature set.

## Run locally

Requires Node >=22.12; verified with Node 24.15. The deployed runtime is Cloudflare workerd, not Bun. D1 provides SQLite storage through a binding; no `bun:sqlite` or writable local database file is used in the deployed application.

```sh
npm ci --ignore-scripts
cp .dev.vars.example .dev.vars # first setup only; preserve an existing file
npm run db:local
npm run dev:prototype
```

Open [the synthetic lab](http://127.0.0.1:4322/prototype). Download its example image, enter an optional discount, upload that image and create a test receipt. The history provides the private file download, printable HTML receipt and simulated email action. All records are explicitly fictitious. The example fee is ₡12,000; it does not configure the future fee schedule. A full waiver is outside this positive-payment test.

The `.dev.vars` file and `.wrangler/` local database/files are ignored by Git. Do not replace an existing environment file or paste credentials into chat. In sandboxed environments, set `WRANGLER_LOG_PATH=.wrangler/logs` and `WRANGLER_SEND_METRICS=false` before Wrangler/Astro commands so diagnostics remain inside the workspace.

```sh
npm test
npm run check
npm run build
# Against the running synthetic lab, creates a fictitious record:
npm run test:prototype
```

## What is verified

| Component | Local evidence | Still requires a real account/deployment |
| --- | --- | --- |
| Astro 7.3.8 + Cloudflare adapter | Type check; full Worker build; static homepage; server routes in local workerd | Deployed CPU limits, startup and usage |
| D1 | Local migration, insert/read, immutable receipt data, conditional email-attempt claim | Remote database provisioning, concurrent production approval design, recovery |
| Private R2 | Local upload and exact-byte download through an authorized route; file signature/size limits | Private remote bucket, deployed permissions and retention |
| WorkOS | Official session SDK runs in compiled workerd; PKCE, cookies, tampered callback/session rejection, fixed organization and callback; policy tests | Real sign-in, refresh, revocation, logout, administrator MFA and non-admin denial with actual accounts |
| Receipt | Escaped HTML and plain text; exact long reference; integer money; Costa Rica dates; frozen values; manual discount; browser-printable page | Association-approved receipt identity and wording; production sequential numbering |
| Brevo | Dry run makes no request; mocked HTTPS request, recipient restriction, timeout/failure handling; persisted attempt state | Account activation, sender/domain setup, API acceptance, inbox delivery, branding, quota and provider idempotency |
| UI | Desktop and 375 px browser review; discount preview; actual browser upload and dry-run email forms; no browser console errors | Parent/admin usability pilot |

Validation includes 25 focused tests, 11 local HTTP integration checks, and a compiled Worker test using synthetic WorkOS settings. The compiled build returns 401 for unauthenticated lab/file/receipt/upload access even if both prototype flags are true. Login produces a 302 with PKCE S256 and an HttpOnly SameSite=Lax verifier cookie; the external redirect was never followed. A tampered callback returns a generic 400 and removes its verifier. GET logout and cross-origin POST are denied.

HTTP elapsed times from the integration script include network/I/O and cold-start time. They do **not** prove compliance with Workers Free's CPU budget. Measure deployed CPU, including successful auth and refresh, before approving this stack for live use. The free-tier assumptions and primary references are in [the implementation plan](../PAYMENTS-PLAN.md).

## Compatibility finding

`@workos/authkit-astro@0.2.1` pulled `astro/config` and native build tooling into the Worker bundle and failed the build. The working integration uses the official `@workos/authkit-session@0.5.4` runtime toolkit with an Astro cookie adapter. The version is pinned because the toolkit is prerelease. WorkOS owns PKCE, encryption, token verification and refresh; the application does not implement those mechanisms. See [WorkOS setup](WORKOS-SETUP.md).

Native browser form testing also caught `Referrer-Policy: no-referrer` producing `Origin: null`, which correctly failed the request guard but prevented legitimate submissions. The response policy is now `same-origin`: native forms work and referrers remain withheld from other sites. Browser upload and simulated-email submissions were verified after the fix. [Browser referrer/origin behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

## Boundaries of this lab

- `PROTOTYPE_ENABLED` defaults to false in deployment configuration. Local synthetic access additionally requires a development build, HTTP loopback and `PROTOTYPE_LOCAL=true`. It cannot authorize a production build. A signed-in identity must belong to the configured organization and exact administrator ID allowlist.
- Every server route checks access; mutations require a same-origin Origin header. Records and files are scoped to their creator. Responses are private/no-store. File downloads use attachment disposition and a restrictive content policy.
- Uploads are limited to JPEG, PNG or PDF signatures, 3 MB each, with bounded request reads. Signature checks are not malware scanning. Use only the fixture or fictitious documents. The lab stops new cases at 100 stored records; this is a convenience limit, not the production quota system.
- Brevo defaults to dry run. A real send requires WorkOS administrator access, explicit live configuration and one configured test recipient. Accepted means queued by the provider, not delivered. Ambiguous or already-attempted sends stay locked for investigation; there is no automatic retry. See [Brevo setup](BREVO-SETUP.md).
- The database contains only `prototype_runs`. Bank verification is simulated; `TEST-UUID` identifiers are test numbers. Parent invitations, two-guardian links, monthly charges due on day eight, reconciliation, allocation, real receipt sequencing, audited reversals and a throttled outbox belong to the next implementation stages.

## Complete the external compatibility check

1. Set up association-owned WorkOS staging and Brevo accounts, following the linked setup guides. Configure an association-controlled sending domain and exact test recipient. Store secrets locally or in the deployment secret store.
2. Exercise real WorkOS sign-in, session refresh/expiry, logout, organization isolation and required administrator MFA. Keep real family data out until these checks pass.
3. Provision a D1 database/private R2 bucket in a separate test environment, replace the placeholder database ID, and apply the migration there. Verify cloud storage and access with synthetic records.
4. Deliberately send one synthetic receipt to the configured mailbox. Check Brevo logs and actual inbox, branding and duplicate handling. Restore dry-run afterward.
5. Measure cloud CPU/usage and confirm account-specific free allowances before building/piloting the full parent and reconciliation workflows.

The local portion is complete. Overall provider compatibility remains pending those live checks.
