-- v10: teams (IDE/D22). A child session's role in its parent's team, e.g. 'implementer'; NULL = not a team member.
ALTER TABLE sessions ADD COLUMN role TEXT;
PRAGMA user_version = 10;
