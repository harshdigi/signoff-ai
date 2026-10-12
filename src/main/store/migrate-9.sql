-- v9: workflows (IDE/D21). The team setup a session was started with, e.g. 'implement-review'; NULL = none (solo).
ALTER TABLE sessions ADD COLUMN workflow TEXT;
PRAGMA user_version = 9;
