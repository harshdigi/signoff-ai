-- v13: review progress. A file marked reviewed, by its content (a git blob hash), so a later edit shows as changed.
CREATE TABLE reviewed (
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (root, path)
);
PRAGMA user_version = 13;
