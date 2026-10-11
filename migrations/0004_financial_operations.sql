-- A completed operation and its ledger/audit writes commit in one D1 batch.
-- Keep keys for the life of the financial record: a delayed retry must stay safe.
CREATE TABLE financial_operations (
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('adjust_charge','apply_credit')),
  target_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  claim_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,action,target_id,operation_id)
);
CREATE TRIGGER immutable_financial_operation BEFORE UPDATE ON financial_operations
BEGIN SELECT RAISE(ABORT,'immutable_financial_operation'); END;
CREATE TRIGGER no_financial_operation_delete BEFORE DELETE ON financial_operations
BEGIN SELECT RAISE(ABORT,'immutable_financial_operation'); END;
