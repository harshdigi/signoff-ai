-- v18: whether a board message really reached its session.
-- decision_id: the decision it is about (an answer, a question under it). submitted_at: Claude got it (typed and
-- submitted, or handed over by the Stop hook / signoff wait / inbox). failed: typed into the terminal but still in the
-- input box after retries; the card offers Resend.
ALTER TABLE messages ADD COLUMN decision_id TEXT;
ALTER TABLE messages ADD COLUMN submitted_at TEXT;
ALTER TABLE messages ADD COLUMN failed TEXT;
PRAGMA user_version = 18;
