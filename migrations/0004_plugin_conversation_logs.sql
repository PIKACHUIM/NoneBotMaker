ALTER TABLE conversation_logs ADD COLUMN plugin_id TEXT;
ALTER TABLE conversation_logs ADD COLUMN plugin_type TEXT;
ALTER TABLE conversation_logs ADD COLUMN event_id TEXT;
ALTER TABLE conversation_logs ADD COLUMN status TEXT;
ALTER TABLE conversation_logs ADD COLUMN details TEXT;
CREATE INDEX conversation_logs_by_plugin_time ON conversation_logs (plugin_id, created_at DESC);
