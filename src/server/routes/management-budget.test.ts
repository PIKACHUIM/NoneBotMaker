import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { ApiError, registerManagementRoutes } from './management';

const account = {
  id: 'account-1',
  createdAt: '',
  updatedAt: '',
  pluginId: 'plugin-1',
  protocol: 'qq',
  name: 'QQ Bot',
  enabled: true,
  credentials: {},
  config: {},
};
const provider = {
  id: 'provider-1',
  createdAt: '',
  updatedAt: '',
  name: 'Provider',
  baseUrl: 'https://provider.example/v1',
  apiKey: '',
  enabled: true,
  models: ['test-model'],
};

function setup() {
  const values = new Map([
    ['nonebotmaker:records:accounts:account-1', JSON.stringify(account)],
    ['nonebotmaker:records:providers:provider-1', JSON.stringify(provider)],
  ]);
  const KV: KVNamespaceLike = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
    list: async ({ prefix = '' } = {}) => ({
      keys: [...values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  const app = new Hono<{ Bindings: RuntimeBindings }>();
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
    return context.json({ error: 'internal_error' }, 500);
  });
  registerManagementRoutes(app);
  return { app, bindings: { KV } as RuntimeBindings };
}

const baseGroup = {
  accountId: 'account-1',
  externalId: 'qq-group-1',
  name: 'Test group',
  providerId: 'provider-1',
  model: 'test-model',
};

describe('group cost limit management fields', () => {
  it('defaults all USD limits to zero', async () => {
    const { app, bindings } = setup();
    const response = await app.request('/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseGroup),
    }, bindings);

    expect(response.status).toBe(201);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0 });
    expect(response.headers.get('X-Chatbot-Cost-Consistency')).toBe('kv-eventual; concurrent-overage-possible');
  });

  it.each(['dailyCostLimit', 'monthlyCostLimit', 'totalCostLimit'] as const)(
    'rejects a negative %s value',
    async (field) => {
      const { app, bindings } = setup();
      const response = await app.request('/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...baseGroup, [field]: -0.01 }),
      }, bindings);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: `invalid_${field}` });
    },
  );
});
