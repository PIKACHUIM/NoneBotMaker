import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject, KVNamespaceLike, ProviderRecord, RuntimeBindings } from '../../shared/types';
import { createApiRouter } from './index';
import { ApiError } from './management';
import { discoverProviderModels } from './provider-models';
import { encryptSecrets } from '../storage/secrets';

const provider: ProviderRecord = {
  id: 'provider-1',
  name: 'Test provider',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-provider-secret',
  enabled: true,
  models: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('provider model discovery', () => {
  it('requests the OpenAI-compatible models endpoint and sanitizes IDs', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.com/v1/models');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-provider-secret');
      expect(init?.redirect).toBe('manual');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: '' }, { name: 'ignored' }] }));
    });

    await expect(discoverProviderModels(provider, fetchMock as typeof fetch)).resolves.toEqual(['gpt-4o']);
  });

  it('appends /v1 when the base URL has no path', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe('https://api.example.com/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
    });

    await expect(discoverProviderModels({ ...provider, baseUrl: 'https://api.example.com' }, fetchMock as typeof fetch)).resolves.toEqual(['gpt-4o']);
  });

  it('allows model discovery requests up to 20 seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] })));
      await expect(discoverProviderModels(provider, fetchMock as typeof fetch)).resolves.toEqual(['gpt-4o']);
      expect(timeout).toHaveBeenCalledWith(20_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('rejects private addresses and does not follow redirects', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 302, headers: { Location: 'https://internal.example/' } }));
    await expect(discoverProviderModels({ ...provider, baseUrl: 'https://127.0.0.1/v1' }, fetchMock as typeof fetch))
      .rejects.toMatchObject({ status: 400 });
    await expect(discoverProviderModels(provider, fetchMock as typeof fetch))
      .rejects.toMatchObject({ status: 502, message: 'provider_unavailable' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('decrypts the stored key and returns only model IDs from the protected endpoint', async () => {
    const values = new Map<string, string>();
    const kv: KVNamespaceLike = {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); },
    };
    const bindings: RuntimeBindings = {
      SYS_PASSWD: 'admin-password',
      SYS_SECRET: 'test-db-secret',
      PLATFORM: 'local',
      KV: kv,
    };
    const stored = await encryptSecrets(provider as unknown as JsonObject, undefined, bindings);
    values.set(`nonebotmaker:records:providers:${provider.id}`, JSON.stringify(stored));
    let authorization: string | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('Authorization');
      return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createApiRouter();
    const login = await router.request('/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-password' }),
    }, bindings);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const response = await router.request(`/providers/${provider.id}/models`, {
      method: 'POST',
      headers: { Origin: 'http://localhost', Cookie: cookie ?? '' },
    }, bindings);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ models: ['model-a'] });
    expect(authorization).toBe('Bearer test-provider-secret');
    expect(JSON.stringify(payload)).not.toContain('test-provider-secret');
  });
});
