-- v20: the effort you last set in a chat (/effort from the composer). Claude Code does not report it, so the app keeps it.
ALTER TABLE sessions ADD COLUMN effort TEXT;
PRAGMA user_version = 20;
