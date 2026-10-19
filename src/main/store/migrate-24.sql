-- v24: Close ticket (SIGNOFF-28/D1): a closed ticket leaves the Sessions list and shows under Show removed.
ALTER TABLE tickets ADD COLUMN closed_at TEXT;
PRAGMA user_version = 24;
