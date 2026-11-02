CREATE TABLE IF NOT EXISTS chatbot_group_costs (
  group_id TEXT PRIMARY KEY,
  day_key TEXT NOT NULL,
  daily_spend REAL NOT NULL,
  month_key TEXT NOT NULL,
  monthly_spend REAL NOT NULL,
  total_spend REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS chatbot_group_context (
  group_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
