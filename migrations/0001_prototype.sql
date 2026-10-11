-- This isolated table contains synthetic compatibility probes, not live payments.
CREATE TABLE prototype_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  file_key TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 3145728),
  file_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (email_status IN ('not_requested', 'sending', 'dry_run', 'accepted', 'blocked', 'rejected', 'unknown')),
  email_provider_id TEXT,
  CHECK (amount_minor + discount_minor = 1200000)
);
CREATE INDEX prototype_runs_owner_created ON prototype_runs(owner_id, created_at);
