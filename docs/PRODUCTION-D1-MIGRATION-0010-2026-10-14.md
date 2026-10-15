# Production D1 migration 0010 — 14 October 2026 (Costa Rica)

The production administrator page reported that its tables were missing. Its database query uses `admin_grants` and `admin_invitations`, both introduced by `0010_admin_invitations.sql`.

The target was Cloudflare account `7d3e79129c4f0b3619a419cabbfa021e`, D1 `ajedrez-belen-portal-production`, UUID `ffa2abc9-acce-44e0-ab96-c2cf68a13f13`. Before the change, the remote `d1_migrations` ledger contained `0001`–`0009`; Wrangler listed only `0010_admin_invitations.sql` as pending. `users` and `audit_events`, its required existing tables, were present. The two administrator tables were absent. The reviewed migration SHA-256 was `e366356a19d5d003500b3b1b8da4e107ad4d3c85730eb852179ca3e396737159`. Six focused administrator tests passed.

A pre-change D1 Time Travel bookmark was recorded privately at `output/production-migrations/0010-admin-invitations-recovery.json` (ignored by Git, owner-readable only). This is a reference for a separately assessed recovery, not authorization to restore an active database and discard later writes.

The owner requested that pending migrations be applied. At `2026-10-15 00:14:46 UTC`, the lockfile-installed Wrangler applied the single pending file with the production config, `--remote`, and `--env-file /dev/null`. Wrangler reported success. No Worker, route, runtime variable, R2 object, email, or user grant was changed by this operation.

Afterward, the remote migration ledger included `0010_admin_invitations.sql`, and Wrangler reported **no migrations to apply**. Read-only SQL confirmed `admin_invitations`, `admin_grants`, and index `admin_invitations_email`; both new tables had zero rows. Anonymous HTTPS checks returned 200 for the public landing and 401 for the protected administrator URL. An authenticated page refresh was not performed, so those checks do not prove the rendered owner view.

The earlier [migration release checklist](MIGRATION-RELEASE-CHECKLIST.md) describes a preparation state before this production database and later migrations existed. It is not a current migration ledger. The checked remote D1 state above is the evidence for this operation.
