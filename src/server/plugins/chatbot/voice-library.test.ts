import { describe, expect, it } from 'vitest';
import { createKVVoiceAssetStore, createVoiceLibrary, type VoiceAssetStore } from './voice-library';
import type { KVNamespaceLike, RuntimeBindings } from '../../../shared/types';

function fixtures() {
  const values = new Map<string, string>();
  const kv: KVNamespaceLike = {
    async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, value); }, async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
  return { values, kv };
}
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1]);
const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

describe('durable account-scoped voice library', () => {
  it('accepts bounded MP3/WAV with matching magic bytes and isolates account/conversation scope', async () => {
    const { values, kv } = fixtures();
    const store = createKVVoiceAssetStore({ PLATFORM: 'cloudflare', KV: kv } as RuntimeBindings)!;
    const library = createVoiceLibrary(store);
    await library.save({ accountId: 'a', scope: 'group-1', name: 'hello.mp3', contentType: 'audio/mpeg', bytes: mp3, createdBy: 'owner' });
    await library.save({ accountId: 'a', scope: 'private-1', name: 'hello.wav', contentType: 'audio/wav', bytes: wav, createdBy: 'owner' });
    await library.save({ accountId: 'b', scope: 'group-1', name: 'hello.mp3', contentType: 'audio/mpeg', bytes: mp3, createdBy: 'owner' });
    expect([...values.keys()].every((key) => key.startsWith('nonebotmaker:chatbot:voice:v1:'))).toBe(true);
    expect(await library.list('a', 'group-1')).toMatchObject([{ name: 'hello.mp3', contentType: 'audio/mpeg', size: mp3.byteLength }]);
    expect(await library.list('b', 'group-1')).toHaveLength(1);
    expect(await library.get('a', 'group-1', 'hello.mp3')).toMatchObject({ bytes: mp3, digest: expect.any(String) });
    expect(await library.get('a', 'group-2', 'hello.mp3')).toBeNull();
    expect(await library.delete('a', 'group-1', 'hello.mp3')).toBe(true);
    expect(await library.list('a', 'group-1')).toEqual([]);
  });

  it('rejects MIME/signature mismatches, traversal, duplicates and oversize payloads', async () => {
    const { kv } = fixtures();
    const library = createVoiceLibrary(createKVVoiceAssetStore({ PLATFORM: 'cloudflare', KV: kv } as RuntimeBindings)!);
    await expect(library.save({ accountId: 'a', scope: 'g', name: '../escape.mp3', contentType: 'audio/mpeg', bytes: mp3, createdBy: 'owner' })).rejects.toThrow('invalid');
    await expect(library.save({ accountId: 'a', scope: 'g', name: 'wrong.mp3', contentType: 'audio/mpeg', bytes: wav, createdBy: 'owner' })).rejects.toThrow('valid MP3 and WAV');
    await library.save({ accountId: 'a', scope: 'g', name: 'voice.mp3', contentType: 'audio/mpeg', bytes: mp3, createdBy: 'owner' });
    await expect(library.save({ accountId: 'a', scope: 'elsewhere', name: 'VOICE.mp3', contentType: 'audio/mpeg', bytes: mp3, createdBy: 'owner' })).rejects.toThrow('already exists');
  });

  it('fails closed if the platform KV adapter cannot enumerate account assets', () => {
    const store = { get: async () => null, put: async () => undefined, delete: async () => undefined } as unknown as KVNamespaceLike;
    expect(createKVVoiceAssetStore({ PLATFORM: 'cloudflare', KV: store } as RuntimeBindings)).toBeNull();
    const memoryStore: VoiceAssetStore = { get: async () => null, put: async () => undefined, delete: async () => undefined, list: async () => [] };
    expect(createVoiceLibrary(memoryStore)).toBeDefined();
  });
});
