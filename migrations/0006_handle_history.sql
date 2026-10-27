-- Old handles keep pointing to their owner after a rename. The Worker also creates this on first request.
CREATE TABLE IF NOT EXISTS handle_history (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
