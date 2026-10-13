-- Internal events calendar: admins publish events (including the weekly
-- Zoom call) that every signed-in family can see. No RSVP in this version.
-- Times are instants (UTC ISO); the portal renders and expands recurrence
-- in America/Costa_Rica. Images live in R2 under events/ (SLIPS bucket).
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0 AND length(title) <= 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0, 1)),
  location_type TEXT NOT NULL CHECK(location_type IN ('online', 'in_person', 'hybrid')),
  location_label TEXT CHECK(location_label IS NULL OR length(location_label) <= 120),
  location_url TEXT CHECK(location_url IS NULL OR length(location_url) <= 2048),
  location_address TEXT CHECK(location_address IS NULL OR length(location_address) <= 300),
  image_key TEXT,
  image_type TEXT CHECK(image_type IS NULL OR image_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_size INTEGER CHECK(image_size IS NULL OR (image_size > 0 AND image_size <= 3145728)),
  image_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published', 'cancelled')),
  recurrence_freq TEXT NOT NULL DEFAULT 'none' CHECK(recurrence_freq IN ('none', 'weekly', 'monthly', 'yearly')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK(recurrence_interval BETWEEN 1 AND 12),
  recurrence_until TEXT,
  recurrence_count INTEGER CHECK(recurrence_count IS NULL OR recurrence_count BETWEEN 1 AND 104),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(ends_at > starts_at),
  CHECK(recurrence_freq = 'none' OR recurrence_until IS NOT NULL OR recurrence_count IS NOT NULL OR 1 = 1),
  CHECK(location_type NOT IN ('online', 'hybrid') OR length(trim(location_url)) > 0),
  CHECK(location_type NOT IN ('in_person', 'hybrid') OR length(trim(location_address)) > 0),
  CHECK(image_key IS NULL OR image_type IS NOT NULL)
);
CREATE INDEX events_starts ON events(status, starts_at);
CREATE INDEX events_created_by ON events(created_by, created_at DESC);
