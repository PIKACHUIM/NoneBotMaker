import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { JsonObject, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { decryptSecrets } from '../storage/secrets';
import { ApiError, registerManagementRoutes } from './management';

function createApp() {
  const values = new Map<string, string>();
  const KV: KVNamespaceLike = {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
  const app = new Hono<{ Bindings: RuntimeBindings }>();
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
    return context.json({ error: 'internal_error' }, 500);
  });
  registerManagementRoutes(app);
  return { app, values, bindings: { KV, SYS_SECRET: 'test-sys-secret' } as RuntimeBindings };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('declared plugin configuration', () => {
  it('normalizes plugin values by the declared field types and drops unknown keys', async () => {
    const { app, bindings } = createApp();
    const response = await app.request('/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Chatbot',
        type: 'elysia-best/plugin-chatbot',
        config: {
          contextMessageLimit: '200',
          includeHistory: 'false',
          defaultSystemPrompt: 42,
          undeclared: 'ignored',
        },
      }),
    }, bindings);

    expect(response.status).toBe(201);
    expect((await json(response)).data).toMatchObject({
      config: {
        contextMessageLimit: 100,
        includeHistory: false,
        defaultSystemPrompt: '',
      },
    });
  });

  it('requires declared account credential fields and preserves blank edits', async () => {
    const { app, values, bindings } = createApp();
    const pluginResponse = await app.request('/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Chatbot', type: 'elysia-best/plugin-chatbot' }),
    }, bindings);
    const plugin = (await json(pluginResponse)).data as JsonObject;

    const rejected = await app.request('/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pluginId: plugin.id,
        protocol: 'qq',
        name: 'QQ Bot',
        credentials: { appId: '10001' },
      }),
    }, bindings);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'missing_botSecret' });

    const created = await app.request('/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pluginId: plugin.id,
        protocol: 'qq',
        name: 'QQ Bot',
        credentials: { appId: '10001', botSecret: 'bot-secret', clientSecret: 'client-secret' },
      }),
    }, bindings);
    expect(created.status).toBe(201);
    const account = (await json(created)).data as JsonObject;

    const updated = await app.request(`/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { appId: '10001', botSecret: '', clientSecret: '' } }),
    }, bindings);
    expect(updated.status).toBe(200);

    const stored = JSON.parse(values.get(`nonebotmaker:records:accounts:${account.id}`) ?? '{}') as JsonObject;
    const decrypted = await decryptSecrets(stored, bindings);
    expect(decrypted.credentials).toEqual({
      appId: '10001',
      botSecret: 'bot-secret',
      clientSecret: 'client-secret',
    });
  });
});
