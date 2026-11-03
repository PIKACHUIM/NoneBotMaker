import { describe, expect, it, vi } from 'vitest';
import {
  createMemeLibrary,
  createMemeTools,
  DEFAULT_MAX_MEME_BYTES,
  DEFAULT_MAX_MEMES_PER_ACCOUNT,
  type MemeContentType,
  type MemeMetadata,
  type MemeReviewDecision,
  type MemeStore,
  type MemeStoreListEntry,
  type MemeStoreValue,
} from './meme-library';

class MemoryMemeStore implements MemeStore {
  readonly values = new Map<string, MemeStoreValue>();
  readonly put = vi.fn(async (key: string, bytes: Uint8Array, metadata: MemeMetadata) => {
    this.values.set(key, { bytes: new Uint8Array(bytes), metadata: structuredClone(metadata) });
  });
  readonly delete = vi.fn(async (key: string) => { this.values.delete(key); });

  async get(key: string): Promise<MemeStoreValue | null> {
    const value = this.values.get(key);
    return value ? { bytes: new Uint8Array(value.bytes), metadata: structuredClone(value.metadata) } : null;
  }

  async list(prefix: string): Promise<MemeStoreListEntry[]> {
    return [...this.values]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, metadata: structuredClone(value.metadata) }));
  }
}

const fixtures: Array<[MemeContentType, Uint8Array]> = [
  ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
  ['image/gif', new TextEncoder().encode('GIF89a')],
  ['image/webp', new TextEncoder().encode('RIFF0000WEBP')],
];

function createFixture(options: {
  maxAssetBytes?: number;
  maxAssets?: number;
  decision?: MemeReviewDecision | string;
  review?: (bytes: Uint8Array, contentType: MemeContentType) => Promise<MemeReviewDecision>;
} = {}) {
  const store = new MemoryMemeStore();
  const review = options.review ?? vi.fn(async () => options.decision ?? 'allow') as (bytes: Uint8Array, contentType: MemeContentType) => Promise<MemeReviewDecision>;
  const library = createMemeLibrary({ store, review, maxAssetBytes: options.maxAssetBytes, maxAssets: options.maxAssets });
  return { store, review, library };
}

