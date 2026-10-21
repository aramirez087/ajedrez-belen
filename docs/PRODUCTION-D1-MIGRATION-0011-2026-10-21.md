# Production D1 migration 0011 — 21 October 2026 (Costa Rica)

`0011_athlete_approval.sql` adds inscription approval: `athletes.approval_status` (`pending`, `approved`, `rejected`, `withdrawn`; existing rows default to `approved`), `reviewed_by`, `reviewed_at`, `review_note`, three triggers that keep unapproved athletes inactive and decisions final, and a replacement `athlete_budget` trigger that counts only pending and approved rows. Reviewed SHA-256: `9b8b2dac8061e8e3fe34e4d3bb7d3438588094d86740a645ca1d0f3522355ba3`. The suite passed 531/531 before the change.

The owner asked for the migration to be applied. It is additive, and the Worker currently deployed does not read the new column, so it keeps working against the new schema. The new code (main site and `workers/email-inbound`) was **not** deployed by this operation.

## Production

Target: account `7d3e79129c4f0b3619a419cabbfa021e`, D1 `ajedrez-belen-portal-production`, UUID `ffa2abc9-acce-44e0-ab96-c2cf68a13f13`. Before the change Wrangler listed only `0011_athlete_approval.sql` as pending; the table held 1 athlete, the old `athlete_budget` trigger existed and `approval_status` did not. A Time Travel bookmark was recorded privately at `output/production-migrations/0011-production-recovery.json` (Git-ignored, owner-readable only); it is a reference for a separately assessed recovery, not authorization to restore.

The lockfile-installed Wrangler applied the file with the production config, `--remote` and `--env-file /dev/null`; 10 commands ran and Wrangler reported success. Read-only checks afterwards: **No migrations to apply**, ledger entry present, the four `athlete_*` triggers present, and the existing athlete is `approved` and active.

## Staging

Target: D1 `ajedrez-belen-portal-staging`, UUID `5b80cc9e-48e1-43c5-8cdd-a3e785604e73`, same single pending file, 2 athletes before. Bookmark at `output/production-migrations/0011-staging-recovery.json`. Applied the same way; afterwards **No migrations to apply**, ledger and triggers present, both athletes `approved` and active.

## Not changed

No Worker, route, runtime variable, R2 object, email, user grant or athlete row was changed. Deploy order for the code: this migration is done, so the main site and `workers/email-inbound` can ship in either order.
