import { describe, expect, it } from 'vitest';
import type { KVNamespaceLike, RuntimeBindings } from '../../../shared/types';
import { createMemeLibrary } from './meme-library';
import { createKVMemeStore } from './meme-storage';

function png() { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); }
function kvFixture() {
  const data = new Map<string, string | Uint8Array>();
  const KV = {
    async get(key: string, type?: 'arrayBuffer') {
      const value = data.get(key);
      if (value === undefined) return null;
      if (type === 'arrayBuffer') {
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
        return bytes.slice().buffer as ArrayBuffer;
      }
      return typeof value === 'string' ? value : null;
    },
    async put(key: string, value: string | ArrayBufferView) {
      data.set(key, typeof value === 'string' ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    },
    async delete(key: string) { data.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  } as unknown as KVNamespaceLike;
  return { data, KV };
}

describe('KV-backed meme persistence', () => {
  it('stores binary in a private namespaced object and round-trips verified metadata', async () => {
    const { data, KV } = kvFixture();
    const store = createKVMemeStore({ PLATFORM: 'cloudflare', KV } as RuntimeBindings)!;
    const library = createMemeLibrary({ store, review: async () => 'allow' });
    const metadata = await library.save({ accountId: 'account-secret', conversationScope: 'group-1', name: 'wave', bytes: png(), contentType: 'image/png', createdBy: 'owner' });
    const metadataKey = [...data.keys()].find((key) => key.endsWith(':metadata'))!;
    const objectKey = metadataKey.slice(0, -':metadata'.length);
    expect(metadataKey).toMatch(/^nonebotmaker:chatbot:meme:v1:/);
    expect(metadataKey).not.toContain('account-secret');
    expect(data.get(`${objectKey}:bytes`)).toEqual(png());
    expect(data.get(`${objectKey}:bytes`)).toBeInstanceOf(Uint8Array);
    expect(data.has(objectKey)).toBe(false);
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
    const metadataKey = [...data.keys()].find((key) => key.endsWith(':metadata'))!;
    const objectKey = metadataKey.slice(0, -':metadata'.length);
    data.set(`${objectKey}:bytes`, new Uint8Array([0]));
    await expect(library.get('a', 'g', 'asset')).rejects.toThrow('integrity');
  });

  it('reads existing base64-backed KV objects while writing new assets as binary', async () => {
    const { data, KV } = kvFixture();
    const store = createKVMemeStore({ PLATFORM: 'cloudflare', KV } as RuntimeBindings)!;
    const library = createMemeLibrary({ store, review: async () => 'allow' });
    const bytes = png();
    const metadata = await library.save({ accountId: 'legacy-account', conversationScope: 'group-1', name: 'legacy', bytes, contentType: 'image/png', createdBy: 'owner' });
    const metadataKey = [...data.keys()].find((key) => key.endsWith(':metadata'))!;
    const objectKey = metadataKey.slice(0, -':metadata'.length);
    data.delete(`${objectKey}:metadata`);
    data.delete(`${objectKey}:bytes`);
    const binary = String.fromCharCode(...bytes);
    data.set(objectKey, JSON.stringify({ metadata, bytes: btoa(binary) }));
    expect(await library.list('legacy-account', 'group-1')).toMatchObject([{ name: 'legacy', contentType: 'image/png' }]);
    await expect(library.get('legacy-account', 'group-1', 'legacy')).resolves.toMatchObject({ ...metadata, bytes });
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
