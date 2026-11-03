import type { JsonObject } from '../../../shared/types';
import { tool, type AgentTool } from './tools';

export const DEFAULT_MAX_MEME_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_MEMES_PER_ACCOUNT = 200;
const STORE_KEY_PREFIX = 'nonebotmaker:chatbot:meme:v1:';
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const accountLocks = new Map<string, Promise<void>>();

export type MemeContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export type MemeReviewDecision = 'allow' | 'deny' | 'uncertain';

export interface MemeMetadata {
  version: 1;
  accountId: string;
  conversationScope: string;
  name: string;
  normalizedName: string;
  contentType: MemeContentType;
  size: number;
  digest: string;
  createdBy: string;
  createdAt: string;
}

export interface MemeStoreValue {
  bytes: Uint8Array;
  metadata: MemeMetadata;
}

export interface MemeStoreListEntry {
  key: string;
  metadata: MemeMetadata;
}

export interface MemeStore {
  put(key: string, bytes: Uint8Array, metadata: MemeMetadata): Promise<void>;
  get(key: string): Promise<MemeStoreValue | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<MemeStoreListEntry[]>;
}

export interface SaveMemeInput {
  accountId: string;
  conversationScope: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
  createdBy: string;
}

export interface MemeAsset extends MemeMetadata {
  bytes: Uint8Array;
}

export interface MemeLibrary {
  save(input: SaveMemeInput): Promise<MemeMetadata>;
  list(accountId: string, scope?: string): Promise<MemeMetadata[]>;
  get(accountId: string, scope: string, name: string): Promise<MemeAsset | null>;
  delete(accountId: string, scope: string, name: string): Promise<boolean>;
  findByName(accountId: string, name: string): Promise<MemeMetadata | null>;
}

export interface MemeLibraryOptions {
  store: MemeStore;
  review(bytes: Uint8Array, contentType: MemeContentType): Promise<MemeReviewDecision>;
  maxAssetBytes?: number;
  maxAssets?: number;
}

export interface CurrentMemeImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface MemeToolContext {
  accountId: string;
  conversationScope: string;
  createdBy: string;
  getImage(imageIndex: number): Promise<CurrentMemeImage | null>;
}

function validIdentity(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`Invalid meme ${label}.`);
  }
  return value;
}

function safeName(value: string): { name: string; normalizedName: string } {
  if (typeof value !== 'string') throw new Error('Meme name must be text.');
  const name = value.normalize('NFKC').trim();
  if (!name || new TextEncoder().encode(name).byteLength > 64) throw new Error('Meme name must be between 1 and 64 UTF-8 bytes.');
  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw new Error('Meme name contains invalid Unicode.');
  }
  if (/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) || name === '.' || name === '..' || name.endsWith('.')) {
    throw new Error('Meme name contains unsafe characters.');
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) throw new Error('Meme name is reserved.');
  return { name, normalizedName: name.toLowerCase() };
}

function validateLimits(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new Error(`Invalid ${label} limit.`);
  return limit;
}

function imageType(contentType: string, bytes: Uint8Array): MemeContentType {
  const mime = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
  if (!MIME_TYPES.has(mime)) throw new Error('Only PNG, JPEG, GIF, and WebP images are supported.');
  const signature = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 12)));
  const matches = mime === 'image/png'
    ? bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    : mime === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === 'image/gif'
        ? signature === 'GIF87a' || signature === 'GIF89a'
        : bytes.length >= 12 && signature.slice(0, 4) === 'RIFF' && signature.slice(8, 12) === 'WEBP';
  if (!matches) throw new Error('Image content type does not match its file signature.');
  return mime as MemeContentType;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digestText(value: string): Promise<string> {
  return sha256(new TextEncoder().encode(value));
}

