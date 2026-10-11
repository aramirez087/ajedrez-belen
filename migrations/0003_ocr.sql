-- Original evidence is uploaded first. OCR suggestions are separate, unverified data.
CREATE TABLE slip_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL CHECK(file_type IN ('image/png','image/jpeg','application/pdf')),
  file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=3145728),
  file_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','attached','deleting','deleted')),
  payment_file_id TEXT UNIQUE REFERENCES payment_files(id),
  cleanup_token TEXT,
  CHECK(state<>'attached' OR payment_file_id IS NOT NULL)
);
CREATE INDEX slip_drafts_owner_state ON slip_drafts(owner_id,state,expires_at);
CREATE INDEX slip_drafts_expiry ON slip_drafts(state,expires_at);
CREATE TABLE slip_extractions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES slip_drafts(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  file_sha256 TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('original','pdf_preview')),
  source_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('demo','groq')),
  status TEXT NOT NULL CHECK(status IN ('sending','ready','failed','unavailable')),
  suggestions_json TEXT CHECK(suggestions_json IS NULL OR json_valid(suggestions_json)),
  model TEXT,
  error_code TEXT,
  claim_token TEXT NOT NULL UNIQUE,
  claim_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK(status<>'ready' OR suggestions_json IS NOT NULL)
);
CREATE INDEX slip_extractions_draft ON slip_extractions(draft_id,created_at DESC);
CREATE INDEX slip_extractions_cache ON slip_extractions(owner_id,file_sha256,source_sha256,mode,status);
CREATE INDEX slip_extractions_claim ON slip_extractions(mode,status,claim_expires_at);
CREATE TABLE ocr_daily_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  PRIMARY KEY(day,scope)
);
CREATE TABLE ocr_minute_budget (
  minute TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=2)
);
CREATE TRIGGER draft_upload_budget BEFORE INSERT ON slip_drafts BEGIN
  SELECT RAISE(ABORT,'draft_limit') WHERE (SELECT count(*) FROM slip_drafts WHERE owner_id=NEW.owner_id AND state IN ('draft','deleting'))>=5;
  SELECT RAISE(ABORT,'draft_limit') WHERE NEW.file_size+COALESCE((SELECT sum(file_size) FROM slip_drafts WHERE owner_id=NEW.owner_id AND state IN ('draft','deleting')),0)>15728640;
  SELECT RAISE(ABORT,'draft_limit') WHERE NEW.file_size+COALESCE((SELECT sum(file_size) FROM slip_drafts WHERE state IN ('draft','deleting')),0)>104857600;
END;
CREATE TRIGGER immutable_draft_evidence BEFORE UPDATE OF owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at ON slip_drafts BEGIN SELECT RAISE(ABORT,'immutable_draft_evidence'); END;
CREATE TRIGGER draft_attach_valid BEFORE UPDATE OF state,payment_file_id ON slip_drafts WHEN NEW.state='attached' BEGIN
  SELECT RAISE(ABORT,'draft_file_mismatch') WHERE NOT EXISTS(SELECT 1 FROM payment_files f WHERE f.id=NEW.payment_file_id AND f.file_key=NEW.object_key AND f.file_sha256=NEW.file_sha256 AND f.file_size=NEW.file_size AND f.file_type=NEW.file_type);
END;
CREATE TRIGGER protect_financial_evidence BEFORE UPDATE OF state ON slip_drafts WHEN NEW.state IN ('deleting','deleted') BEGIN
  SELECT RAISE(ABORT,'financial_evidence_referenced') WHERE EXISTS(SELECT 1 FROM payment_files WHERE file_key=OLD.object_key);
END;
CREATE TRIGGER draft_file_reference BEFORE INSERT ON payment_files WHEN EXISTS(SELECT 1 FROM slip_drafts WHERE object_key=NEW.file_key) BEGIN
  SELECT RAISE(ABORT,'draft_unavailable') WHERE NOT EXISTS(SELECT 1 FROM slip_drafts d JOIN payment_revisions r ON r.payment_id=NEW.payment_id AND r.revision=NEW.revision WHERE d.object_key=NEW.file_key AND d.state='draft' AND d.expires_at>NEW.created_at AND d.owner_id=r.recorded_by AND d.file_sha256=NEW.file_sha256 AND d.file_type=NEW.file_type AND d.file_size=NEW.file_size);
END;
CREATE TRIGGER immutable_extraction_source BEFORE UPDATE OF draft_id,owner_id,file_sha256,source_kind,source_sha256,mode,claim_token,created_at ON slip_extractions BEGIN SELECT RAISE(ABORT,'immutable_extraction_source'); END;
CREATE TRIGGER immutable_finished_extraction BEFORE UPDATE OF status,suggestions_json,model,error_code,finished_at ON slip_extractions WHEN OLD.status<>'sending' BEGIN SELECT RAISE(ABORT,'immutable_finished_extraction'); END;