function input(overrides: Partial<Parameters<ReturnType<typeof createMemeLibrary>['save']>[0]> = {}) {
  return {
    accountId: 'account-a',
    conversationScope: 'group-1',
    name: '猫猫',
    bytes: fixtures[0][1],
    contentType: 'image/png',
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('meme library validation and review', () => {
  it.each(fixtures)('accepts %s only with matching MIME and file signature', async (contentType, bytes) => {
    const { library, store, review } = createFixture();
    await expect(library.save(input({ contentType, bytes }))).resolves.toMatchObject({ contentType, size: bytes.byteLength });
    expect(review).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it.each([
    { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg/>') },
    { contentType: 'image/jpeg', bytes: fixtures[0][1] },
    { contentType: 'image/gif', bytes: new TextEncoder().encode('toString') },
    { contentType: 'image/png', bytes: new Uint8Array() },
  ])('rejects unsupported, mismatched, or empty content before review or writes', async (bad) => {
    const { library, store, review } = createFixture();
    await expect(library.save(input(bad))).rejects.toThrow();
    expect(review).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it('enforces byte limits including the exact boundary and rejects larger assets', async () => {
    const { library, store, review } = createFixture({ maxAssetBytes: 8 });
    await expect(library.save(input())).resolves.toBeDefined();
    await expect(library.save(input({ name: 'large', bytes: new Uint8Array([...fixtures[0][1], 0]) }))).rejects.toThrow('size limit');
    expect(review).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(DEFAULT_MAX_MEME_BYTES).toBe(5 * 1024 * 1024);
  });

  it('rejects unsafe titles and enforces a 64-byte UTF-8 name limit', async () => {
    const { library, store, review } = createFixture();
    await expect(library.save(input({ name: '😀'.repeat(17) }))).rejects.toThrow('64 UTF-8 bytes');
    await expect(library.save(input({ name: '../cat' }))).rejects.toThrow('unsafe');
    await expect(library.save(input({ name: 'CON' }))).rejects.toThrow('reserved');
    expect(review).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(['deny', 'uncertain', 'review-error', 'unknown'])('fails closed when review result is %s and never writes', async (result) => {
    const { library, store } = createFixture({
      review: async () => {
        if (result === 'review-error') throw new Error('sensitive reviewer failure');
        return result as MemeReviewDecision;
      },
    });
    await expect(library.save(input())).rejects.toThrow(result === 'review-error' ? 'review failed' : 'explicitly allow');
    expect(store.put).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it('copies input and review bytes so mutation cannot change the persisted digest', async () => {
    const original = new Uint8Array(fixtures[0][1]);
    const review = vi.fn(async (bytes: Uint8Array) => {
      bytes.fill(0);
      return 'allow' as const;
    });
    const { library } = createFixture({ review });
    await library.save(input({ bytes: original }));
    original.fill(0);
    const loaded = await library.get('account-a', 'group-1', '猫猫');
    expect(loaded?.bytes).toEqual(fixtures[0][1]);
  });

  it('rejects invalid configured limits above the hard caps', () => {
    const store = new MemoryMemeStore();
    const review = async () => 'allow' as const;
    expect(() => createMemeLibrary({ store, review, maxAssetBytes: DEFAULT_MAX_MEME_BYTES + 1 })).toThrow('limit');
    expect(() => createMemeLibrary({ store, review, maxAssets: DEFAULT_MAX_MEMES_PER_ACCOUNT + 1 })).toThrow('limit');
  });
});

describe('meme account and scope isolation', () => {
  it('uses normalized case-insensitive names and rejects duplicates across account scopes', async () => {
    const { library } = createFixture();
    await library.save(input({ name: 'Hello' }));
    await expect(library.save(input({ name: 'ｈＥＬＬＯ', conversationScope: 'group-2' }))).rejects.toThrow('already exists');
    expect((await library.findByName('account-a', 'HELLO'))?.name).toBe('Hello');
    expect(await library.findByName('account-b', 'hello')).toBeNull();
  });

  it('limits listing, lookup, get, and deletion to the requested account and scope', async () => {
    const { library, store } = createFixture();
    await library.save(input({ name: 'cat' }));
    await library.save(input({ accountId: 'account-b', name: 'cat' }));
    expect(await library.list('account-a', 'group-2')).toEqual([]);
    expect(await library.list('account-a')).toHaveLength(1);
    expect(await library.get('account-b', 'group-1', 'cat')).toMatchObject({ accountId: 'account-b' });
    expect(await library.get('account-a', 'group-2', 'cat')).toBeNull();
    expect(await library.delete('account-a', 'group-2', 'cat')).toBe(false);
    expect(store.values.size).toBe(2);
    expect(await library.delete('account-a', 'group-1', 'cat')).toBe(true);
    expect(await library.get('account-a', 'group-1', 'cat')).toBeNull();
    expect(store.values.size).toBe(1);
  });

  it('enforces per-account asset counts without blocking another account', async () => {
    const { library } = createFixture({ maxAssets: 1 });
    await library.save(input({ name: 'one' }));
    await expect(library.save(input({ name: 'two' }))).rejects.toThrow('limit reached');
    await expect(library.save(input({ accountId: 'account-b', name: 'one' }))).resolves.toBeDefined();
  });

  it('returns bytes only from get and detects stored-byte tampering', async () => {
    const { library, store } = createFixture();
    const metadata = await library.save(input());
    expect(await library.list('account-a')).toEqual([metadata]);
    const key = [...store.values.keys()][0];
    store.values.get(key)!.bytes[0] = 0;
    await expect(library.get('account-a', 'group-1', '猫猫')).rejects.toThrow('integrity');
  });

  it('serializes writes across library instances in one runtime so the account limit is respected', async () => {
    const store = new MemoryMemeStore();
    const options = { store, review: async () => 'allow' as const, maxAssets: 1 };
    const first = createMemeLibrary(options);
    const second = createMemeLibrary(options);
    const results = await Promise.allSettled([
      first.save(input({ name: 'one' })),
      second.save(input({ name: 'two' })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

describe('meme agent tools', () => {
  it('registers only save/list tools and binds save to the current account, scope, creator, and image resolver', async () => {
    const { library } = createFixture();
    const getImage = vi.fn(async (index: number) => index === 1 ? { bytes: fixtures[0][1], contentType: 'image/png' } : null);
    const tools = createMemeTools(library, {
      accountId: 'account-a', conversationScope: 'group-1', createdBy: 'user-1', getImage,
    });
    expect(tools.map((entry) => entry.definition.function.name)).toEqual(['chat_save_meme', 'chat_list_memes']);
    const saved = JSON.parse(await tools[0].execute({ imageIndex: 1, name: 'pet' }));
    expect(saved).toMatchObject({ isError: false, meme: { accountId: 'account-a', conversationScope: 'group-1', createdBy: 'user-1', name: 'pet' } });
    expect(getImage).toHaveBeenCalledWith(1);
    expect(JSON.parse(await tools[1].execute({})).memes[0]).not.toHaveProperty('bytes');
  });

  it('does not save when the requested image is absent from the current message', async () => {
    const { library, store } = createFixture();
    const tools = createMemeTools(library, {
      accountId: 'account-a', conversationScope: 'group-1', createdBy: 'user-1',
      getImage: async () => null,
    });
    await expect(tools[0].execute({ imageIndex: 2, name: 'pet' })).rejects.toThrow('current message');
    expect(store.put).not.toHaveBeenCalled();
  });
});
