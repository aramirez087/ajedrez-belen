-- Administrable fee schedule: the monthly fee is inferred from the athlete's
-- category. Admins can raise/lower the amount per category; the update rewrites
-- fee_minor on athletes of that category (published charges keep their snapshot).
-- The 0002 CHECKs pinning fees to ₡12.000/₡15.000 are relaxed to fee > 0 by
-- rebuilding athletes and charges with every column added through 0006.
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

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;
ALTER TABLE athletes RENAME TO athletes_old_0007;
CREATE TABLE athletes (
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
INSERT INTO athletes(id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at,birth_date,national_id,school,paused)
  SELECT id,name,category,fee_minor,discount_minor,discount_reason,active,start_period,created_at,updated_at,birth_date,national_id,school,paused FROM athletes_old_0007;
DROP TABLE athletes_old_0007;

ALTER TABLE charges RENAME TO charges_old_0007;
CREATE TABLE charges (
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
INSERT INTO charges(id,athlete_id,period,due_date,base_minor,discount_minor,discount_reason,published_by,created_at)
  SELECT id,athlete_id,period,due_date,base_minor,discount_minor,discount_reason,published_by,created_at FROM charges_old_0007;
DROP TABLE charges_old_0007;
CREATE INDEX charges_period ON charges(period,athlete_id);
PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
