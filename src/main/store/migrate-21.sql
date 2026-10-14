-- v21: a review can be replaced by a newer one from the same session and ticket, or dismissed.
-- SQLite cannot change a CHECK constraint, so reviews is rebuilt. Its child tables are rebuilt with it: dropping a
-- parent that rows still reference fails with foreign keys on, and they cannot be turned off inside the migration.
CREATE TABLE reviews_new (
  id TEXT PRIMARY KEY, ticket TEXT NOT NULL, session_id TEXT REFERENCES sessions(id),
  title TEXT NOT NULL, summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','accepted','changes_requested','replaced','dismissed')),
  note TEXT, created_at TEXT NOT NULL, submitted_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE review_changes_new (
  review_id TEXT NOT NULL REFERENCES reviews_new(id), change_id TEXT NOT NULL,
  file TEXT NOT NULL, diff TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pending','accept','reject','question')), comment TEXT,
  PRIMARY KEY (review_id, change_id)
);
CREATE TABLE review_thread_new (
  id INTEGER PRIMARY KEY, review_id TEXT NOT NULL, change_id TEXT NOT NULL,
  who TEXT NOT NULL, text TEXT NOT NULL, verdict TEXT, at TEXT NOT NULL,
  FOREIGN KEY (review_id, change_id) REFERENCES review_changes_new(review_id, change_id)
);
INSERT INTO reviews_new SELECT * FROM reviews;
INSERT INTO review_changes_new SELECT * FROM review_changes;
INSERT INTO review_thread_new SELECT * FROM review_thread;
DROP TABLE review_thread;
DROP TABLE review_changes;
DROP TABLE reviews;
-- Renaming also points the child tables' references at the new names.
ALTER TABLE reviews_new RENAME TO reviews;
ALTER TABLE review_changes_new RENAME TO review_changes;
ALTER TABLE review_thread_new RENAME TO review_thread;
CREATE TRIGGER memory_review_ins AFTER INSERT ON reviews BEGIN
  INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  VALUES ('review', NEW.id, NEW.session_id, NEW.ticket, NEW.created_at, NEW.title, COALESCE(NEW.summary, ''));
END;
PRAGMA user_version = 21;
