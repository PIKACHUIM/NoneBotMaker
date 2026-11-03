import type { RuntimeBindings } from '../../../shared/types';
import type { MemeMetadata, MemeStore, MemeStoreListEntry, MemeStoreValue } from './meme-library';

const PREFIX = 'nonebotmaker:chatbot:meme:v1:';
const LEGACY_MAX_VALUE_BYTES = 25 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const BYTES_SUFFIX = ':bytes';
const METADATA_SUFFIX = ':metadata';

interface MemeKVNamespace {
  get(key: string): Promise<string | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBufferView, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

function parseMetadata(value: string): MemeMetadata | null {
  if (new TextEncoder().encode(value).byteLength > MAX_METADATA_BYTES) return null;
  try {
    const metadata = JSON.parse(value) as unknown;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as MemeMetadata : null;
  } catch { return null; }
}

function decodeLegacy(value: string): MemeStoreValue | null {
  if (new TextEncoder().encode(value).byteLength > LEGACY_MAX_VALUE_BYTES) throw new Error('Stored meme exceeds the KV value limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const object = parsed as { metadata?: unknown; bytes?: unknown };
  if (!object.metadata || typeof object.metadata !== 'object' || Array.isArray(object.metadata) || typeof object.bytes !== 'string') return null;
  try { return { metadata: object.metadata as MemeMetadata, bytes: Uint8Array.from(atob(object.bytes), (character) => character.charCodeAt(0)) }; } catch { return null; }
}

export function createKVMemeStore(bindings: RuntimeBindings): MemeStore | null {
  const namespace = bindings.PLATFORM === 'edgeone' ? bindings.EDGEONE_KV ?? bindings.KV
    : bindings.PLATFORM === 'esa' ? bindings.ESA_KV ?? bindings.KV : bindings.KV;
  if (!namespace?.list) return null;
  const kv = namespace as unknown as MemeKVNamespace;
  const listKeys = kv.list!.bind(kv);
  return {
    async put(key, bytes, metadata) {
      if (!key.startsWith(PREFIX) || bytes.byteLength > 5 * 1024 * 1024) throw new Error('Invalid meme object key or size.');
      const metadataValue = JSON.stringify(metadata);
      if (new TextEncoder().encode(metadataValue).byteLength > MAX_METADATA_BYTES) throw new Error('Meme metadata exceeds its size limit.');
      const bytesKey = `${key}${BYTES_SUFFIX}`;
      const metadataKey = `${key}${METADATA_SUFFIX}`;
      await kv.put(bytesKey, new Uint8Array(bytes));
      try {
        await kv.put(metadataKey, metadataValue);
      } catch (error) {
        await kv.delete(bytesKey).catch(() => undefined);
        throw error;
      }
    },
    async get(key) {
      if (!key.startsWith(PREFIX)) return null;
      const metadataValue = await kv.get(`${key}${METADATA_SUFFIX}`);
      if (metadataValue !== null) {
        const metadata = parseMetadata(metadataValue);
        if (!metadata) throw new Error('Stored meme metadata is invalid.');
        const buffer = await kv.get(`${key}${BYTES_SUFFIX}`, 'arrayBuffer');
        if (buffer === null) throw new Error('Stored meme bytes are missing.');
        return { metadata, bytes: new Uint8Array(buffer) };
      }
      const legacyValue = await kv.get(key);
      return legacyValue === null ? null : decodeLegacy(legacyValue);
    },
    async delete(key) {
      if (!key.startsWith(PREFIX)) throw new Error('Invalid meme object key.');
      await Promise.all([kv.delete(`${key}${BYTES_SUFFIX}`), kv.delete(`${key}${METADATA_SUFFIX}`), kv.delete(key)]);
    },
    async list(prefix) {
      if (!prefix.startsWith(PREFIX)) throw new Error('Invalid meme object prefix.');
      const entries: MemeStoreListEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await listKeys({ prefix, limit: 100, cursor });
        for (const { name } of page.keys) {
          if (!name.startsWith(PREFIX) || name.endsWith(BYTES_SUFFIX)) continue;
          if (name.endsWith(METADATA_SUFFIX)) {
            const metadataValue = await kv.get(name);
            const metadata = metadataValue === null ? null : parseMetadata(metadataValue);
            if (metadata) entries.push({ key: name.slice(0, -METADATA_SUFFIX.length), metadata });
            continue;
          }
          const legacyValue = await kv.get(name);
          const legacy = legacyValue === null ? null : decodeLegacy(legacyValue);
          if (legacy) entries.push({ key: name, metadata: legacy.metadata });
        }
        cursor = page.list_complete ? undefined : page.cursor;
        if (!page.list_complete && !cursor) throw new Error('Meme KV listing returned an invalid cursor.');
      } while (cursor);
      return entries;
    },
  };
}
