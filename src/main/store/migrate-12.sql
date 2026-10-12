-- v12: clearer decisions. context: JSON list of "what's going on" points; if_wrong: how costly or reversible a wrong choice is.
ALTER TABLE decisions ADD COLUMN context TEXT NOT NULL DEFAULT '[]';
ALTER TABLE decisions ADD COLUMN if_wrong TEXT;
PRAGMA user_version = 12;
