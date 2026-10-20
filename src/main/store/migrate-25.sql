-- v25: review requests per pull request (SIGNOFF-31/D14): where the "PR is up for review" message is, and whether it
-- was approved. app 'GitHub' with place 'pull request' records an approval on GitHub itself.
CREATE TABLE review_requests (
  repo TEXT NOT NULL, pr INTEGER NOT NULL, app TEXT NOT NULL, place TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sent', 'found', 'approved')),
  message TEXT,                                -- where and when it is: a link or time, as the messaging tool gave it
  by TEXT,                                     -- who approved
  at TEXT NOT NULL,
  PRIMARY KEY (repo, pr, app, place)
);
PRAGMA user_version = 25;
