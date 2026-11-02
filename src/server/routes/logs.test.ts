import { describe, expect, it } from 'vitest';
import type { ConversationLog, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { createApiRouter } from './index';

function createKV(logs: ConversationLog[]): KVNamespaceLike {
  const values = new Map(logs.map((log) => [
    `nonebotmaker:conversation_logs:${encodeURIComponent(log.accountId)}:${encodeURIComponent(log.groupId)}:${log.createdAt}:${encodeURIComponent(log.id)}`,
    JSON.stringify(log),
  ]));
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list(options) {
      const prefix = options?.prefix ?? '';
      return {
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

describe('conversation log filtering', () => {
  it('filters by Unix millisecond from/to values and excludes expired logs', async () => {
    const now = Date.now();
    const logs: ConversationLog[] = [
      {
        id: 'before', accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1',
        direction: 'in', content: 'before range', createdAt: Date.parse('2025-01-10T12:00:00.000Z'), expiresAt: now + 60_000,
      },
      {
        id: 'within', accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1',
        direction: 'in', content: 'within range', createdAt: Date.parse('2025-01-11T12:00:00.000Z'), expiresAt: now + 60_000,
      },
      {
        id: 'expired', accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1',
        direction: 'in', content: 'expired', createdAt: Date.parse('2025-01-11T13:00:00.000Z'), expiresAt: now - 1,
      },
    ];
    const bindings: RuntimeBindings = {
      SYS_PASSWD: 'admin-password',
      DB_SECRET: 'test-db-secret',
      LOG_RECORD: 'true',
      PLATFORM: 'local',
      KV: createKV(logs),
    };
    const router = createApiRouter();
    const login = await router.request('/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    }, bindings);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const response = await router.request(
      `/logs?from=${Date.parse('2025-01-11T00:00:00.000Z')}&to=${Date.parse('2025-01-12T00:00:00.000Z')}`,
      { headers: { Cookie: cookie } },
      bindings,
    );
    const payload = await response.json() as { items: ConversationLog[]; total: number };

    expect(response.status).toBe(200);
    expect(payload.items.map((log) => log.id)).toEqual(['within']);
    expect(payload.total).toBe(1);
  });
});
