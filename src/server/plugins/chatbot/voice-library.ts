import type { RuntimeBindings } from '../../../shared/types';

export type VoiceContentType = 'audio/mpeg' | 'audio/wav';
export interface VoiceAssetMetadata {
  accountId: string;
  conversationScope: string;
  name: string;
  contentType: VoiceContentType;
  size: number;
  digest: string;
  createdBy: string;
  createdAt: string;
}
export interface VoiceAsset extends VoiceAssetMetadata { bytes: Uint8Array }
interface StoredVoiceAsset extends VoiceAssetMetadata { bytes: string }
export interface VoiceAssetStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
export interface VoiceLibrary {
  list(accountId: string, scope?: string): Promise<VoiceAssetMetadata[]>;
  save(input: { accountId: string; scope: string; name: string; contentType: string; bytes: Uint8Array; createdBy: string }): Promise<VoiceAssetMetadata>;
  get(accountId: string, scope: string, name: string): Promise<VoiceAsset | null>;
  delete(accountId: string, scope: string, name: string): Promise<boolean>;
}

const PREFIX = 'nonebotmaker:chatbot:voice:v1:';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ASSETS_PER_ACCOUNT = 200;
const locks = new Map<string, Promise<void>>();
const encoder = new TextEncoder();

function safeName(value: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name || encoder.encode(name).byteLength > 96 || /[\\/\x00-\x1f\x7f-\x9f]/.test(name) || name === '.' || name === '..' || name.endsWith('.')) throw new Error('Voice asset name is invalid.');
  return name;
}
function validateIdentity(value: string, label: string): string {
  if (!value.trim() || value.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error(`Voice ${label} is invalid.`);
  return value;
}
function validateAudio(contentType: string, bytes: Uint8Array): VoiceContentType {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  const mpeg = mime === 'audio/mpeg' && bytes.length >= 3 && (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  const wav = mime === 'audio/wav' && bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
  if (!mpeg && !wav) throw new Error('Only valid MP3 and WAV voice assets are supported.');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Voice asset is empty or exceeds the 5 MiB limit.');
  return mime as VoiceContentType;
}
async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes);
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...result].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}
function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function hashText(value: string): Promise<string> { return digest(encoder.encode(value)); }

export function createKVVoiceAssetStore(bindings: RuntimeBindings): VoiceAssetStore | null {
  const kv = bindings.PLATFORM === 'edgeone' ? bindings.EDGEONE_KV ?? bindings.KV : bindings.PLATFORM === 'esa' ? bindings.ESA_KV ?? bindings.KV : bindings.KV;
  if (!kv?.list) return null;
  const listKeys = kv.list.bind(kv);
  return {
    get: async (key) => { if (!key.startsWith(PREFIX)) return null; return kv.get(key); },
    put: async (key, value) => { if (!key.startsWith(PREFIX) || encoder.encode(value).byteLength > 10 * 1024 * 1024) throw new Error('Voice asset KV object exceeds its size limit.'); await kv.put(key, value); },
    delete: async (key) => { if (!key.startsWith(PREFIX)) throw new Error('Invalid voice asset key.'); await kv.delete(key); },
    async list(prefix) {
      if (!prefix.startsWith(PREFIX)) throw new Error('Invalid voice asset prefix.');
      const keys: string[] = []; let cursor: string | undefined;
      do {
        const page = await listKeys({ prefix, limit: 100, cursor });
        keys.push(...page.keys.map(({ name }) => name).filter((name) => name.startsWith(PREFIX)));
        cursor = page.list_complete ? undefined : page.cursor;
        if (!page.list_complete && !cursor) throw new Error('Voice asset listing returned an invalid cursor.');
      } while (cursor);
      return keys;
    },
  };
}

export function createVoiceLibrary(store: VoiceAssetStore): VoiceLibrary {
  async function accountPrefix(accountId: string) { return `${PREFIX}${await hashText(accountId)}:`; }
  async function all(accountId: string): Promise<Array<{ key: string; asset: StoredVoiceAsset }>> {
    const prefix = await accountPrefix(accountId); const rows: Array<{ key: string; asset: StoredVoiceAsset }> = [];
    for (const key of await store.list(prefix)) {
      const value = await store.get(key); if (!value) continue;
      let asset: StoredVoiceAsset;
      try { asset = JSON.parse(value) as StoredVoiceAsset; } catch { continue; }
      if (asset && asset.accountId === accountId && typeof asset.name === 'string' && typeof asset.bytes === 'string' && Number.isSafeInteger(asset.size)) rows.push({ key, asset });
    }
    return rows;
  }
  return {
    async list(accountIdValue, scopeValue) {
      const accountId = validateIdentity(accountIdValue, 'account ID'); const scope = scopeValue === undefined ? undefined : validateIdentity(scopeValue, 'scope');
      return (await all(accountId)).map(({ asset }) => asset).filter((asset) => scope === undefined || asset.conversationScope === scope).map(({ bytes: _bytes, ...metadata }) => metadata).sort((a, b) => a.name.localeCompare(b.name));
    },
    async save(input) {
      const accountId = validateIdentity(input.accountId, 'account ID'); const scope = validateIdentity(input.scope, 'scope'); const createdBy = validateIdentity(input.createdBy, 'creator');
      const name = safeName(input.name); const bytes = new Uint8Array(input.bytes); const contentType = validateAudio(input.contentType, bytes); const accountKey = await hashText(accountId);
      const previous = locks.get(accountKey) ?? Promise.resolve(); let release!: () => void; const active = new Promise<void>((resolve) => { release = resolve; }); locks.set(accountKey, active); await previous;
      try {
        const rows = await all(accountId);
        if (rows.some(({ asset }) => asset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Voice asset already exists for this account.');
        if (rows.length >= MAX_ASSETS_PER_ACCOUNT) throw new Error('Voice asset account limit reached.');
        const metadata: VoiceAssetMetadata = { accountId, conversationScope: scope, name, contentType, size: bytes.byteLength, digest: await digest(bytes), createdBy, createdAt: new Date().toISOString() };
        const key = `${await accountPrefix(accountId)}${await hashText(JSON.stringify([scope, name.toLocaleLowerCase()]))}`;
        await store.put(key, JSON.stringify({ ...metadata, bytes: encode(bytes) } satisfies StoredVoiceAsset));
        return metadata;
      } finally { release(); if (locks.get(accountKey) === active) locks.delete(accountKey); }
    },
    async get(accountIdValue, scopeValue, nameValue) {
      const accountId = validateIdentity(accountIdValue, 'account ID'); const scope = validateIdentity(scopeValue, 'scope'); const name = safeName(nameValue);
      const row = (await all(accountId)).find(({ asset }) => asset.conversationScope === scope && asset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!row) return null;
      const bytes = decode(row.asset.bytes);
      const contentType = validateAudio(row.asset.contentType, bytes);
      if (bytes.byteLength !== row.asset.size || await digest(bytes) !== row.asset.digest) throw new Error('Stored voice asset failed integrity validation.');
      const { bytes: _encoded, ...metadata } = row.asset;
      return { ...metadata, contentType, bytes };
    },
    async delete(accountIdValue, scopeValue, nameValue) {
      const accountId = validateIdentity(accountIdValue, 'account ID'); const scope = validateIdentity(scopeValue, 'scope'); const name = safeName(nameValue);
      const row = (await all(accountId)).find(({ asset }) => asset.conversationScope === scope && asset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!row) return false; await store.delete(row.key); return true;
    },
  };
}
