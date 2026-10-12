-- v5: worktree-aware review (IDE/D16 D). A session's base branch, for stacked branches (set by the ticket pipeline).
ALTER TABLE sessions ADD COLUMN base_branch TEXT;
PRAGMA user_version = 5;
