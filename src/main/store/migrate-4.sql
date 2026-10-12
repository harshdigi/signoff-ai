-- v4: context handling (IDE/D16 B).
ALTER TABLE sessions ADD COLUMN parent_id TEXT;          -- the chat this one continues (handoff)
ALTER TABLE sessions ADD COLUMN context_used INTEGER;    -- tokens in context after the last message
ALTER TABLE sessions ADD COLUMN context_window INTEGER;  -- the model's window, from the last result
PRAGMA user_version = 4;