function isMetadata(value: unknown): value is MemeMetadata {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Partial<MemeMetadata>;
  return metadata.version === 1 && typeof metadata.accountId === 'string' && typeof metadata.conversationScope === 'string' &&
    typeof metadata.name === 'string' && typeof metadata.normalizedName === 'string' && MIME_TYPES.has(metadata.contentType ?? '') &&
    Number.isSafeInteger(metadata.size) && typeof metadata.digest === 'string' && typeof metadata.createdBy === 'string' && typeof metadata.createdAt === 'string';
}

export function createMemeLibrary(options: MemeLibraryOptions): MemeLibrary {
  const { store, review } = options;
  const maxAssetBytes = validateLimits(options.maxAssetBytes, DEFAULT_MAX_MEME_BYTES, DEFAULT_MAX_MEME_BYTES, 'asset size');
  const maxAssets = validateLimits(options.maxAssets, DEFAULT_MAX_MEMES_PER_ACCOUNT, DEFAULT_MAX_MEMES_PER_ACCOUNT, 'asset count');

  async function withAccountLock<T>(accountKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = accountLocks.get(accountKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    accountLocks.set(accountKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (accountLocks.get(accountKey) === current) accountLocks.delete(accountKey);
    }
  }

  async function accountPrefix(accountId: string): Promise<string> {
    return `${STORE_KEY_PREFIX}${await digestText(accountId)}:`;
  }

  async function accountEntries(accountId: string): Promise<MemeStoreListEntry[]> {
    const prefix = await accountPrefix(accountId);
    const entries = await store.list(prefix);
    if (!Array.isArray(entries)) throw new Error('Meme storage returned an invalid listing.');
    return entries.filter((entry) => entry && typeof entry.key === 'string' && entry.key.startsWith(prefix) && isMetadata(entry.metadata) && entry.metadata.accountId === accountId);
  }

  function findEntry(entries: MemeStoreListEntry[], scope: string | undefined, normalizedName: string): MemeStoreListEntry | undefined {
    const matches = entries.filter((entry) => entry.metadata.normalizedName === normalizedName && (scope === undefined || entry.metadata.conversationScope === scope));
    if (matches.length > 1) throw new Error('Meme name is ambiguous in this account.');
    return matches[0];
  }

  async function checkedAsset(entry: MemeStoreListEntry): Promise<MemeAsset | null> {
    const stored = await store.get(entry.key);
    if (!stored) return null;
    const listed = entry.metadata;
    const metadata = stored.metadata;
    if (!(stored.bytes instanceof Uint8Array) || !isMetadata(metadata) || metadata.accountId !== listed.accountId ||
      metadata.conversationScope !== listed.conversationScope || metadata.name !== listed.name || metadata.normalizedName !== listed.normalizedName ||
      metadata.contentType !== listed.contentType || metadata.size !== listed.size || metadata.digest !== listed.digest || metadata.createdBy !== listed.createdBy ||
      metadata.createdAt !== listed.createdAt || stored.bytes.byteLength !== metadata.size || stored.bytes.byteLength > maxAssetBytes ||
      await sha256(stored.bytes) !== metadata.digest) throw new Error('Stored meme failed integrity validation.');
    try {
      imageType(metadata.contentType, stored.bytes);
    } catch {
      throw new Error('Stored meme failed integrity validation.');
    }
    return { ...metadata, bytes: new Uint8Array(stored.bytes) };
  }

  return {
    async save(input) {
      const accountId = validIdentity(input.accountId, 'account ID');
      const conversationScope = validIdentity(input.conversationScope, 'conversation scope');
      const createdBy = validIdentity(input.createdBy, 'creator ID');
      if (!(input.bytes instanceof Uint8Array)) throw new Error('Meme bytes must be a Uint8Array.');
      if (!input.bytes.byteLength || input.bytes.byteLength > maxAssetBytes) throw new Error('Meme image is empty or exceeds the size limit.');
      const bytes = new Uint8Array(input.bytes);
      const { name, normalizedName } = safeName(input.name);
      const contentType = imageType(input.contentType, bytes);
      const accountKey = await digestText(accountId);

      return withAccountLock(accountKey, async () => {
        const existing = await accountEntries(accountId);
        if (findEntry(existing, undefined, normalizedName)) throw new Error('A meme with this name already exists in this account.');
        if (existing.length >= maxAssets) throw new Error('Meme account limit reached.');
        const digest = await sha256(bytes);
        let decision: MemeReviewDecision | unknown;
        try {
          decision = await review(new Uint8Array(bytes), contentType);
        } catch {
          throw new Error('Meme review failed; the image was not saved.');
        }
        if (decision !== 'allow') throw new Error('Meme review did not explicitly allow this image.');

        const metadata: MemeMetadata = {
          version: 1,
          accountId,
          conversationScope,
          name,
          normalizedName,
          contentType,
          size: bytes.byteLength,
          digest,
          createdBy,
          createdAt: new Date().toISOString(),
        };
        const tupleDigest = await digestText(JSON.stringify([accountId, conversationScope, normalizedName]));
        const key = `${await accountPrefix(accountId)}${tupleDigest}`;
        await store.put(key, new Uint8Array(bytes), metadata);
        return metadata;
      });
    },

    async list(accountIdValue, scopeValue) {
      const accountId = validIdentity(accountIdValue, 'account ID');
      const scope = scopeValue === undefined ? undefined : validIdentity(scopeValue, 'conversation scope');
      const entries = await accountEntries(accountId);
      return entries
        .map((entry) => entry.metadata)
        .filter((metadata) => scope === undefined || metadata.conversationScope === scope)
        .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));
    },

    async findByName(accountIdValue, nameValue) {
      const accountId = validIdentity(accountIdValue, 'account ID');
      const { normalizedName } = safeName(nameValue);
      const entry = findEntry(await accountEntries(accountId), undefined, normalizedName);
      return entry?.metadata ?? null;
    },

    async get(accountIdValue, scopeValue, nameValue) {
      const accountId = validIdentity(accountIdValue, 'account ID');
      const scope = validIdentity(scopeValue, 'conversation scope');
      const { normalizedName } = safeName(nameValue);
      const entry = findEntry(await accountEntries(accountId), scope, normalizedName);
      return entry ? checkedAsset(entry) : null;
    },

    async delete(accountIdValue, scopeValue, nameValue) {
      const accountId = validIdentity(accountIdValue, 'account ID');
      const scope = validIdentity(scopeValue, 'conversation scope');
      const { normalizedName } = safeName(nameValue);
      const entry = findEntry(await accountEntries(accountId), scope, normalizedName);
      if (!entry) return false;
      await store.delete(entry.key);
      return true;
    },
  };
}

