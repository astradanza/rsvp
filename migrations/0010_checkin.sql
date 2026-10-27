-- Door check-in. The Worker also applies this on first request.
ALTER TABLE rsvps ADD COLUMN checked_in_at TEXT NOT NULL DEFAULT '';
ALTER TABLE guest_requests ADD COLUMN checked_in_at TEXT NOT NULL DEFAULT '';
