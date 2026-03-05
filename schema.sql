PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  location TEXT NOT NULL,
  lat REAL,
  lng REAL,
  category TEXT NOT NULL DEFAULT 'vie_associative',
  is_draft INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_pending_start_datetime
ON events_pending(start_datetime);

CREATE INDEX IF NOT EXISTS idx_events_pending_status_start_datetime
ON events_pending(status, start_datetime);

CREATE INDEX IF NOT EXISTS idx_events_pending_category
ON events_pending(category);

CREATE INDEX IF NOT EXISTS idx_events_pending_location
ON events_pending(location);

CREATE INDEX IF NOT EXISTS idx_events_pending_is_draft
ON events_pending(is_draft);

CREATE TABLE IF NOT EXISTS events_published (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  location TEXT NOT NULL,
  lat REAL,
  lng REAL,
  category TEXT NOT NULL DEFAULT 'vie_associative',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_published_start_datetime
ON events_published(start_datetime);

CREATE INDEX IF NOT EXISTS idx_events_published_category
ON events_published(category);

CREATE INDEX IF NOT EXISTS idx_events_published_location
ON events_published(location);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'contributeur' CHECK (role IN ('admin', 'contributeur')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE TABLE IF NOT EXISTS category_colors (
  category_key TEXT PRIMARY KEY,
  color_hex TEXT NOT NULL,
  shape_key TEXT NOT NULL DEFAULT 'circle',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

