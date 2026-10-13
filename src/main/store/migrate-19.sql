-- v19: a decision you put aside for later (Later on its card). later_at: when; NULL: not set aside.
-- It stays open, leaves "Waiting on you", and its session is told not to wait for it. Bring back clears it.
ALTER TABLE decisions ADD COLUMN later_at TEXT;
PRAGMA user_version = 19;
