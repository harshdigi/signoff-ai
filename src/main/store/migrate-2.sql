-- v2: the IDE chat (D9, D10, D15).
CREATE TABLE chat_events (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,                       -- one Claude stream-json event, or our own {type:'prompt'|'error'}
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE approvals (                     -- permission prompts from chat sessions (signoff mcp)
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool_name TEXT NOT NULL, input TEXT NOT NULL, tool_use_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','allowed','denied')),
  scope TEXT CHECK (scope IN ('once','chat')),
  result TEXT,                               -- the JSON handed back to Claude Code
  created_at TEXT NOT NULL, answered_at TEXT
);
CREATE INDEX approvals_pending ON approvals(session_id) WHERE status = 'pending';

ALTER TABLE sessions ADD COLUMN mode TEXT;   -- chat permission mode
ALTER TABLE sessions ADD COLUMN model TEXT;

PRAGMA user_version = 2;
