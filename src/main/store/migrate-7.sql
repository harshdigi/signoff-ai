-- v7: project memory (IDE/D16 G). Full-text search over decisions, reviews and chats.
CREATE VIRTUAL TABLE memory USING fts5(
  kind UNINDEXED, ref UNINDEXED, session UNINDEXED, ticket UNINDEXED, at UNINDEXED,
  title, body, tokenize = 'porter unicode61'
);

CREATE TRIGGER memory_decision_ins AFTER INSERT ON decisions BEGIN
  INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  VALUES ('decision', NEW.id, NEW.session_id, NEW.ticket, NEW.created_at, NEW.question,
          COALESCE(NEW.answer, '') || ' ' || COALESCE(NEW.recommend, '') || ' ' || NEW.options);
END;
CREATE TRIGGER memory_decision_upd AFTER UPDATE ON decisions BEGIN
  DELETE FROM memory WHERE kind = 'decision' AND ref = OLD.id;
  INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  VALUES ('decision', NEW.id, NEW.session_id, NEW.ticket, COALESCE(NEW.answered_at, NEW.created_at), NEW.question,
          COALESCE(NEW.answer, '') || ' ' || COALESCE(NEW.recommend, '') || ' ' || NEW.options);
END;
CREATE TRIGGER memory_review_ins AFTER INSERT ON reviews BEGIN
  INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  VALUES ('review', NEW.id, NEW.session_id, NEW.ticket, NEW.created_at, NEW.title, COALESCE(NEW.summary, ''));
END;

-- What is already in the store.
INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  SELECT 'decision', id, session_id, ticket, COALESCE(answered_at, created_at), question,
         COALESCE(answer, '') || ' ' || COALESCE(recommend, '') || ' ' || options FROM decisions;
INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  SELECT 'review', id, session_id, ticket, created_at, title, COALESCE(summary, '') FROM reviews;
INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  SELECT 'chat', c.session_id || ':' || c.seq, c.session_id, s.ticket, c.created_at, 'You asked', json_extract(c.event, '$.text')
  FROM chat_events c LEFT JOIN sessions s ON s.id = c.session_id
  WHERE json_extract(c.event, '$.type') = 'prompt' AND json_extract(c.event, '$.kind') IS NULL;
INSERT INTO memory (kind, ref, session, ticket, at, title, body)
  SELECT 'chat', c.session_id || ':' || c.seq, c.session_id, s.ticket, c.created_at, 'Claude replied', json_extract(j.value, '$.text')
  FROM chat_events c LEFT JOIN sessions s ON s.id = c.session_id, json_each(json_extract(c.event, '$.message.content')) j
  WHERE json_extract(c.event, '$.type') = 'assistant' AND json_extract(c.event, '$.parent_tool_use_id') IS NULL
    AND json_extract(j.value, '$.type') = 'text';

PRAGMA user_version = 7;
