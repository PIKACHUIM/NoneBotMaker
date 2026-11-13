import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike } from '../../shared/types';
import { createConversationMemoryRepository, type ConversationMemoryScope } from './conversation-memory-repository';

const sqlite = await import('node:sqlite').catch(() => null);
function adapter(database: DatabaseSync): D1DatabaseLike {
  return { prepare(query): D1StatementLike {
    const statement = database.prepare(query);
    let values: SQLInputValue[] = [];
    return { bind(...bound) { values = bound as SQLInputValue[]; return this; },
      async first<T>() { return statement.get(...values) as T | null ?? null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
  } };
}
const scope: ConversationMemoryScope = { accountId: 'account', groupId: 'record', conversationType: 'group', externalId: 'openid-a' };
const policy = { maxEntries: 2, retentionDays: 7 };
const input = (name: string, status: 'pending' | 'confirmed' = 'confirmed') => ({ name, title: name, content: `content-${name}`, status, type: 'user' as const });

async function fixture() {
  const database = new sqlite!.DatabaseSync(':memory:');
  database.exec(`CREATE TABLE chatbot_conversation_memories (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_id TEXT NOT NULL,
    conversation_type TEXT NOT NULL CHECK (conversation_type IN ('group','private')),
    group_external_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('confirmed','pending')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    UNIQUE (account_id, conversation_type, group_external_id, name));`);
  return { database, repository: createConversationMemoryRepository({ DB: adapter(database) }) };
}

describe.skipIf(!sqlite?.DatabaseSync)('independent conversation memory D1 storage', () => {
  it('separates two QQ openids on the same group record and account/private scopes', async () => {
    const { database, repository } = await fixture();
    try {
      await repository.save(scope, input('same'), policy, 1_000);
      await repository.save({ ...scope, externalId: 'openid-b' }, input('same'), policy, 1_000);
      await repository.save({ ...scope, conversationType: 'private' }, input('same'), policy, 1_000);
      expect(await repository.list(scope, 1_001)).toHaveLength(1);
      expect(await repository.list({ ...scope, externalId: 'openid-b' }, 1_001)).toHaveLength(1);
      expect(await repository.get({ ...scope, accountId: 'other' }, 'same', 1_001)).toBeNull();
      await expect(repository.save({ ...scope, groupId: 'different-record' }, input('same'), policy, 1_001)).rejects.toThrow('capacity');
      expect(await repository.get(scope, 'same', 1_001)).not.toBeNull();
      expect(await repository.delete({ ...scope, externalId: 'openid-b' }, 'same')).toBe(true);
      expect(await repository.get(scope, 'same', 1_001)).not.toBeNull();
    } finally { database.close(); }
  });

  it('limits active entries and refreshes expiry on edits without duplicating names', async () => {
    const { database, repository } = await fixture();
    try {
      const first = await repository.save(scope, { ...input('one', 'pending'), description: 'initial description' }, policy, 1000);
      await repository.save(scope, input('two'), policy, 1000);
      await expect(repository.save(scope, input('three'), policy, 1000)).rejects.toThrow('capacity');
      const approved = await repository.update(scope, 'one', { status: 'confirmed', content: 'approved', description: 'updated description' }, policy, 2000);
      expect(approved).toMatchObject({ id: first.id, status: 'confirmed', content: 'approved', description: 'updated description', createdAt: 1000, updatedAt: 2000, expiresAt: 2000 + 7 * 86_400_000 });
      expect(await repository.list(scope, 2001)).toHaveLength(2);
      expect(await repository.get(scope, 'one', 2000 + 7 * 86_400_000)).toBeNull();
      expect(await repository.list(scope, 2000 + 7 * 86_400_000)).toEqual([]);
      const fresh = await repository.save(scope, input('one'), policy, 2000 + 7 * 86_400_000 + 1);
      expect(fresh).toMatchObject({ createdAt: 2000 + 7 * 86_400_000 + 1 });
      expect(fresh.id).not.toBe(first.id);
      expect(await repository.purgeExpired(2000 + 7 * 86_400_000 + 1)).toBe(1);
      expect(await repository.list(scope, 2000 + 7 * 86_400_000 + 1)).toHaveLength(1);
    } finally { database.close(); }
  });

  it('does not let a review candidate overwrite a confirmed memory, even at capacity', async () => {
    const { database, repository } = await fixture();
    try {
      const single = { ...policy, maxEntries: 1 };
      const confirmed = await repository.save(scope, input('goal'), single, 1_000);
      const candidate = { ...input('goal', 'pending'), content: 'unreviewed replacement' };
      expect(await repository.save(scope, candidate, policy, 1_000)).toEqual(confirmed);
      expect(await repository.save(scope, candidate, single, 1_000)).toEqual(confirmed);
      await expect(repository.save(scope, input('different', 'pending'), single, 1_000)).rejects.toThrow('capacity');
      expect(await repository.get(scope, 'goal', 1_001)).toEqual(confirmed);
      const reopened = await repository.save(scope, { ...input('goal', 'pending'), content: 'new candidate' }, single, confirmed.expiresAt);
      expect(reopened).toMatchObject({ status: 'pending', content: 'new candidate' });
      expect(reopened.id).not.toBe(confirmed.id);
    } finally { database.close(); }
  });

  it('creates new names only if absent, atomically renewing expired names with a new identity', async () => {
    const { database, repository } = await fixture();
    try {
      const first = await repository.createIfMissing(scope, input('goal'), policy, 1_000);
      expect(first).toMatchObject({ content: 'content-goal', status: 'confirmed' });
      expect(await repository.createIfMissing(scope, { ...input('goal'), content: 'stale write' }, policy, 1_000)).toBeNull();
      expect(await repository.get(scope, 'goal', 1_000)).toEqual(first);
      expect(await repository.createIfMissing(scope, input('second'), policy, 1_000)).not.toBeNull();
      expect(await repository.createIfMissing(scope, input('third'), policy, 1_000)).toBeNull();
      const recreated = await repository.createIfMissing(scope, { ...input('goal', 'pending'), content: 'renewed fact' }, policy, first!.expiresAt);
      expect(recreated).toMatchObject({ status: 'pending', content: 'renewed fact', createdAt: first!.expiresAt });
      expect(recreated!.id).not.toBe(first!.id);
      expect(await repository.createIfMissing(scope, input('goal'), policy, first!.expiresAt)).toBeNull();
      expect(await repository.get(scope, 'goal', first!.expiresAt)).toEqual(recreated);
      expect(await repository.createIfMissing({ ...scope, groupId: 'different-record' }, input('goal'), policy, recreated!.expiresAt)).toBeNull();
      expect(await repository.get(scope, 'goal', first!.expiresAt)).toEqual(recreated);
      expect(await repository.purgeExpired(first!.expiresAt)).toBe(1);
    } finally { database.close(); }
  });

  it('enforces snapshot CAS on edits and deletes, including same-millisecond replacements', async () => {
    const { database, repository } = await fixture();
    try {
      const candidate = await repository.save(scope, input('goal', 'pending'), policy, 1_000);
      const snapshot = { id: candidate.id, status: candidate.status, content: candidate.content };
      const edited = await repository.updateIfUnchanged(scope, 'goal', { content: 'reviewed text' }, candidate.updatedAt, policy, 1_000, snapshot);
      expect(edited).toMatchObject({ content: 'reviewed text', updatedAt: 1_001 });
      expect(await repository.updateIfUnchanged(scope, 'goal', { status: 'confirmed' }, candidate.updatedAt, policy, 1_000, snapshot)).toBeNull();
      expect(await repository.deleteIfUnchanged(scope, 'goal', candidate.updatedAt, candidate.id, 1_001)).toBe(false);
      const approved = await repository.updateIfUnchanged(scope, 'goal', { status: 'confirmed' }, edited!.updatedAt, policy, 1_001,
        { id: edited!.id, status: 'pending', content: edited!.content });
      expect(approved).toMatchObject({ status: 'confirmed', updatedAt: 1_002 });
      const retitled = await repository.update(scope, 'goal', { title: 'fresh title' }, policy, 1_002);
      expect(retitled).toMatchObject({ title: 'fresh title', updatedAt: 1_003 });
      expect(await repository.updateIfUnchanged(scope, 'goal', { content: 'stale' }, approved!.updatedAt, policy, 1_003,
        { id: approved!.id, status: approved!.status, content: approved!.content })).toBeNull();
      expect(await repository.save(scope, input('goal', 'pending'), policy, 1_002)).toEqual(retitled);
      expect(await repository.deleteIfUnchanged(scope, 'goal', approved!.updatedAt, approved!.id, 1_003)).toBe(false);
      expect(await repository.deleteIfUnchanged(scope, 'goal', retitled!.updatedAt, retitled!.id, 1_003)).toBe(true);
      const replacement = await repository.save(scope, input('goal', 'pending'), policy, 1_003);
      expect(replacement.id).not.toBe(approved!.id);
      expect(await repository.deleteIfUnchanged(scope, 'goal', retitled!.updatedAt, retitled!.id, 1_003)).toBe(false);
      expect(await repository.get(scope, 'goal', 1_003)).toMatchObject({ id: replacement.id, status: 'pending' });
    } finally { database.close(); }
  });

  it('rejects malformed scopes and refuses to fake persistence without D1', async () => {
    expect(() => createConversationMemoryRepository({ KV: { get: async () => null, put: async () => {}, delete: async () => {} } })).toThrow('Persistent storage');
    const { database, repository } = await fixture();
    try {
      await expect(repository.save({ ...scope, externalId: '' }, input('x'), policy, 1000)).rejects.toThrow('scope');
      await expect(repository.save(scope, { ...input('x'), content: '' }, policy, 1000)).rejects.toThrow('memory');
      for (const invalid of [{ ...input('中文') }, { ...input('x'), title: 'a'.repeat(121) },
        { ...input('x'), description: 'a'.repeat(501) }, { ...input('x'), content: 'a'.repeat(20_001) }]) {
        await expect(repository.save(scope, invalid, policy, 1000)).rejects.toThrow('memory');
      }
      await expect(repository.save(scope, input('x'), { maxEntries: 0, retentionDays: 7 }, 1000)).rejects.toThrow('policy');
      await expect(repository.list(scope, -1)).rejects.toThrow('timestamp');
    } finally { database.close(); }
  });
});
