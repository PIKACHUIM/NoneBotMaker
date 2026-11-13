import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { createSessionToken, SESSION_COOKIE } from '../auth';
import { createApiRouter } from './index';

describe('admin route protections', () => {
  it('requires same-origin requests for browser mutations', async () => {
    const router = createApiRouter();
    const blocked = await router.request('/auth/logout', { method: 'POST' }, {} as RuntimeBindings);
    const allowed = await router.request('/auth/logout', {
      method: 'POST',
      headers: { Origin: 'http://localhost' },
    }, {} as RuntimeBindings);

    expect(blocked.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('does not apply browser Origin checks to external QQ webhooks', async () => {
    const response = await createApiRouter().request('/webhook/qq', { method: 'POST' }, {} as RuntimeBindings);
    expect(response.status).toBe(404);
  });

  it('requires an authenticated session for logs and provider discovery', async () => {
    const router = createApiRouter();
    const logs = await router.request('/logs', {}, { SYS_SECRET: 'test-secret' });
    const models = await router.request('/providers/provider-1/models', { method: 'POST' }, { SYS_SECRET: 'test-secret' });

    expect(logs.status).toBe(401);
    expect(models.status).toBe(403);
  });

  it.each(['/prices', '/prices/presets', '/prices/price-1', '/tools', '/tools/builtin-chat-generate-image', '/chatbot/conversations/account-1/group-1/memories?externalId=group-1'])('requires authentication for billing, tool and memory reads: %s', async (path) => {
    const response = await createApiRouter().request(path, {}, { SYS_SECRET: 'test-secret' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('requires Origin and authentication for price mutations: %s', async (method) => {
    const router = createApiRouter();
    const path = method === 'POST' ? '/prices' : '/prices/price-1';
    const bindings = { SYS_SECRET: 'test-secret' };
    const blockedOrigin = await router.request(path, { method }, bindings);
    expect(blockedOrigin.status).toBe(403);
    expect(await blockedOrigin.json()).toEqual({ error: 'origin_check_failed' });
    const blockedSession = await router.request(path, { method, headers: { Origin: 'http://localhost' } }, bindings);
    expect(blockedSession.status).toBe(401);
    expect(await blockedSession.json()).toEqual({ error: 'unauthorized' });
    const token = await createSessionToken(bindings);
    const crossOrigin = await router.request(path, {
      method, headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: 'https://attacker.example' },
    }, bindings);
    expect(crossOrigin.status).toBe(403);
  });

  it.each(['memories', 'tools'])('requires a session and same-origin mutations for shared records and tools: %s', async (kind) => {
    const router = createApiRouter();
    const bindings = { SYS_SECRET: 'test-secret' };
    const read = await router.request(`/${kind}?accountId=account-1`, {}, bindings);
    expect(read.status).toBe(401);

    const blockedOrigin = await router.request(`/${kind}`, { method: 'POST' }, bindings);
    expect(blockedOrigin.status).toBe(403);
    const blockedSession = await router.request(`/${kind}`, { method: 'POST', headers: { Origin: 'http://localhost' } }, bindings);
    expect(blockedSession.status).toBe(401);
    const token = await createSessionToken(bindings);
    const crossOrigin = await router.request(`/${kind}`, {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: 'https://attacker.example' },
    }, bindings);
    expect(crossOrigin.status).toBe(403);
  });

  it('protects prices when mounted under /api and allows authenticated same-origin CRUD', async () => {
    const values = new Map<string, string>();
    const KV: KVNamespaceLike = {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); },
      async list({ prefix = '' } = {}) {
        return { keys: [...values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    };
    const bindings = { SYS_SECRET: 'test-secret', KV };
    const app = new Hono<{ Bindings: RuntimeBindings }>();
    app.route('/api', createApiRouter());
    expect((await app.request('/api/prices/presets', {}, bindings)).status).toBe(401);
    const token = await createSessionToken(bindings);
    const headers = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: 'http://localhost', 'content-type': 'application/json' };
    const presets = await app.request('/api/prices/presets', { headers }, bindings);
    expect(presets.status).toBe(200);
    const created = await app.request('/api/prices', {
      method: 'POST', headers, body: JSON.stringify({ id: 'price-1', name: 'Manual', model: 'manual', inputCostPerMillion: 1, outputCostPerMillion: 2 }),
    }, bindings);
    expect(created.status).toBe(201);
    expect((await app.request('/api/prices', { headers }, bindings)).status).toBe(200);
    expect((await app.request('/api/prices/price-1', { method: 'PATCH', headers, body: JSON.stringify({ inputCostPerMillion: 0 }) }, bindings)).status).toBe(200);
    expect((await app.request('/api/prices/price-1', { method: 'PUT', headers, body: JSON.stringify({ outputCostPerMillion: 3 }) }, bindings)).status).toBe(200);
    expect((await app.request('/api/prices/price-1', { method: 'DELETE', headers }, bindings)).status).toBe(200);
  });
});
