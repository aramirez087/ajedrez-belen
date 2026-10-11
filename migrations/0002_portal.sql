PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE athletes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  fee_minor INTEGER NOT NULL CHECK(fee_minor IN (1200000,1500000)),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0 AND discount_minor <= fee_minor),
  discount_reason TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  start_period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(discount_minor = 0 OR length(trim(discount_reason)) > 0)
);
CREATE TABLE guardian_links (
  user_id TEXT NOT NULL REFERENCES users(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  receipt_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(receipt_opt_in IN (0,1)),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,athlete_id)
);
CREATE INDEX guardian_links_athlete ON guardian_links(athlete_id,active);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  athlete_ids_json TEXT NOT NULL CHECK(json_valid(athlete_ids_json)),
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  redeemed_at TEXT,
  redemption_token TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  base_minor INTEGER NOT NULL CHECK(base_minor IN (1200000,1500000)),
  discount_minor INTEGER NOT NULL CHECK(discount_minor >= 0 AND discount_minor <= base_minor),
  discount_reason TEXT,
  published_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(athlete_id,period),
  CHECK(length(period)=7 AND substr(period,5,1)='-' AND substr(period,6,2) BETWEEN '01' AND '12'),
  CHECK(discount_minor=0 OR length(trim(discount_reason))>0)
);
CREATE INDEX charges_period ON charges(period,athlete_id);
CREATE TABLE charge_adjustments (
  id TEXT PRIMARY KEY,
  charge_id TEXT NOT NULL REFERENCES charges(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor <> 0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX charge_adjustments_charge ON charge_adjustments(charge_id);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  designated_user_id TEXT NOT NULL REFERENCES users(id),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  share_evidence INTEGER NOT NULL DEFAULT 1 CHECK(share_evidence IN (0,1)),
  payer_name TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  transfer_date TEXT NOT NULL,
  bank_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs_info','rejected','verified','void')),
  review_note TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_amount_minor INTEGER CHECK(verified_amount_minor>0),
  verified_date TEXT,
  verified_reference TEXT,
  verified_bank_name TEXT,
  verified_receiving_account TEXT,
  bank_match_key TEXT,
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  approval_token TEXT UNIQUE,
  voided_by TEXT REFERENCES users(id),
  voided_at TEXT,
  CHECK(status NOT IN ('verified','void') OR (verified_amount_minor IS NOT NULL AND verified_reference IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND bank_match_key IS NOT NULL))
);
CREATE UNIQUE INDEX payments_bank_match ON payments(bank_match_key) WHERE status='verified';
CREATE INDEX payments_designated ON payments(designated_user_id,submitted_at DESC);
CREATE INDEX payments_status ON payments(status,submitted_at);
CREATE TABLE payment_revisions (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  revision INTEGER NOT NULL,
  payer_name TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  transfer_date TEXT NOT NULL,
  bank_reference TEXT NOT NULL,
  requested_allocations_json TEXT NOT NULL CHECK(json_valid(requested_allocations_json)),
  note TEXT,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(payment_id,revision)
);
CREATE TABLE payment_files (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  revision INTEGER NOT NULL,
  file_key TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL CHECK(file_type IN ('image/png','image/jpeg','application/pdf')),
  file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=3145728),
  file_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(payment_id,revision)
);
CREATE TABLE payment_requested_allocations (
  payment_id TEXT NOT NULL REFERENCES payments(id),
  charge_id TEXT NOT NULL REFERENCES charges(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(payment_id,charge_id)
);
CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  charge_id TEXT NOT NULL REFERENCES charges(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  created_at TEXT NOT NULL,
  CHECK(amount_minor>0)
);
CREATE INDEX payment_allocations_charge ON payment_allocations(charge_id,payment_id);
CREATE TABLE receipt_counters (year INTEGER PRIMARY KEY, sequence INTEGER NOT NULL CHECK(sequence>0));
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  number TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','void')),
  void_reason TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(year,sequence),
  CHECK(status='issued' OR (length(trim(void_reason))>0 AND voided_at IS NOT NULL))
);
CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'receipt' CHECK(kind IN ('receipt','receipt_void')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','dry_run','accepted','blocked','rejected','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TEXT NOT NULL,
  claimed_at TEXT,
  claim_token TEXT,
  last_error_code TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(receipt_id,recipient_id,kind)
);
CREATE INDEX email_outbox_due ON email_outbox(status,next_attempt_at);
CREATE TABLE portal_email_daily_budget (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts>=0 AND attempts<=250));
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX audit_events_entity ON audit_events(entity_type,entity_id,created_at);

