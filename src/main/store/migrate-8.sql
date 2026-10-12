-- v8: chats are terminal sessions (the chat panel talks to a real Claude Code terminal).
-- Where Claude Code saves each session's conversation (from the SessionStart hook's transcript_path).
ALTER TABLE sessions ADD COLUMN transcript TEXT;
-- Permission prompts can now also be left to the terminal: status 'terminal' (the user chose to answer there,
-- or nobody answered in time). SQLite cannot change a CHECK constraint, so the table is rebuilt.
CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool_name TEXT NOT NULL, input TEXT NOT NULL, tool_use_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','allowed','denied','terminal')),
  scope TEXT CHECK (scope IN ('once','chat')),
  result TEXT,
  created_at TEXT NOT NULL, answered_at TEXT
);
INSERT INTO approvals_new SELECT * FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_new RENAME TO approvals;
CREATE INDEX approvals_pending ON approvals(session_id) WHERE status = 'pending';
PRAGMA user_version = 8;
