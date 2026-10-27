-- Claimable pages and linked accounts (switch between them). The Worker also applies this on first request.
ALTER TABLE users ADD COLUMN claim_token TEXT;
ALTER TABLE users ADD COLUMN account_group INTEGER;
