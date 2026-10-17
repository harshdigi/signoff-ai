-- v23: autonomy per session (SIGNOFF-24): what Claude may decide on your behalf, as { mode, items }. Empty: the default
-- from Settings applies.
ALTER TABLE sessions ADD COLUMN autonomy TEXT;
-- Which checklist item a decision falls under, when Claude names one (so the board knows whether Claude may settle it).
ALTER TABLE decisions ADD COLUMN autonomy_item TEXT;  -- (decisions.item is the old company backlog link)
-- The Story page per ticket (SIGNOFF-24/D3): Claude's plain summary and "how it works" flow, kept until updated.
CREATE TABLE stories (ticket TEXT PRIMARY KEY, story TEXT NOT NULL, written_at TEXT NOT NULL);
PRAGMA user_version = 23;
