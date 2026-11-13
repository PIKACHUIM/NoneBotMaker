CREATE TABLE IF NOT EXISTS chatbot_conversation_memories (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('group', 'private')),
  group_external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('user', 'feedback', 'project', 'reference')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'pending')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (account_id, conversation_type, group_external_id, name)
);

CREATE INDEX IF NOT EXISTS chatbot_conversation_memories_by_scope_time
  ON chatbot_conversation_memories (account_id, conversation_type, group_external_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS chatbot_conversation_memories_by_expiry
  ON chatbot_conversation_memories (expires_at);
