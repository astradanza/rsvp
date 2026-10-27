-- External ticket link for events (e.g. an existing ticketing page). The Worker also adds it on first request.
ALTER TABLE events ADD COLUMN ticket_url TEXT NOT NULL DEFAULT '';
