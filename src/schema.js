// Generated from migrations/0001_init.sql. The Worker applies it on first use, so no separate migration step is needed.
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users ( id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'member' CHECK (kind IN ('member', 'promoter', 'artist')), bio TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#E8A80C', is_admin INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')) )",
  "CREATE TABLE IF NOT EXISTS sessions ( token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL )",
  "CREATE TABLE IF NOT EXISTS invites ( code TEXT PRIMARY KEY, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, used_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), used_at TEXT )",
  "CREATE TABLE IF NOT EXISTS follows ( follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (follower_id, followee_id) )",
  "CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee_id)",
  "CREATE TABLE IF NOT EXISTS events ( id TEXT PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', entry TEXT NOT NULL DEFAULT 'guestlist' CHECK (entry IN ('guestlist', 'ticket')), price_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', commission_pct INTEGER NOT NULL DEFAULT 0, capacity INTEGER NOT NULL DEFAULT 0, lineup TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#E8A80C', created_at TEXT NOT NULL DEFAULT (datetime('now')) )",
  "CREATE INDEX IF NOT EXISTS events_host ON events(host_id)",
  "CREATE INDEX IF NOT EXISTS events_starts ON events(starts_at)",
  "CREATE TABLE IF NOT EXISTS rsvps ( event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, referrer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (event_id, user_id) )",
  "CREATE INDEX IF NOT EXISTS rsvps_user ON rsvps(user_id)",
  "CREATE INDEX IF NOT EXISTS rsvps_referrer ON rsvps(referrer_id)",
  "CREATE TABLE IF NOT EXISTS posts ( id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, event_id TEXT REFERENCES events(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')) )",
  "CREATE INDEX IF NOT EXISTS posts_author ON posts(author_id, created_at)",
  "CREATE TABLE IF NOT EXISTS reposts ( post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (post_id, user_id) )",
  "CREATE INDEX IF NOT EXISTS reposts_user ON reposts(user_id, created_at)"
];