-- These checks run inside D1's transactional batch, including under concurrent approvals.
-- WHERE preserves CASE/NULL behavior without nested END tokens in D1's remote SQL parser.
CREATE TRIGGER allocation_payment_total BEFORE INSERT ON payment_allocations BEGIN
  SELECT RAISE(ABORT,'payment_not_verified') WHERE (SELECT status FROM payments WHERE id=NEW.payment_id)<>'verified';
  SELECT RAISE(ABORT,'allocation_guardian_revoked') WHERE NOT EXISTS(SELECT 1 FROM guardian_links l JOIN charges c ON c.athlete_id=l.athlete_id JOIN payments p ON p.designated_user_id=l.user_id WHERE c.id=NEW.charge_id AND p.id=NEW.payment_id AND l.active=1);
  SELECT RAISE(ABORT,'allocation_exceeds_payment') WHERE NEW.amount_minor+COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=NEW.payment_id),0)>(SELECT verified_amount_minor FROM payments WHERE id=NEW.payment_id);
  SELECT RAISE(ABORT,'allocation_exceeds_charge') WHERE NEW.amount_minor+COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=NEW.charge_id AND p.status='verified'),0)>(SELECT base_minor-discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=NEW.charge_id),0) FROM charges WHERE id=NEW.charge_id);
END;
CREATE TRIGGER adjustment_balance BEFORE INSERT ON charge_adjustments BEGIN
  SELECT RAISE(ABORT,'adjustment_below_paid') WHERE (SELECT base_minor-discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=NEW.charge_id),0) FROM charges WHERE id=NEW.charge_id)+NEW.amount_minor<COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=NEW.charge_id AND p.status='verified'),0);
END;
CREATE TRIGGER immutable_receipt BEFORE UPDATE OF number,year,sequence,snapshot_json,payment_id,created_at ON receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER no_receipt_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER immutable_allocations BEFORE UPDATE ON payment_allocations BEGIN SELECT RAISE(ABORT,'immutable_allocations'); END;
CREATE TRIGGER no_allocation_delete BEFORE DELETE ON payment_allocations BEGIN SELECT RAISE(ABORT,'immutable_allocations'); END;
CREATE TRIGGER immutable_revisions BEFORE UPDATE ON payment_revisions BEGIN SELECT RAISE(ABORT,'immutable_revision'); END;
CREATE TRIGGER immutable_audit BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER immutable_email_recipient BEFORE UPDATE OF receipt_id,recipient_id,recipient_email,recipient_name,kind,created_at ON email_outbox BEGIN SELECT RAISE(ABORT,'immutable_email_recipient'); END;
CREATE TRIGGER payment_submission_budget BEFORE INSERT ON payments BEGIN
  SELECT RAISE(ABORT,'pending_payment_limit') WHERE (SELECT count(*) FROM payments WHERE designated_user_id=NEW.designated_user_id AND status IN ('pending','needs_info'))>=10;
  SELECT RAISE(ABORT,'daily_payment_limit') WHERE (SELECT count(*) FROM payments WHERE submitted_by=NEW.submitted_by AND substr(submitted_at,1,10)=substr(NEW.submitted_at,1,10))>=20;
END;
CREATE TRIGGER file_storage_budget BEFORE INSERT ON payment_files BEGIN
  SELECT RAISE(ABORT,'storage_limit') WHERE NEW.file_size+COALESCE((SELECT sum(file_size) FROM payment_files),0)>5000000000;
END;
CREATE TRIGGER immutable_charge BEFORE UPDATE ON charges BEGIN SELECT RAISE(ABORT,'immutable_charge'); END;
CREATE TRIGGER immutable_adjustment BEFORE UPDATE ON charge_adjustments BEGIN SELECT RAISE(ABORT,'immutable_adjustment'); END;
CREATE TRIGGER no_adjustment_delete BEFORE DELETE ON charge_adjustments BEGIN SELECT RAISE(ABORT,'immutable_adjustment'); END;
CREATE TRIGGER no_revision_delete BEFORE DELETE ON payment_revisions BEGIN SELECT RAISE(ABORT,'immutable_revision'); END;
CREATE TRIGGER immutable_file BEFORE UPDATE ON payment_files BEGIN SELECT RAISE(ABORT,'immutable_file'); END;
CREATE TRIGGER athlete_budget BEFORE INSERT ON athletes WHEN NOT EXISTS(SELECT 1 FROM athletes WHERE id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'athlete_limit') WHERE (SELECT count(*) FROM athletes)>=300;
END;
CREATE TRIGGER immutable_verified_payment BEFORE UPDATE OF payer_name,amount_minor,transfer_date,bank_reference,designated_user_id,submitted_by,share_evidence,verified_amount_minor,verified_date,verified_reference,verified_bank_name,verified_receiving_account,bank_match_key,verified_by,verified_at ON payments WHEN OLD.status IN ('verified','void') BEGIN SELECT RAISE(ABORT,'immutable_verified_payment'); END;
CREATE TRIGGER payment_transition BEFORE UPDATE OF status ON payments BEGIN
  SELECT RAISE(ABORT,'invalid_payment_transition') WHERE OLD.status='void' AND NEW.status<>'void';
  SELECT RAISE(ABORT,'invalid_payment_transition') WHERE OLD.status='verified' AND NEW.status NOT IN ('verified','void');
  SELECT RAISE(ABORT,'invalid_payment_transition') WHERE OLD.status='rejected' AND NEW.status<>'rejected';
END;
