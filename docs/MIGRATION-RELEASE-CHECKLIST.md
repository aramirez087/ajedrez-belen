# Production migration and release checklist — no actions executed

Record evidence beside each completed item. A checked document is not an action
approval: retain the exact owner approval, target and allowed consequence for
each external step. An unresolved identity, holder/receipt decision, target or
required recovery check blocks its dependent action. Continue independent local
preparation without substituting guessed values.

## 1. Finish decisions and local integration

- [x] Reconcile the [manifest](production-release-plan.template.json) with the
  latest local decision record and SINPE clarification. Preserve the
  confirmed number; leave holder, receipt identity and other pending fields unset.
- [x] Reconcile the deployed parent-login/callback source with the integrated business guard in the actual repository. The reviewed 22-file merge preserves unrelated work and the index, with premerge copies and file hashes. All 333 deployed-baseline files are accounted for; the intentional differences implement the guard.
- [x] Verify the complete merged source: 302/302 tests (297 application plus five diagnostics), 132 Astro files with zero diagnostics, build 111 inputs/288 artifacts, successful preflight and 54 independent focused regressions. Source hashes match the clean tested snapshot. This is local evidence; no deployment occurred.
- [ ] Approve the canonical authenticated origin and implement/verify protected
  www handling, cookie scope, callback origin and mutation rejection.
- [ ] Resolve production immutable client, organization and administrator IDs
  with explicit identity/grant/MFA decisions. Walter's intended role does not
  identify an account. No invitations or account changes occur as a side effect.
- [ ] Coordinate the current hosted Git pipeline before any authorized push.
  The interim assets-only pipeline and a future portal runtime release are
  different artifacts targeting the same public Worker; avoid an accidental
  later landing-only overwrite of the portal.
- [ ] Resolve recovery ownership, location, retention and acceptable loss/downtime;
  obtain a specific safe next action for fresh R2 retrieval. Confirm free-tier
  capacity without purchasing a plan or broadening privileges.

## 2. Approve and verify the exact production resources

- [ ] Obtain distinct resource-creation approvals for the proposed production D1
  and private Standard R2 resources. Existing staging resources are not targets.
- [ ] Record readback evidence for the account ID, existing public Worker identity,
  full current rollback version, public route/custom-domain configuration, D1
  name plus provider-issued UUID, and R2 account plus bucket name.
- [ ] Confirm D1 is nonzero and not the known staging UUID
  `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`; also independently exclude any prototype
  or other existing database. A familiar display name does not prove identity.
- [ ] Confirm private R2 has no public endpoint, correct binding `SLIPS`, and no
  copied staging/prototype contents. Record access and object inventory without
  exposing files. A name ending in `production` alone is insufficient evidence.
- [ ] Classify the actual database as new/empty or existing using the approved
  read-only inspection. Migration approval must name that exact database UUID
  and classification. Do not infer emptiness from an absent application screen.
- [ ] Separately approve owner-controlled production secret installation. Record
  only binding names and presence/environment checks, never values.

## 3. Review the migration plan against that database

These exact files match both the actual repository and the local configuration
candidate; the candidate introduces no schema change. Hashes are preserved in
the manifest. Changes to any file invalidate this migration review.

| Order | File | Dependency and effect | Adds: tables / explicit indexes / triggers |
| --- | --- | --- | --- |
| 1 | `0001_prototype.sql` | Independent `prototype_runs` schema with fixed synthetic ₡12,000 constraint. Applying the schema does not enable the prototype or import fixtures. | 1 / 1 / 0 |
| 2 | `0002_portal.sql` | Core family, charges, payments, revisions, receipts, outbox and audit. Allocation, balance, immutable-record and payment-transition guards. No dependency on the prototype table. | 16 / 9 / 20 |
| 3 | `0003_ocr.sql` | Requires `0002` tables including users, files and revisions. Adds drafts, extraction and budgets plus a guard on existing payment-file inserts. Required even with OCR off because slip drafts use this schema. | 4 / 5 / 7 |
| 4 | `0004_financial_operations.sql` | Requires `0002.users`. Adds durable immutable operation keys for adjustment/credit idempotency. | 1 / 0 / 2 |

Expected application schema totals are **22 tables, 15 explicit indexes and 29
triggers**; the existing migration runner adds migration metadata, giving **23
tables** in the recorded staging evidence. SQLite autoindexes are not included
in the explicit index count. Counts are a sanity check, not proof of identical
definitions or compatibility. The staging verification is historical evidence,
not an inspection of a production database.

- [ ] For a **new empty database**, approve and apply all four files in order to
  the verified production UUID before allowing portal use. Keep portal/business
  flags false and email dry-run throughout. Do not seed students, guardians,
  payments, receipts or synthetic fixtures.
- [ ] For an **existing database**, compare recorded migration names, current
  definitions and exact file hashes first. Apply only genuinely pending,
  compatible migrations under a reviewed upgrade plan. The files use
  unconditional `CREATE` statements: do not reapply completed migrations or
  apply them over a complete schema import. Missing/inconsistent migration
  metadata needs investigation; never fabricate completion or assume a reset.
- [ ] Establish a pre-change recovery reference. For existing records, use a
  coordinated matched D1/R2 capture under an explicitly approved write-control
  procedure; no general maintenance toggle is assumed. For an empty first
  installation, retain evidence of the verified empty target and configuration.
