import type { DatabaseSetupStatus, D1DatabaseLike } from '../../shared/types';

const MIGRATION_NAMES = [
  '0001_initial.sql',
  '0002_conversation_group_external_id.sql',
  '0003_chatbot_runtime_state.sql',
  '0004_plugin_conversation_logs.sql',
] as const;

const LOG_COLUMNS = {
  group_external_id: "TEXT NOT NULL DEFAULT ''",
  plugin_id: 'TEXT', plugin_type: 'TEXT', event_id: 'TEXT', status: 'TEXT', details: 'TEXT',
} as const;

const REQUIRED_TABLES = [
  'd1_migrations',
  'records',
  'conversation_logs',
  'chatbot_group_costs',
  'chatbot_group_context',
] as const;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS d1_migrations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  )`,
  `CREATE INDEX IF NOT EXISTS records_by_kind_updated
    ON records (kind, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS conversation_logs (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conversation_logs_by_scope_time
    ON conversation_logs (account_id, group_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS conversation_logs_by_expiry
    ON conversation_logs (expires_at)`,
  `CREATE TABLE IF NOT EXISTS chatbot_group_costs (
    group_id TEXT PRIMARY KEY,
    day_key TEXT NOT NULL,
    daily_spend REAL NOT NULL,
    month_key TEXT NOT NULL,
    monthly_spend REAL NOT NULL,
    total_spend REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chatbot_group_context (
    group_id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
] as const;

async function tableNames(db: D1DatabaseLike): Promise<Set<string>> {
  const result = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

async function columnNames(db: D1DatabaseLike, table: string): Promise<Set<string>> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

async function appliedMigrations(db: D1DatabaseLike, hasMigrationTable: boolean): Promise<number> {
  if (!hasMigrationTable) return 0;
  const result = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
  const applied = new Set((result.results ?? []).map((row) => row.name));
  return MIGRATION_NAMES.filter((name) => applied.has(name)).length;
}

export async function inspectD1Setup(db: D1DatabaseLike): Promise<DatabaseSetupStatus> {
  const tables = await tableNames(db);
  const missing: string[] = REQUIRED_TABLES.filter((table) => !tables.has(table));

  if (tables.has('conversation_logs')) {
    const columns = await columnNames(db, 'conversation_logs');
    for (const name of Object.keys(LOG_COLUMNS)) if (!columns.has(name)) missing.push(`conversation_logs.${name}`);
  }

  const applied = await appliedMigrations(db, tables.has('d1_migrations'));
  const pendingMigrations = Math.max(0, MIGRATION_NAMES.length - applied);
  return {
    databaseConfigured: true,
    schemaReady: missing.length === 0 && pendingMigrations === 0,
    missing,
    pendingMigrations,
  };
}

export async function initializeD1Setup(db: D1DatabaseLike): Promise<DatabaseSetupStatus> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }

  const tables = await tableNames(db);
  const columns = await columnNames(db, 'conversation_logs');
  for (const [name, definition] of Object.entries(LOG_COLUMNS)) {
    if (columns.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE conversation_logs ADD COLUMN ${name} ${definition}`).run();
    } catch (error) {
      const currentColumns = await columnNames(db, 'conversation_logs');
      if (!currentColumns.has(name)) throw error;
    }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS conversation_logs_by_plugin_time ON conversation_logs (plugin_id, created_at DESC)').run();

  if (!tables.has('d1_migrations')) {
    throw new Error('The D1 migration ledger could not be created.');
  }
  for (const name of MIGRATION_NAMES) {
    await db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name).run();
  }

  return await inspectD1Setup(db);
}
