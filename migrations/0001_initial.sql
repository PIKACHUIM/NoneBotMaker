CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS records_by_kind_updated
  ON records (kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_logs_by_scope_time
  ON conversation_logs (account_id, group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_logs_by_expiry
  ON conversation_logs (expires_at);
