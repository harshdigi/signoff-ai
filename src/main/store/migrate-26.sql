-- v26: a monitor without a pull request (SIGNOFF-34/D1, D2): "watch a change", such as a config change for a merchant.
-- kind 'change' has no pr; subject says what changed and focus what to look at. Its watch starts at deployed_at (the
-- time of the change). SQLite cannot drop NOT NULL, so monitors is rebuilt; monitor_events, which references it, is
-- rebuilt with it (a parent that rows still reference cannot be dropped with foreign keys on).
CREATE TABLE monitors_new (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL DEFAULT 'pr' CHECK (kind IN ('pr','change')),
  repo TEXT NOT NULL,
  pr INTEGER,                                  -- null for a change watch
  ticket TEXT,
  subject TEXT, focus TEXT,                    -- change watch: what changed, and what to look at (e.g. a merchant id)
  stage TEXT NOT NULL CHECK (stage IN ('ci','merge','deploy','stable','done','incident','stopped')),
  window_minutes INTEGER NOT NULL,
  check_minutes INTEGER NOT NULL,
  notify INTEGER NOT NULL DEFAULT 0,
  recipients TEXT,
  merge_sha TEXT, deployed_at TEXT, firefight_session TEXT REFERENCES sessions(id),
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((kind = 'pr' AND pr IS NOT NULL) OR (kind = 'change' AND pr IS NULL AND subject IS NOT NULL))
);
CREATE TABLE monitor_events_new (
  id INTEGER PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors_new(id),
  at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL
);
INSERT INTO monitors_new (id, session_id, kind, repo, pr, ticket, stage, window_minutes, check_minutes, notify, recipients, merge_sha, deployed_at, firefight_session, note, created_at, updated_at)
  SELECT id, session_id, 'pr', repo, pr, ticket, stage, window_minutes, check_minutes, notify, recipients, merge_sha, deployed_at, firefight_session, note, created_at, updated_at FROM monitors;
INSERT INTO monitor_events_new SELECT * FROM monitor_events;
DROP TABLE monitor_events;
DROP TABLE monitors;
ALTER TABLE monitors_new RENAME TO monitors;
ALTER TABLE monitor_events_new RENAME TO monitor_events;
-- Never two live monitors on the same pull request.
CREATE UNIQUE INDEX monitors_live ON monitors(repo, pr) WHERE pr IS NOT NULL AND stage NOT IN ('done','stopped');
CREATE INDEX monitor_events_by_monitor ON monitor_events(monitor_id, id);
PRAGMA user_version = 26;
