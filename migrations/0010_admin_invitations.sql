-- Administrators invited from the portal. The configured ADMIN_USER_IDS
-- remain the principal accounts and are never revoked from here.
CREATE TABLE admin_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  redeemed_at TEXT,
  redemption_token TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX admin_invitations_email ON admin_invitations(email, redeemed_at);
CREATE TABLE admin_grants (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  email TEXT NOT NULL COLLATE NOCASE,
  granted_by TEXT NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_by TEXT REFERENCES users(id)
);
