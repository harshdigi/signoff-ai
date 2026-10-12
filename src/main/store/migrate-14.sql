-- v14: test plans. Test cases for a ticket (or, with no ticket, a session), verified by Claude or by you.
CREATE TABLE test_cases (
  plan TEXT NOT NULL,                         -- the ticket key, or the session id when there is no ticket
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'blocked')),
  verified_by TEXT CHECK (verified_by IN ('claude', 'you')),
  evidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan, idx)
);
PRAGMA user_version = 14;
