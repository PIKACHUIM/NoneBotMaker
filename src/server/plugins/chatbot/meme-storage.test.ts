import { describe, expect, it } from 'vitest';
import type { KVNamespaceLike, RuntimeBindings } from '../../../shared/types';
import { createMemeLibrary } from './meme-library';
import { createKVMemeStore } from './meme-storage';

function png() { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); }
function kvFixture() {
  const data = new Map<string, string>();
  const KV: KVNamespaceLike = {
    async get(key) { return data.get(key) ?? null; },
    async put(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
  return { data, KV };
}

describe('KV-backed meme persistence', () => {
  it('stores binary in a private namespaced object and round-trips verified metadata', async () => {
    const { data, KV } = kvFixture();
    const store = createKVMemeStore({ PLATFORM: 'cloudflare', KV } as RuntimeBindings)!;
    const library = createMemeLibrary({ store, review: async () => 'allow' });
    const metadata = await library.save({ accountId: 'account-secret', conversationScope: 'group-1', name: 'wave', bytes: png(), contentType: 'image/png', createdBy: 'owner' });
    expect([...data.keys()][0]).toMatch(/^nonebotmaker:chatbot:meme:v1:/);
    expect([...data.keys()][0]).not.toContain('account-secret');
    expect(await library.get('account-secret', 'group-1', 'wave')).toMatchObject({ ...metadata, bytes: png() });
    expect(await library.list('account-secret', 'group-2')).toEqual([]);
  });

  it('rejects broken or tampered KV objects and does not offer binary through list', async () => {
    const { data, KV } = kvFixture();
    const store = createKVMemeStore({ PLATFORM: 'cloudflare', KV } as RuntimeBindings)!;
    const library = createMemeLibrary({ store, review: async () => 'allow' });
    const metadata = await library.save({ accountId: 'a', conversationScope: 'g', name: 'asset', bytes: png(), contentType: 'image/png', createdBy: 'owner' });
    const listed = await library.list('a', 'g');
    expect(listed[0]).toEqual(metadata);
    expect(listed[0]).not.toHaveProperty('bytes');
    const key = [...data.keys()][0];
    data.set(key, 'not-json');
    await expect(library.get('a', 'g', 'asset')).resolves.toBeNull();
  });

  it('uses the platform namespace and fails closed when listing is unavailable', () => {
    const edgeKV = kvFixture().KV;
    expect(createKVMemeStore({ PLATFORM: 'edgeone', EDGEONE_KV: edgeKV } as RuntimeBindings)).not.toBeNull();
    expect(createKVMemeStore({ PLATFORM: 'esa', ESA_KV: edgeKV } as RuntimeBindings)).not.toBeNull();
    expect(createKVMemeStore({ PLATFORM: 'cloudflare' } as RuntimeBindings)).toBeNull();
    const noList = { get: async () => null, put: async () => undefined, delete: async () => undefined } as KVNamespaceLike;
    expect(createKVMemeStore({ PLATFORM: 'cloudflare', KV: noList } as RuntimeBindings)).toBeNull();
  });
});
