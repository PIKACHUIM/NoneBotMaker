import { BUILTIN_CHAT_TOOL_NAMES, defaultFieldValues, policyFields } from '../../shared/plugin-catalog';
import { MODEL_PRICE_PRESETS } from '../../shared/model-pricing';
import type { DatabaseSetupStatus, D1DatabaseLike, RecordKind, RuntimeBindings } from '../../shared/types';
import { createRepository, type StoredRecord } from './repository';

const MIGRATION_NAMES = [
  '0001_initial.sql',
  '0002_conversation_group_external_id.sql',
  '0003_chatbot_runtime_state.sql',
  '0004_plugin_conversation_logs.sql',
  '0005_conversation_memories.sql',
] as const;

const LOG_COLUMNS = {
  group_external_id: "TEXT NOT NULL DEFAULT ''",
  plugin_id: 'TEXT', plugin_type: 'TEXT', event_id: 'TEXT', status: 'TEXT', details: 'TEXT',
} as const;

const MEMORY_COLUMNS = [
  'id', 'account_id', 'group_id', 'conversation_type', 'group_external_id',
  'name', 'title', 'description', 'type', 'content', 'status', 'created_at', 'updated_at', 'expires_at',
] as const;

const REQUIRED_TABLES = [
  'd1_migrations',
  'records',
  'conversation_logs',
  'chatbot_group_costs',
  'chatbot_group_context',
  'chatbot_conversation_memories',
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
  `CREATE TABLE IF NOT EXISTS chatbot_conversation_memories (
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
  )`,
  `CREATE INDEX IF NOT EXISTS chatbot_conversation_memories_by_scope_time
    ON chatbot_conversation_memories (account_id, conversation_type, group_external_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS chatbot_conversation_memories_by_expiry
    ON chatbot_conversation_memories (expires_at)`,
] as const;

function defaultRecords(now: string): Array<{ kind: RecordKind; record: StoredRecord }> {
  const common = { createdAt: now, updatedAt: now };
  const policy = (type: 'identity' | 'dialog' | 'voice' | 'memory' | 'cost', name: string, config = defaultFieldValues(policyFields(type))): StoredRecord => ({
    ...common, id: `default-${type}`, type, name, description: '', enabled: true, config,
  });
  return [
    { kind: 'policies', record: {
      ...policy('identity', '默认身份'), persona: '', providerId: '', model: '', systemPrompt: '',
      reasoningEffort: 'default', skillIds: [], mcpIds: [], ruleIds: [], toolIds: [],
    } },
    { kind: 'policies', record: policy('dialog', '默认对话') },
    { kind: 'policies', record: policy('voice', '默认语音') },
    { kind: 'policies', record: policy('memory', '默认记忆', {
      memoryMode: 'manual', maxEntries: 100, retentionDays: 7, memory_enabled: true,
    }) },
    { kind: 'policies', record: policy('cost', '默认费用', {
      dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0,
    }) },
    ...BUILTIN_CHAT_TOOL_NAMES.map((name) => ({ kind: 'tools' as const, record: {
      ...common, id: `builtin-${name.replaceAll('_', '-')}`,
      name: name === 'chat_generate_image' ? '图片生成' : name,
      description: name === 'chat_generate_image' ? '经授权后调用已配置的图像模型。' : '内置工具；实际调用须经身份策略授权。',
      enabled: name !== 'chat_generate_image',
      config: name === 'chat_generate_image' ? {
        kind: 'builtin', name, providerId: '', model: '',
        size: '1024x1024', quality: 'low', fallbackCostPerImage: 0,
      } : { kind: 'builtin', name },
    } })),
    ...MODEL_PRICE_PRESETS.map((price) => ({ kind: 'prices' as const, record: { ...price } })),
  ];
}

/** Explicit administrator action for KV/Blob-backed deployments without D1. */
export async function initializeNonD1Defaults(bindings: RuntimeBindings): Promise<void> {
  const repository = createRepository(bindings);
  const existingModels = new Set((await repository.list('prices')).map((price) => price.model));
  for (const { kind, record } of defaultRecords(new Date().toISOString())) {
    if (kind === 'prices' && existingModels.has(record.model)) continue;
    if (await repository.get(kind, record.id)) continue;
    await repository.put(kind, record);
  }
}

async function seedD1Defaults(db: D1DatabaseLike): Promise<void> {
  for (const { kind, record } of defaultRecords(new Date().toISOString())) {
    const statement = kind === 'prices'
      ? `INSERT OR IGNORE INTO records (kind, id, value, updated_at)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM records WHERE kind = 'prices' AND json_extract(value, '$.model') = ?
        )`
      : 'INSERT OR IGNORE INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?)';
    const values = [kind, record.id, JSON.stringify(record), record.updatedAt];
    await db.prepare(statement).bind(...values, ...(kind === 'prices' ? [record.model] : [])).run();
  }
}

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
  if (tables.has('chatbot_conversation_memories')) {
    const columns = await columnNames(db, 'chatbot_conversation_memories');
    for (const name of MEMORY_COLUMNS) if (!columns.has(name)) missing.push(`chatbot_conversation_memories.${name}`);
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

  await seedD1Defaults(db);
  return await inspectD1Setup(db);
}
