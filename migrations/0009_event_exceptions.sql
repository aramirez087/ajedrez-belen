-- Per-occurrence cancellations (skip one week of a series without killing
-- it), image alt text for screen readers, and an idempotency key so a
-- retried create cannot duplicate a series.
ALTER TABLE events ADD COLUMN image_alt TEXT CHECK(image_alt IS NULL OR length(image_alt) <= 200);
ALTER TABLE events ADD COLUMN submission_id TEXT;
CREATE UNIQUE INDEX events_submission ON events(submission_id) WHERE submission_id IS NOT NULL;
CREATE TABLE event_exceptions (
  event_id TEXT NOT NULL REFERENCES events(id),
  occurrence_start TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'cancelled' CHECK(kind IN ('cancelled')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(event_id, occurrence_start)
);