- [ ] Record the precise migration operation, reviewed config, target identity,
  expected changes and approval before execution. Disable implicit provisioning;
  do not run a base/staging target or use an ambiguous database name alone.
- [ ] After the approved operation, verify migration history, table/index/trigger
  definitions, foreign-key/integrity checks and expected inventory using approved
  read-only checks. Retain sanitized output and timestamps. Stop activation on
  partial application or mismatch; do not repeatedly rerun the entire chain.

There are no down migrations. Do not describe dropping tables, deleting a
database, restoring an old snapshot or subtracting ledger rows as an automatic
migration rollback. Each can destroy later legitimate writes and needs a separate
recovery decision.

## 4. Prepare and approve one exact disabled production artifact

- [ ] Create a dedicated production config from the completed manifest. Require
  explicit approved identities, actual D1 UUID and private bucket identity; reject
  nulls, zero IDs, staging/prototype names, all `STAGING_` bindings, fictional
  bank/receipt values and undeclared resource bindings. Keep all disabled flags
  from the recipe explicit. A reviewed validator/preflight must enforce this;
  the JSON template itself performs no validation.
- [ ] Review generated Astro/Cloudflare output for the exact intended entry point,
  config, asset path and binding set. Test the final source locally with synthetic
  fixtures and focused checks after integration; verify protected pages, private
  files and receipts are excluded from static assets. Record the final digest.
- [ ] Verify the approved build/deploy commands use the dedicated config,
  lockfile-pinned Wrangler, no implicit environment files or identity overrides,
  and automatic provisioning disabled. Review any hosted pipeline change as its
  own external mutation. No shell-ready remote command is supplied here.
- [ ] Obtain approval for that exact disabled-shell release to the existing public
  Worker, including both domains and its recovery reference. Deploy only the
  reviewed artifact under that approval; keep portal/business disabled,
  email dry-run and OCR off.
- [ ] Under an approved read-only verification scope, confirm both public landing
  origins, inactive demo/prototype, disabled portal behavior, protected-route
  Worker handling, private caching and lack of public private-file exposure.
  Verify actual deployed version/config rather than assuming deploy success.

## 5. Explicit portal/business activation, then optional email

- [ ] Approve the account holder, receipt issuer/legal wording, exact public SINPE
  instructions, administrator identity/scope, and opening ledger/cutoff plan.
  Resolve the sibling discount or explicitly defer it; apply no invented rule.
  Holder approval is a required organizational gate that the current four-string
  business resolver does not technically enforce.
- [ ] Close relevant production authorization/origin/session checks with explicitly
  authorized identities and synthetic fixtures. Prior staging and local tests
  provide evidence but do not grant new production accounts, MFA changes or
  access. Never test by modifying real family/payment records.
- [ ] Obtain the exact activation approval before changing `PORTAL_ENABLED` and
  `PORTAL_BUSINESS_CONFIG_APPROVED` to `true`. Maintain demo/prototype false,
  `EMAIL_MODE=dry_run`, and `OCR_MODE=off`. Observe the approved release and verify
  its boundaries. A proof upload must remain distinct from audited bank approval.
- [ ] Import opening data only under a separate dataset/cutoff/action approval,
  with reconciliation and recovery evidence. Do not populate a zero-balance
  starting ledger merely because an opening-balance answer is missing.
- [ ] If email is later desired, approve production private binding, sender name,
  privacy/tracking/retention and automatic future approval/void sends. Review exact
  eligible recipients and separately approve any queued batch. Do not replay
  dry-run/cancelled/unknown attempts. The already received diagnostic message does
  not require another test send or authorize live financial messages.

## 6. Incident rollback and data recovery

- [ ] Retain the **full** pre-release public Worker version/configuration and a
  reviewed landing-only or portal-disabled incident artifact. A version prefix,
  staging rollback version or previous candidate hash is insufficient.
- [ ] Before a code rollback, confirm that the selected Worker remains compatible
  with the current schema and stored data. `0003` alters existing-table insert
  behavior. A Worker predating durable financial-operation keys can lose retry
  protection even though `0004` is additive; additive schema is not a compatibility
  guarantee. Prefer an explicitly reviewed compatible forward fix or incident
  artifact when an older Worker is unsafe.
- [ ] Keep email dry-run in an incident artifact and preserve all outbox attempts.
  A rollback must not introduce retries for uncertain provider outcomes or resend
  already attempted messages.
- [ ] Record that Worker rollback changes code/configuration only. It does not
  undo D1 migrations, approvals, balances, counters, audit events or R2 objects.
  Do not delete a bound database/bucket to make a code rollback appear complete.
- [ ] For a separately approved restore, recover a consistent D1/R2 set including
  receipts and counters/snapshots, allocations/revisions, guardians/invitations,
  original submission keys, `financial_operations`, retained drafts/object
  inventory, audit and outbox attempts. Review legitimate writes after the
  recovery point before cutover; do not silently discard them.
- [ ] Rehearse restoration into an isolated approved destination with provider
  sends disabled, prove schema/data/object consistency and retry protection, and
  record operator/deputy and elapsed recovery. A prior local synthetic drill or
  reused old file does not satisfy fresh production object retrieval or encrypted
  off-host recovery requirements.
