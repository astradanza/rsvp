-- Public wall on each profile. The Worker also creates this on first request (ensureSchema in src/index.js).
CREATE TABLE IF NOT EXISTS wall (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS wall_owner ON wall(owner_id, created_at);
