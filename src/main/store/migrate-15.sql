-- v15: code comments from review. A comment on lines of a changed file, sent to a session's chat (alone or batched);
-- Claude's answer is recorded against it, so it shows next to the code as well as in the chat.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  code TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'answered')),
  reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX comments_session ON comments(session_id);
PRAGMA user_version = 15;
