-- v3: decision levels (IDE/D16 A). ask waits for the user; inform and auto are settled by Claude with evidence.
ALTER TABLE decisions ADD COLUMN level TEXT NOT NULL DEFAULT 'ask' CHECK (level IN ('ask','inform','auto'));
PRAGMA user_version = 3;
