import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { ConversationLog, D1DatabaseLike, D1StatementLike, KVNamespaceLike } from '../../shared/types';
import { D1ConversationLogRepository, KVConversationLogRepository, EdgeOneBlobConversationLogRepository, sanitizeLogDetails } from './conversation-log-repository';

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

describe('log detail safety', () => {
  it('recursively redacts credentials/media but preserves openid and bounds unknown data', () => {
    const cyclic: Record<string, unknown> = { openid: 'visible-user', secret: 'hidden' };
    cyclic.cycle = cyclic;
    const safe = sanitizeLogDetails({ arbitraryPlugin: cyclic, accessToken: 'hidden-token', api_key: 'hidden-key', image: 'data:image/png;base64,aGVsbG8=', huge: 'x'.repeat(100_000), raw: 'A'.repeat(300), nested: { apiKey: 'nested-key' } });
    expect(safe).toMatchObject({ arbitraryPlugin: { openid: 'visible-user', secret: '[REDACTED]', cycle: '[CIRCULAR]' }, accessToken: '[REDACTED]', api_key: '[REDACTED]', image: '[REDACTED_MEDIA]', raw: '[REDACTED_MEDIA]' });
    expect(JSON.stringify(safe).length).toBeLessThan(20_000);
    expect(JSON.stringify(safe)).not.toContain('nested-key');
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let index = 0; index < 100; index++) { node.child = {}; node = node.child as Record<string, unknown>; }
    expect(JSON.stringify(sanitizeLogDetails(deep))).toContain('[TRUNCATED]');
    expect(sanitizeLogDetails({ usage: { promptTokens: 10, completionTokens: 5, cachedPromptTokens: 2, prompt_tokens: 10, total_tokens: 15 }, accessToken: 'credential', authToken: 123 })).toEqual({ usage: { promptTokens: 10, completionTokens: 5, cachedPromptTokens: 2, prompt_tokens: 10, total_tokens: 15 }, accessToken: '[REDACTED]', authToken: '[REDACTED]' });
  });
});

describe('KV/blob log compatibility', () => {
  it.each(['kv', 'blob'] as const)('preserves old logs and generic sanitized plugin details in %s', async (provider) => {
    const values = new Map<string, string>();
    const kv: KVNamespaceLike = {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => { values.set(key, value); },
      delete: async (key) => { values.delete(key); },
      list: async (options) => ({ keys: [...values.keys()].filter((key) => key.startsWith(options?.prefix ?? '')).map((name) => ({ name })), list_complete: true }),
    };
    const repository = provider === 'kv' ? new KVConversationLogRepository(kv) : new EdgeOneBlobConversationLogRepository({
      get: kv.get, put: kv.put, delete: kv.delete,
      list: async (options) => ({ objects: [...values.keys()].filter((key) => key.startsWith(options?.prefix ?? '')).map((key) => ({ key })), truncated: false }),
    });
    const now = Date.now();
    const base: ConversationLog = { id: 'new', accountId: 'account', groupId: 'group', groupExternalId: 'external', userId: 'user-openid', direction: 'in', content: 'hello', createdAt: now, expiresAt: now + 60_000 };
    await repository.append([{ ...base, pluginId: 'plugin', pluginType: 'unknown', details: { field: { openid: 'detail-openid', secret: 'never-store' } } }]);
    const legacy = { ...base, id: 'legacy', groupExternalId: undefined };
    values.set(provider === 'kv' ? 'nonebotmaker:conversation_logs:legacy' : 'nonebotmaker/conversation_logs/legacy', JSON.stringify(legacy));
    const page = await repository.list({ pluginId: 'plugin', q: 'detail-openid', openid: 'user-openid' });
    expect(page.total).toBe(1);
    expect(page.items[0]?.details).toMatchObject({ field: { secret: '[REDACTED]', openid: 'detail-openid' } });
    expect([...values.values()].join()).not.toContain('never-store');
    const all = await repository.list({});
    expect(all.items.find((log) => log.id === 'legacy')?.groupExternalId).toBe('');
  });
});

describe('D1 conversation log schema', () => {
  it.skipIf(!nodeSqlite)('applies fresh and forward migrations and supports all repository SQL', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      database.exec(readFileSync(new URL('../../../migrations/0001_initial.sql', import.meta.url), 'utf8'));
      database.exec(readFileSync(new URL('../../../migrations/0002_conversation_group_external_id.sql', import.meta.url), 'utf8'));
      database.exec(readFileSync(new URL('../../../migrations/0003_chatbot_runtime_state.sql', import.meta.url), 'utf8'));
      database.exec(readFileSync(new URL('../../../migrations/0004_plugin_conversation_logs.sql', import.meta.url), 'utf8'));

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
        pluginId: 'plugin-1', pluginType: 'custom-plugin', eventId: 'event-1', status: 'processed',
        details: { arbitrary: { user_openid: 'detail-user', apiKey: 'never-store' }, token: 'secret-token' },
        createdAt: now,
        expiresAt: now + 60_000,
      }]);

      const page = await repository.list({ q: 'external-group-1' });
      expect(page.total).toBe(1);
      expect(page.items[0]?.groupExternalId).toBe('external-group-1');
      const detailPage = await repository.list({ q: 'detail-user', pluginId: 'plugin-1', pluginType: 'custom-plugin' });
      expect(detailPage.total).toBe(1);
      expect(detailPage.items[0]).toMatchObject({ eventId: 'event-1', status: 'processed', details: { arbitrary: { apiKey: '[REDACTED]' }, token: '[REDACTED]' } });
      expect(JSON.stringify(database.prepare('SELECT details FROM conversation_logs').get())).not.toContain('never-store');
      expect((await repository.list({ pluginId: 'absent' })).total).toBe(0);
      database.prepare('INSERT INTO conversation_logs (id, account_id, group_id, group_external_id, user_id, direction, content, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('legacy', 'account-1', 'group-1', 'external-group-1', 'old-user', 'in', 'legacy', now - 1, now + 60_000);
      expect((await repository.list({ q: 'legacy' })).items[0]?.details).toBeUndefined();

      database.prepare(
        'INSERT INTO conversation_logs (id, account_id, group_id, group_external_id, user_id, direction, content, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('expired-1', 'account-1', 'group-1', 'external-group-1', 'user-1', 'in', 'old', now - 100_000, now - 1);
      await expect(repository.purgeExpired(now)).resolves.toBe(1);
    } finally {
      database.close();
    }
  });
});
