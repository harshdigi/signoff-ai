-- One file, applied on startup when user_version < 1. Timestamps are ISO-8601 local-time strings with the UTC offset, as in the prototype.
-- journal_mode and foreign_keys are set per connection in index.ts (pragmas don't belong in a migration).

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, title TEXT, description TEXT, note TEXT, ticket TEXT,
  state TEXT NOT NULL CHECK (state IN ('starting','working','waiting','done')),
  cwd TEXT, branch TEXT, tty TEXT, pid INTEGER, archived INTEGER NOT NULL DEFAULT 0,
  via TEXT,                                  -- 'board' when started from the app
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,                       -- "<ticket>/<number>", e.g. ABC-8977/D48
  ticket TEXT NOT NULL, number TEXT NOT NULL, session_id TEXT REFERENCES sessions(id),
  question TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', recommend TEXT,
  evidence TEXT NOT NULL DEFAULT '[]', refs TEXT NOT NULL DEFAULT '[]',   -- JSON arrays
  action TEXT CHECK (action IN ('consent','terminal')), command TEXT,
  kind TEXT, item TEXT,                      -- company decisions (approve / apply a backlog item)
  status TEXT NOT NULL CHECK (status IN ('open','answered','applied','withdrawn')),
  answer TEXT, answered_by TEXT, answered_at TEXT,
  applied_by TEXT, applied_at TEXT,          -- set by `signoff ack`
  withdrawn_reason TEXT, withdrawn_by TEXT, withdrawn_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX decisions_open ON decisions(status, ticket);
CREATE INDEX decisions_session ON decisions(session_id);

CREATE TABLE decision_thread (
  id INTEGER PRIMARY KEY, decision_id TEXT NOT NULL REFERENCES decisions(id),
  who TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY, ticket TEXT NOT NULL, session_id TEXT REFERENCES sessions(id),
  title TEXT NOT NULL, summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','accepted','changes_requested')),
  note TEXT, created_at TEXT NOT NULL, submitted_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE review_changes (
  review_id TEXT NOT NULL REFERENCES reviews(id), change_id TEXT NOT NULL,
  file TEXT NOT NULL, diff TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pending','accept','reject','question')), comment TEXT,
  PRIMARY KEY (review_id, change_id)
);
CREATE TABLE review_thread (
  id INTEGER PRIMARY KEY, review_id TEXT NOT NULL, change_id TEXT NOT NULL,
  who TEXT NOT NULL, text TEXT NOT NULL, verdict TEXT, at TEXT NOT NULL,
  FOREIGN KEY (review_id, change_id) REFERENCES review_changes(review_id, change_id)
);

CREATE TABLE messages (                      -- board -> session inbox
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  text TEXT NOT NULL, by TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, via TEXT
);
CREATE INDEX messages_pending ON messages(session_id, delivered_at);

CREATE TABLE backlog (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, problem TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected','building','review','ready','applied','failed')),
  extra TEXT NOT NULL DEFAULT '{}',          -- dev_summary, headline, review notes, backup paths
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, item TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','failed','stopped')),
  cap_usd REAL, cost_usd REAL, denied INTEGER, exit_code INTEGER, summary TEXT,
  started_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- usage ceilings, paused, etc. (JSON)

PRAGMA user_version = 1;
