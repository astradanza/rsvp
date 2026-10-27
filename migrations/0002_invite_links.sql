-- Personal invite links (one link per member, limited number of sign-ups) and ambassadors.
-- The Worker also applies this on first request if the columns are missing (see ensureSchema in src/index.js).
ALTER TABLE users ADD COLUMN invite_link TEXT;
ALTER TABLE users ADD COLUMN invite_quota INTEGER NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN invited_by INTEGER;
ALTER TABLE users ADD COLUMN ambassador INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_invite_link ON users(invite_link);
CREATE INDEX IF NOT EXISTS users_invited_by ON users(invited_by);