export function createMemeTools(library: MemeLibrary, context: MemeToolContext): AgentTool[] {
  return [
    tool(
      'chat_save_meme',
      '审核并保存本轮消息中的一张图片。只使用当前消息图片序号，不接受外部图片地址。',
      {
        imageIndex: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 64 },
      } as JsonObject,
      ['imageIndex', 'name'],
      async (args) => {
        const imageIndex = Number(args.imageIndex);
        if (!Number.isSafeInteger(imageIndex) || imageIndex < 1 || typeof args.name !== 'string') throw new Error('Invalid meme save arguments.');
        const image = await context.getImage(imageIndex);
        if (!image) throw new Error('The selected image is not present in the current message.');
        const metadata = await library.save({
          accountId: context.accountId,
          conversationScope: context.conversationScope,
          name: args.name,
          bytes: image.bytes,
          contentType: image.contentType,
          createdBy: context.createdBy,
        });
        return JSON.stringify({ isError: false, meme: metadata });
      },
    ),
    tool(
      'chat_list_memes',
      '列出当前账户与会话范围内已审核的表情素材，不返回素材二进制数据。',
      {} as JsonObject,
      [],
      async () => JSON.stringify({ isError: false, memes: await library.list(context.accountId, context.conversationScope) }),
    ),
  ];
}
