# Private capture and local recovery readiness

Prepared 11 October 2026. The portable diagnostic module and its tests are integrated as `scripts/backup-diagnostics{,.test}.mjs`. The reviewed capture-helper integration copy stays task-private under `portal-work/output/backup-readiness`; this is not a new backup. No remote command, access retry, credential inspection, permission change or capture was performed for this preparation. The original helper and previous private bundles remain unchanged. All `output/` paths below refer to the isolated `portal-work` workspace, not this repository.

## What is established

The earlier `output/private-capture-BpmOGW` bundle passed independent verification of its logical D1 data and referenced original bytes. Its original was **reused from a prior authenticated download**, not freshly retrieved from R2. Its historical table/row counts describe that capture, not today's source state.

The sanitized historical `private-capture-vD3JDX/report.json` records `object_download / remote_auth_denied`. The older classifier also used that label for absent local authentication and non-interactive login failures. The report alone therefore cannot prove an expired credential, missing permission scope, wrong resource or provider denial. **The precise cause remains unknown.** No raw diagnostic, private row, object key or credential was reopened to infer it. The prior `zMOIlA` generic failure and `vzXy7I` query failure likewise remain historical; this candidate does not rewrite them.

## Smallest remaining owner handoff

Confirm one **existing authorized object-read path**, in the existing Cloudflare account, for the exact referenced synthetic original:

| Scope | Exact target / permitted action |
|---|---|
| Cloudflare account | `7d3e79129c4f0b3619a419cabbfa021e` |
| Private R2 bucket | `ajedrez-belen-portal-staging-slips` |
| Operation | One bounded **GET of the known referenced object**, using its key privately from the reviewed manifest/current D1 reference; verify length and SHA-256 locally |
| Destination | An approved private task directory, 0700 directories / 0600 files; never Git, public assets, Library or stdout |
| Not required for this step | Bucket listing, write/delete access, public access, additional buckets, new D1 capture, account-wide grants or application login changes |

The owner can use the existing authenticated Cloudflare object-download UI if already authorized, saving the original privately for verification. An existing suitably authorized API/CLI path is also acceptable after the precise command and destination are reviewed. **Do not retry permission failures during this preparation.** If existing access cannot perform this one read, stop and obtain an exact read-only access handoff; do not guess that a broader Wrangler grant or a new token is the remedy. Never ask for a credential value in chat.

The normal portal file endpoint is not a substitute for a strictly read-only infrastructure capture: its authenticated access path synchronizes the adult profile even on GET. An application-mediated download needs that separate scope and must record its acquisition provenance. A previously saved original remains useful, but does not establish fresh R2 access.

## Candidate integration and local validation

`scripts/backup-diagnostics.mjs` and `scripts/backup-diagnostics.test.mjs` are the integrated portable pair: fixed classifiers and synthetic tests only, with no project path, account, bucket, object key, fixture hash or provenance. The module reads no environment or filesystem and invokes no subprocess or network. The separate copied capture helper and its integration tests contain task-specific resource/provenance pins and must stay private under ignored `output/`; do not copy that whole helper into repository `scripts/`.

Only diagnostics and the copy's expected source directory changed. Resource pins, SQL/read-only assertions, row/byte/time limits, recovery invariants and capture modes retain the original implementation. This copy expects its current `output/backup-readiness` location; adjust that location assertion deliberately if integrating elsewhere, without weakening the resource pins.

The portable module passed **5/5** standalone tests; the private helper passed **22/22** combined tests, including offline `prepare`. Independent review found no actionable issue. From this repository run only:

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node --test scripts/backup-diagnostics.test.mjs
```

From `/Users/aramirez/Documents/Codex/2026-10-10/task/portal-work`, the following are also **local-only**:

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node --test output/backup-readiness/diagnostics.test.mjs output/backup-readiness/launch-readonly-capture.test.mjs
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/tmp node output/backup-readiness/launch-readonly-capture.mjs prepare
```

`prepare` reads checked-in configuration/migrations and installed package metadata only. It does not inspect credentials or invoke Wrangler. The standalone diagnostic suite imports only the portable module. The copied helper suite restores synthetic in-memory fixtures into its own new temporary files and removes only those fixture directories.

New diagnostic distinctions:

