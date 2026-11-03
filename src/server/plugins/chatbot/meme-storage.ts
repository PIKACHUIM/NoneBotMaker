import type { RuntimeBindings } from '../../../shared/types';
import type { MemeMetadata, MemeStore, MemeStoreListEntry, MemeStoreValue } from './meme-library';

const PREFIX = 'nonebotmaker:chatbot:meme:v1:';
const MAX_VALUE_BYTES = 25 * 1024 * 1024;

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function parse(value: string): MemeStoreValue | null {
  if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) throw new Error('Stored meme exceeds the KV value limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const object = parsed as { metadata?: unknown; bytes?: unknown };
  if (!object.metadata || typeof object.metadata !== 'object' || Array.isArray(object.metadata) || typeof object.bytes !== 'string') return null;
  try { return { metadata: object.metadata as MemeMetadata, bytes: decode(object.bytes) }; } catch { return null; }
}

export function createKVMemeStore(bindings: RuntimeBindings): MemeStore | null {
  const kv = bindings.PLATFORM === 'edgeone' ? bindings.EDGEONE_KV ?? bindings.KV
    : bindings.PLATFORM === 'esa' ? bindings.ESA_KV ?? bindings.KV : bindings.KV;
  if (!kv?.list) return null;
  const listKeys = kv.list.bind(kv);
  return {
    async put(key, bytes, metadata) {
      if (!key.startsWith(PREFIX) || bytes.byteLength > 5 * 1024 * 1024) throw new Error('Invalid meme object key or size.');
      const value = JSON.stringify({ metadata, bytes: encode(bytes) });
      if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) throw new Error('Meme exceeds the configured KV object limit.');
      await kv.put(key, value);
    },
    async get(key) {
      if (!key.startsWith(PREFIX)) return null;
      const value = await kv.get(key);
      return value === null ? null : parse(value);
    },
    async delete(key) {
      if (!key.startsWith(PREFIX)) throw new Error('Invalid meme object key.');
      await kv.delete(key);
    },
    async list(prefix) {
      if (!prefix.startsWith(PREFIX)) throw new Error('Invalid meme object prefix.');
      const entries: MemeStoreListEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await listKeys({ prefix, limit: 100, cursor });
        for (const { name } of page.keys) {
          if (!name.startsWith(PREFIX)) continue;
          const value = await kv.get(name);
          if (value === null) continue;
          const parsed = parse(value);
          if (parsed) entries.push({ key: name, metadata: parsed.metadata });
        }
        cursor = page.list_complete ? undefined : page.cursor;
        if (!page.list_complete && !cursor) throw new Error('Meme KV listing returned an invalid cursor.');
      } while (cursor);
      return entries;
    },
  };
}
