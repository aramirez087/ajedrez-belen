-- Administrable fee schedule: the monthly fee is inferred from the athlete's
-- category. Admins can raise/lower the amount per category; the update rewrites
-- fee_minor on athletes of that category (published charges keep their snapshot).
-- The 0002 CHECKs pinning fees to ₡12.000/₡15.000 are relaxed to fee > 0 by
-- rebuilding athletes and charges with every column added through 0006.
-- Triggers referencing those tables are dropped first and recreated verbatim;
-- foreign keys are deferred until the rebuilt tables are in place (D1 pattern).
CREATE TABLE fee_schedule (
  category TEXT PRIMARY KEY,
  fee_minor INTEGER NOT NULL CHECK(fee_minor > 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
INSERT INTO fee_schedule(category, fee_minor, updated_at, updated_by) VALUES
  ('Iniciación', 1200000, '2026-01-01T00:00:00.000Z', NULL),
  ('Cadetes', 1500000, '2026-01-01T00:00:00.000Z', NULL),
  ('Intermedios', 1500000, '2026-01-01T00:00:00.000Z', NULL),
  ('Avanzados', 1500000, '2026-01-01T00:00:00.000Z', NULL);

PRAGMA defer_foreign_keys = true;
DROP TRIGGER IF EXISTS athlete_budget;
DROP TRIGGER IF EXISTS immutable_charge;
DROP TRIGGER IF EXISTS adjustment_balance;
DROP TRIGGER IF EXISTS allocation_payment_total;

CREATE TABLE athletes_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  fee_minor INTEGER NOT NULL CHECK(fee_minor > 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0 AND discount_minor <= fee_minor),
  discount_reason TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  start_period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  birth_date TEXT,
  national_id TEXT,
  school TEXT,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  CHECK(discount_minor = 0 OR length(trim(discount_reason)) > 0)
);
INSERT INTO athletes_new(id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at,birth_date,national_id,school,paused)
  SELECT id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at,birth_date,national_id,school,paused FROM athletes;
DROP TABLE athletes;
ALTER TABLE athletes_new RENAME TO athletes;

CREATE TABLE charges_new (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES athletes(id),
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  base_minor INTEGER NOT NULL CHECK(base_minor > 0),
  discount_minor INTEGER NOT NULL CHECK(discount_minor >= 0 AND discount_minor <= base_minor),
  discount_reason TEXT,
  published_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(athlete_id,period),
  CHECK(length(period)=7 AND substr(period,5,1)='-' AND substr(period,6,2) BETWEEN '01' AND '12'),
  CHECK(discount_minor=0 OR length(trim(discount_reason))>0)
);
INSERT INTO charges_new(id,athlete_id,period,due_date,base_minor,discount_minor,discount_reason,published_by,created_at)
  SELECT id,athlete_id,period,due_date,base_minor,discount_minor,discount_reason,published_by,created_at FROM charges;
DROP TABLE charges;
ALTER TABLE charges_new RENAME TO charges;
CREATE INDEX charges_period ON charges(period,athlete_id);

CREATE TRIGGER athlete_budget BEFORE INSERT ON athletes WHEN NOT EXISTS(SELECT 1 FROM athletes WHERE id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'athlete_limit') WHERE (SELECT count(*) FROM athletes)>=300;
END;
CREATE TRIGGER immutable_charge BEFORE UPDATE ON charges BEGIN SELECT RAISE(ABORT,'immutable_charge'); END;
CREATE TRIGGER adjustment_balance BEFORE INSERT ON charge_adjustments BEGIN
  SELECT RAISE(ABORT,'adjustment_below_paid') WHERE (SELECT base_minor-discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=NEW.charge_id),0) FROM charges WHERE id=NEW.charge_id)+NEW.amount_minor<COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=NEW.charge_id AND p.status='verified'),0);
END;
CREATE TRIGGER allocation_payment_total BEFORE INSERT ON payment_allocations BEGIN
  SELECT RAISE(ABORT,'payment_not_verified') WHERE (SELECT status FROM payments WHERE id=NEW.payment_id)<>'verified';
  SELECT RAISE(ABORT,'allocation_guardian_revoked') WHERE NOT EXISTS(SELECT 1 FROM guardian_links l JOIN charges c ON c.athlete_id=l.athlete_id JOIN payments p ON p.designated_user_id=l.user_id WHERE c.id=NEW.charge_id AND p.id=NEW.payment_id AND l.active=1);
  SELECT RAISE(ABORT,'allocation_exceeds_payment') WHERE NEW.amount_minor+COALESCE((SELECT sum(amount_minor) FROM payment_allocations WHERE payment_id=NEW.payment_id),0)>(SELECT verified_amount_minor FROM payments WHERE id=NEW.payment_id);
  SELECT RAISE(ABORT,'allocation_exceeds_charge') WHERE NEW.amount_minor+COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=NEW.charge_id AND p.status='verified'),0)>(SELECT base_minor-discount_minor+COALESCE((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=NEW.charge_id),0) FROM charges WHERE id=NEW.charge_id);
END;
-- Los datos ya están reconciliados en las tablas reconstruidas: cerrar la
-- ventana diferida obliga a verificar las llaves foráneas en este punto.
PRAGMA defer_foreign_keys = off;
