-- v23: autonomy per session (SIGNOFF-24): what Claude may decide on your behalf, as { mode, items }. Empty: the default
-- from Settings applies.
ALTER TABLE sessions ADD COLUMN autonomy TEXT;
PRAGMA user_version = 23;
