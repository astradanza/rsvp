-- Two lists per event: guestlist and friends & family tickets. The Worker also applies this on first request.
ALTER TABLE events ADD COLUMN gl_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN ff_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN ff_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN ff_token TEXT NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN list TEXT NOT NULL DEFAULT 'gl';
ALTER TABLE guest_requests ADD COLUMN list TEXT NOT NULL DEFAULT 'gl';
