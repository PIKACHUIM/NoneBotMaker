import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike } from '../../shared/types';
import { D1ConversationLogRepository } from './conversation-log-repository';

const nodeSqlite = await import('node:sqlite').catch(() => null);
const DatabaseSyncConstructor = nodeSqlite?.DatabaseSync;

function asD1(database: DatabaseSync): D1DatabaseLike {
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
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

describe('D1 conversation log schema', () => {
  it.skipIf(!nodeSqlite)('applies fresh and forward migrations and supports all repository SQL', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      database.exec(readFileSync(new URL('../../../migrations/0001_initial.sql', import.meta.url), 'utf8'));
      database.exec(readFileSync(new URL('../../../migrations/0002_conversation_group_external_id.sql', import.meta.url), 'utf8'));
      database.exec(readFileSync(new URL('../../../migrations/0003_chatbot_runtime_state.sql', import.meta.url), 'utf8'));

      const columns = database.prepare('PRAGMA table_info(conversation_logs)').all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'group_external_id')).toBe(true);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chatbot_group_costs'").get()).toBeDefined();

      const repository = new D1ConversationLogRepository(asD1(database));
      const now = Date.now();
      await repository.append([{
        id: 'log-1',
        accountId: 'account-1',
        groupId: 'group-1',
        groupExternalId: 'external-group-1',
        userId: 'user-1',
        direction: 'in',
        content: 'hello',
        createdAt: now,
        expiresAt: now + 60_000,
      }]);

      const page = await repository.list({ q: 'external-group-1' });
      expect(page.total).toBe(1);
      expect(page.items[0]?.groupExternalId).toBe('external-group-1');

      database.prepare(
        'INSERT INTO conversation_logs (id, account_id, group_id, group_external_id, user_id, direction, content, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('expired-1', 'account-1', 'group-1', 'external-group-1', 'user-1', 'in', 'old', now - 100_000, now - 1);
      await expect(repository.purgeExpired(now)).resolves.toBe(1);
    } finally {
      database.close();
    }
  });
});