| Safe category | Meaning and next action |
|---|---|
| `local_access_denied`, `local_file_missing`, `local_storage_full` | Local process/filesystem evidence. Check the permitted local path/runtime/storage; do not change provider access. |
| `command_configuration_failed` | Reviewed command/configuration is incomplete or invalid. Correct the local candidate before any remote retry. |
| `authentication_required` | Existing local authentication was unavailable to the non-interactive command. This does not establish a remote permission denial or authorize login. |
| `remote_dns_failed`, `remote_network_failed`, `remote_tls_failed`, `remote_timeout` | Transport diagnostic; this does not establish missing account privileges. Do not disable TLS verification. |
| `command_timeout`, `output_limit_exceeded`, `command_interrupted`, `bounded_command_failed` | Local execution bound/process failure; source response and completeness are uncertain. Partial output is not a backup. |
| `remote_auth_denied` | A recognized authorization-denial indicator was reported. The report explicitly retains `authorizationCause: unknown`; no scope or credential remedy is inferred. |
| `remote_query_rejected` | Known D1/SQLite rejection; retain only the allowlisted structural issue/code, never SQL or provider text. |
| `missing` | Exact Wrangler missing-object indication. Only an uncommitted draft can be recorded unavailable; missing financial evidence still fails. |
| `read_failure_unknown` | Insufficient safe evidence. Keep the cause unknown; do not relabel it as permission denied or missing. |

R2 stdout is object data and is **never accessed or decoded for diagnostics**, including failed or partial downloads. D1 successful rows, unrecognized envelopes and arbitrary nested error notes are not command-classification inputs. Emitted command diagnostics contain only fixed category/layer labels, an allowlisted local error code when present, and `automaticRetry: false`. No raw command error, stderr, object bytes or private identifier is saved as a diagnostic.

## Repeatable capture sequence — future execution only

Do not run `capture` or `capture-known-original` as part of this preparation or as an automatic diagnostic retry.

1. Review/approve the exact acquisition path and private destination. Confirm the capture scope includes the **then-current** owner/test-parent identities, family rows and email-test audit data. Keep the Worker in email `dry_run` and OCR `off`; no real records or financial mutations are part of this rehearsal.
2. Independently review and integrate the candidate. Run the local tests and `prepare`. Verify the exact account/bucket above, `DB` binding to `ajedrez-belen-portal-staging` / `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`, `SLIPS` binding and installed Wrangler `4.149.0`. No alternate/default configuration, new resource or automatic provisioning is needed.
3. In the existing owner-controlled credential session, invoke the reviewed helper once for the explicitly approved mode. Its child environment is fixed, `CI=true`, metrics/error-report/log writing disabled and `--env-file /dev/null`; it never prints credential values. Normal refresh of an existing unchanged grant may occur. Any new login/permission requirement stops the process.
4. The helper performs bounded `d1 execute --remote --command ... --json` SELECT-only metadata and one-statement logical data capture, requiring zero rows written/no database change. It does not use `--file`, native export, Time Travel, migrations or application endpoints. It restores into a **new local SQLite file**, without reapplying migrations, then derives the complete reviewed union of referenced financial/prototype originals and retained drafts.
5. Fresh mode obtains those originals with bounded R2 object GETs, capturing stdout privately in memory and verifying size/hash before saving. Never run `r2 ... --pipe` directly in a terminal or tool output. Known-original mode is a separate explicitly selected provenance path, not an automatic fallback; do not label it fresh R2 retrieval.
6. Require an unchanged second logical D1 snapshot, verified schema/typed rows/rowids/counters, integrity/foreign keys, and every required original's size/hash. Preserve receipts, financial operations, audit and outbox history. Any drift, truncation, missing required file, unknown failure or checksum mismatch leaves the partial directory unusable; no cleanup, repair or retry runs automatically.
7. Independently verify the completed private bundle. The existing `output/launch-capture-independent-verify.mjs --complete` is deliberately pinned to **the previous one-object known-original provenance**. It is not a generic verifier for a fresh-R2 bundle: a fresh mode needs a narrowly reviewed verifier update preserving all content/permission checks. Fresh capture currently emits no acquisition provenance. Before a future capture, review helper acquisition records bound to separately trusted execution evidence and independently reviewed object expectations; extend the verifier without dropping any existing checks; test forged/missing/mixed provenance, changed targets, object substitution and legacy compatibility. A self-declared fresh flag or matching old bytes cannot prove a new read. Do not change provenance fields to make an old verifier pass. Use only sanitized findings in the handoff.

## Recovery and operating limits

A local restore validates recoverable database state and referenced bytes. Keep restored connections query-only; do not launch an application against captured identities/outbox records or enable email. No existing bundle or database is overwritten by this plan. Failed private artifacts remain retained for authorized review.

This is not an atomic D1/R2 snapshot: matching before/after database content and object hashes detect observed drift only. Unknown/orphan R2 objects, HTTP/custom metadata, reserved D1 internals, native export/import, cloud restoration, off-host recovery and full application replay remain separate gaps. A future cloud rehearsal needs separately approved empty targets and routing; it must not replace staging or production resources. A Worker rollback does not restore data.

The association still needs to select the backup owner, private destination/access, cadence, acceptable recovery point/time, retention/deletion policy and storage budget. No duration, legal rule, paid plan or automatic backup schedule is invented here. One authorized fresh-object verification is the smallest next step; repeated synthetic tests cannot establish that access.
