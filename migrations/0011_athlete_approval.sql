-- Inscription approval: a self-registered athlete is pending until an
-- administrator approves it. Athletes that already exist are grandfathered
-- as approved. A not-approved athlete is always inactive, so every query that
-- bills, discounts or rosters on active=1 leaves it out by default.
ALTER TABLE athletes ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved','rejected','withdrawn'));
ALTER TABLE athletes ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE athletes ADD COLUMN reviewed_at TEXT;
ALTER TABLE athletes ADD COLUMN review_note TEXT;

CREATE TRIGGER athlete_unapproved_inactive_insert BEFORE INSERT ON athletes
WHEN NEW.approval_status<>'approved' AND NEW.active=1
BEGIN SELECT RAISE(ABORT,'athlete_unapproved_active'); END;

CREATE TRIGGER athlete_unapproved_inactive_update BEFORE UPDATE OF active, approval_status ON athletes
WHEN NEW.approval_status<>'approved' AND NEW.active=1
BEGIN SELECT RAISE(ABORT,'athlete_unapproved_active'); END;

-- Only a pending request can be decided; approved, rejected and withdrawn are final.
CREATE TRIGGER athlete_approval_final BEFORE UPDATE OF approval_status ON athletes
WHEN NEW.approval_status<>OLD.approval_status AND OLD.approval_status<>'pending'
BEGIN SELECT RAISE(ABORT,'athlete_approval_final'); END;

-- The 300-athlete budget is for members and waiting requests. Rejected and
-- withdrawn rows are history and must not use it up.
DROP TRIGGER athlete_budget;
CREATE TRIGGER athlete_budget BEFORE INSERT ON athletes WHEN NOT EXISTS(SELECT 1 FROM athletes WHERE id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'athlete_limit') WHERE (SELECT count(*) FROM athletes WHERE approval_status IN ('pending','approved'))>=300;
END;
