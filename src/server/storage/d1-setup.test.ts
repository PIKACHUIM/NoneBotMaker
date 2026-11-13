import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike } from '../../shared/types';
import { initializeD1Setup, inspectD1Setup } from './d1-setup';

const sqliteModule = await import('node:sqlite').catch(() => null);
const DatabaseSyncConstructor = sqliteModule?.DatabaseSync;

function d1Adapter(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1StatementLike {
      const statement = database.prepare(query);
      let values: SQLInputValue[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound as SQLInputValue[];
          return this;
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          statement.run(...values);
          return { success: true };
        },
      };
    },
  };
}

describe('online D1 initialization', () => {
  it.skipIf(!DatabaseSyncConstructor)('creates the complete schema and records all migrations idempotently', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      const db = d1Adapter(database);
      const before = await inspectD1Setup(db);
      expect(before.databaseConfigured).toBe(true);
      expect(before.schemaReady).toBe(false);
      expect(before.pendingMigrations).toBe(5);

      const initialized = await initializeD1Setup(db);
      expect(initialized.schemaReady).toBe(true);
      expect(initialized.pendingMigrations).toBe(0);
      expect(initialized.missing).toEqual([]);

      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
        'chatbot_group_context',
        'chatbot_group_costs',
        'chatbot_conversation_memories',
        'conversation_logs',
        'd1_migrations',
        'records',
      ]));
      const columns = database.prepare('PRAGMA table_info(conversation_logs)').all() as Array<{ name: string }>;
      expect(columns.map((row) => row.name)).toContain('group_external_id');
      const memoryColumns = database.prepare('PRAGMA table_info(chatbot_conversation_memories)').all() as Array<{ name: string }>;
      expect(memoryColumns.map((row) => row.name)).toEqual([
        'id', 'account_id', 'group_id', 'conversation_type', 'group_external_id',
        'name', 'title', 'description', 'type', 'content', 'status', 'created_at', 'updated_at', 'expires_at',
      ]);
      const migrations = database.prepare('SELECT name FROM d1_migrations ORDER BY name').all() as Array<{ name: string }>;
      expect(migrations.map((row) => row.name)).toEqual([
        '0001_initial.sql',
        '0002_conversation_group_external_id.sql',
        '0003_chatbot_runtime_state.sql',
        '0004_plugin_conversation_logs.sql',
        '0005_conversation_memories.sql',
      ]);

      const repeated = await initializeD1Setup(db);
      expect(repeated).toEqual(initialized);
    } finally {
      database.close();
    }
  });
});
