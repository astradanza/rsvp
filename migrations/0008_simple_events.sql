-- Simple events: an image and a caption, public or private, a guestlist link, requests from people without an account.
-- The Worker also applies this on first request.
ALTER TABLE events ADD COLUMN image TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN caption TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE events ADD COLUMN allow_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN gl_token TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS guest_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS guest_requests_event ON guest_requests(event_id, status);
