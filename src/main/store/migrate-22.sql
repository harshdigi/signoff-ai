-- v22: monitors (SIGNOFF-23). One watch per pull request, from CI to production stability, and what each repo's
-- monitoring uses (found by Claude, chosen by you).
CREATE TABLE monitors (
  id TEXT PRIMARY KEY,                         -- M-1, M-2, …
  session_id TEXT REFERENCES sessions(id),     -- the session that started it (an implementer, or the lead for its team)
  repo TEXT NOT NULL,                          -- owner/name, as the forge names it
  pr INTEGER NOT NULL,
  ticket TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('ci','merge','deploy','stable','done','incident','stopped')),
  window_minutes INTEGER NOT NULL,             -- how long to watch production after the deploy
  check_minutes INTEGER NOT NULL,              -- how often the error check runs during that window
  notify INTEGER NOT NULL DEFAULT 0,           -- send the review request when CI passes (opt-in, D2)
  recipients TEXT,                             -- JSON: [{ app, where, tags: [] }]
  merge_sha TEXT, deployed_at TEXT, firefight_session TEXT REFERENCES sessions(id),
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Never two live monitors on the same pull request.
CREATE UNIQUE INDEX monitors_live ON monitors(repo, pr) WHERE stage NOT IN ('done','stopped');
CREATE TABLE monitor_events (
  id INTEGER PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id),
  at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX monitor_events_by_monitor ON monitor_events(monitor_id, id);
CREATE TABLE repo_setups (
  repo TEXT PRIMARY KEY,
  profile TEXT NOT NULL,                       -- JSON: the tools Claude found and the ones you chose, with their details
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 22;
