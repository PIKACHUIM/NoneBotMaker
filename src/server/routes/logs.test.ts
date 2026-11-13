import { describe, expect, it } from 'vitest';
import type { ConversationLog, D1DatabaseLike, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { D1ConversationLogRepository } from '../storage/conversation-log-repository';
import { createApiRouter } from './index';
import { mergeConversationTurns } from './logs';

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

describe('conversation cost aggregation', () => {
  it('totals every model and image charge of a single event and preserves usage details', () => {
    const base = { accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1', eventId: 'same-event', expiresAt: 9999999 };
    const entries: ConversationLog[] = [
      { ...base, id: 'incoming', direction: 'in', content: 'draw', createdAt: 1 },
      { ...base, id: 'model', direction: 'out', content: '', status: 'model_completed', createdAt: 2, details: { cost: 0.2, model: 'chat-model', usage: { promptTokens: 12 }, pricingSource: 'price' } },
      { ...base, id: 'image', direction: 'out', content: '', status: 'image_completed', createdAt: 3, details: { cost: 0.3, model: 'image-model', usage: { totalTokens: 120 }, pricingSource: 'total_estimate', estimated: true } },
      { ...base, id: 'reply', direction: 'out', content: 'sent', status: 'sent', createdAt: 4 },
    ];
    const [turn] = mergeConversationTurns(entries);
    expect(turn.details).toMatchObject({ cost: 0.5, charges: [
      { cost: 0.2, model: 'chat-model', usage: { promptTokens: 12 }, pricingSource: 'price' },
      { cost: 0.3, model: 'image-model', usage: { totalTokens: 120 }, pricingSource: 'total_estimate', estimated: true },
    ] });
    expect(turn.content).toBe('draw');
    expect(turn.details?.reply).toBe('sent');
  });
});

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
        pluginId: 'plugin-custom', pluginType: 'arbitrary-plugin', eventId: 'event-custom', status: 'success',
        details: { unknownField: { user_openid: 'visible-openid', clientSecret: 'must-not-return' } },
        direction: 'in', content: 'within range', createdAt: Date.parse('2025-01-11T12:00:00.000Z'), expiresAt: now + 60_000,
      },
      {
        id: 'expired', accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1',
        direction: 'in', content: 'expired', createdAt: Date.parse('2025-01-11T13:00:00.000Z'), expiresAt: now - 1,
      },
    ];
    const bindings: RuntimeBindings = {
      SYS_PASSWD: 'admin-password',
      SYS_SECRET: 'test-db-secret',
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
    const filtered = await router.request('/logs?q=visible-openid&pluginId=plugin-custom&pluginType=arbitrary-plugin', { headers: { Cookie: cookie } }, bindings);
    const result = await filtered.json() as { items: ConversationLog[]; fields: Array<{ key: string }> };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('user-1');
    expect(JSON.stringify(result)).not.toContain('must-not-return');
    expect(result.fields.map((field) => field.key)).toContain('details.unknownField');
    const absent = await router.request('/logs?pluginId=absent', { headers: { Cookie: cookie } }, bindings);
    expect((await absent.json() as { total: number }).total).toBe(0);
    const openidMatched = await router.request('/logs?openid=visible-openid&q=within', { headers: { Cookie: cookie } }, bindings);
    expect((await openidMatched.json() as { total: number }).total).toBe(1);
    const openidMissing = await router.request('/logs?openid=missing-openid', { headers: { Cookie: cookie } }, bindings);
    expect((await openidMissing.json() as { total: number }).total).toBe(0);
  });
});

describe('conversation log clearing', () => {
  const logs: ConversationLog[] = [
    {
      id: 'first', accountId: 'account-1', groupId: 'group-1', groupExternalId: 'external-1', userId: 'user-1',
      direction: 'in', content: 'first message', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    },
    {
      id: 'second', accountId: 'account-2', groupId: 'group-2', groupExternalId: 'external-2', userId: 'user-2',
      direction: 'in', content: 'second message', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    },
  ];

  function bindings(): RuntimeBindings {
    return { SYS_PASSWD: 'admin-password', SYS_SECRET: 'test-db-secret', LOG_RECORD: 'true', PLATFORM: 'local', KV: createKV(logs) };
  }

  async function loginCookie(router: ReturnType<typeof createApiRouter>, env: RuntimeBindings): Promise<string> {
    const login = await router.request('/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    }, env);
    return login.headers.get('set-cookie')?.split(';')[0] ?? '';
  }

  it('requires a session and deletes every stored log', async () => {
    const env = bindings();
    const router = createApiRouter();
    const unauthorized = await router.request('/logs', { method: 'DELETE', headers: { Origin: 'http://localhost' } }, env);
    expect(unauthorized.status).toBe(401);

    const cookie = await loginCookie(router, env);
    const before = await router.request('/logs', { headers: { Cookie: cookie } }, env);
    expect((await before.json() as { total: number }).total).toBe(2);

    const cleared = await router.request('/logs', { method: 'DELETE', headers: { Cookie: cookie, Origin: 'http://localhost' } }, env);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ cleared: 2 });

    const after = await router.request('/logs', { headers: { Cookie: cookie } }, env);
    expect((await after.json() as { total: number }).total).toBe(0);
  });

  it('deletes every conversation log row from D1', async () => {
    const statements: string[] = [];
    const db: D1DatabaseLike = {
      prepare(query: string) {
        statements.push(query);
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 5 } }; },
          async all<T>() { return { results: [] as T[] }; },
          async first<T>() { return null as T | null; },
        };
      },
    };
    const repository = new D1ConversationLogRepository(db);
    await expect(repository.clear()).resolves.toBe(5);
    expect(statements).toContain('DELETE FROM conversation_logs');
  });
});
