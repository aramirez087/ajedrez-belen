-- Self-service athlete registration: a registration invitation lets the
-- invited guardian enroll their own athletes (replaces the Google Form).
ALTER TABLE invitations ADD COLUMN kind TEXT NOT NULL DEFAULT 'link' CHECK(kind IN ('link','register'));
ALTER TABLE athletes ADD COLUMN birth_date TEXT;
ALTER TABLE athletes ADD COLUMN national_id TEXT;
ALTER TABLE athletes ADD COLUMN school TEXT;
-- Membership pause (admin): a paused athlete stays enrolled and keeps access
-- and history, but monthly publication skips them until resumed.
ALTER TABLE athletes ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1));
