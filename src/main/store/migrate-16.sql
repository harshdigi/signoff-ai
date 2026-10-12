-- v16: draft: the exact text a decision asks you to approve (a PR reply, a commit message, a Slack post).
-- Kept in the decision itself, so the card shows it; a file path in a temp folder would not survive or show.
ALTER TABLE decisions ADD COLUMN draft TEXT;
PRAGMA user_version = 16;
