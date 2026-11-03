-- v27: a base the session set itself with signoff register --base (SIGNOFF-36-DIFF-BASE/D2). Files changed diffs against
-- it as is; null: the automatic pick. base_branch (set by team split and the ticket pipeline) is kept apart.
ALTER TABLE sessions ADD COLUMN base_pin TEXT;
PRAGMA user_version = 27;
