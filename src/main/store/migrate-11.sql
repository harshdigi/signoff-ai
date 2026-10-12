-- v11: shared sessions (tmux). The tmux session a Claude session runs in, so the app and Terminal can both attach.
ALTER TABLE sessions ADD COLUMN tmux TEXT;
PRAGMA user_version = 11;
