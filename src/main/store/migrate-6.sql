-- v6: the ticket pipeline (IDE/D16 C).
CREATE TABLE tickets (
  key TEXT PRIMARY KEY,                      -- e.g. ABC-8977
  title TEXT, folder TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('main','stacked')),
  plan_session TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE subtasks (
  ticket TEXT NOT NULL REFERENCES tickets(key),
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  decisions TEXT NOT NULL DEFAULT '[]',      -- JSON: decision ids this subtask implements
  jira_key TEXT, branch TEXT, worktree TEXT, session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','review','done')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (ticket, idx)
);
PRAGMA user_version = 6;
