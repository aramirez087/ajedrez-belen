CREATE TABLE email_inbound (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  sender_email TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  draft_id TEXT REFERENCES slip_drafts(id),
  status TEXT NOT NULL CHECK(status IN ('draft_created','duplicate','rejected')),
  created_at TEXT NOT NULL
);
CREATE INDEX email_inbound_owner_created ON email_inbound(owner_id, created_at);
