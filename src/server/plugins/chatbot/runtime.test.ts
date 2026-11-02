import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { D1DatabaseLike, D1StatementLike, GroupRecord, KVNamespaceLike, RuntimeBindings } from '../../../shared/types';
import { createPersistentChatbotStores } from './runtime';

const sqliteModule = await import('node:sqlite').catch(() => null);
const DatabaseSyncConstructor = sqliteModule?.DatabaseSync;

const group = (overrides: Partial<GroupRecord> = {}): GroupRecord => ({
  id: 'group-1',
  accountId: 'account-1',
  externalId: 'external-group-1',
  name: 'Test group',
  enabled: true,
  providerId: 'provider-1',
  model: 'test-model',
  systemPrompt: '',
  reasoningEffort: 'medium',
  nonMentionReplyRate: 0.05,
  whitelistEnabled: false,
  whitelistUserIds: [],
  inputCostPerMillion: 1,
  outputCostPerMillion: 1,
  dailyCostLimit: 0,
  monthlyCostLimit: 0,
  totalCostLimit: 0,
  skillIds: [],
  mcpIds: [],
  ruleIds: [],
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

function memoryKV() {
  const values = new Map<string, string>();
  const kv: KVNamespaceLike = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  };
  return { kv, values };
}

function d1Adapter(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1StatementLike {
      const statement = database.prepare(query);
      let values: SQLInputValue[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound as SQLInputValue[];
          return this;
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

describe('persistent chatbot cost accounting', () => {
  it.each(['dailyCostLimit', 'monthlyCostLimit', 'totalCostLimit'] as const)(
    'persists spend and denies calls at the %s limit',
    async (field) => {
      const { kv } = memoryKV();
      const { costStore } = createPersistentChatbotStores({ PLATFORM: 'esa', ESA_KV: kv });
      const at = Date.parse('2026-06-18T12:00:00.000Z');
      const limitedGroup = group({ [field]: 0.25 });

      await expect(costStore.isWithinLimits(limitedGroup, at)).resolves.toBe(true);
      await costStore.add(limitedGroup, 0.25, at);
      await expect(costStore.isWithinLimits(limitedGroup, at)).resolves.toBe(false);
      expect(costStore.consistency).toBe('eventual');
    },
  );

  it('resets daily and monthly spend at UTC boundaries but preserves total spend', async () => {
    const { kv } = memoryKV();
    const { costStore } = createPersistentChatbotStores({ PLATFORM: 'edgeone', EDGEONE_KV: kv });
    const limits = group({ dailyCostLimit: 1, monthlyCostLimit: 1 });
    const beforeMidnight = Date.parse('2026-01-15T23:59:59.999Z');
    const afterMidnight = Date.parse('2026-01-16T00:00:00.000Z');
    const afterMonthBoundary = Date.parse('2026-02-01T00:00:00.000Z');

    await costStore.add(limits, 0.75, beforeMidnight);
    await expect(costStore.isWithinLimits(limits, beforeMidnight)).resolves.toBe(true);
    await expect(costStore.isWithinLimits(limits, afterMidnight)).resolves.toBe(true);
    await costStore.add(limits, 0.3, afterMidnight);
    await expect(costStore.isWithinLimits(limits, afterMidnight)).resolves.toBe(false);
    await expect(costStore.isWithinLimits(limits, afterMonthBoundary)).resolves.toBe(true);
  });

  it('keeps total spend across UTC day and month resets', async () => {
    const { kv } = memoryKV();
    const { costStore } = createPersistentChatbotStores({ PLATFORM: 'esa', ESA_KV: kv });
    const limits = group({ totalCostLimit: 1.25 });
    const beforeMonthBoundary = Date.parse('2026-01-31T23:59:59.999Z');
    const afterMonthBoundary = Date.parse('2026-02-01T00:00:00.000Z');
    const nextMonthBoundary = Date.parse('2026-03-01T00:00:00.000Z');

    await costStore.add(limits, 0.75, beforeMonthBoundary);
    await expect(costStore.isWithinLimits(limits, afterMonthBoundary)).resolves.toBe(true);
    await costStore.add(limits, 0.5, afterMonthBoundary);
    await expect(costStore.isWithinLimits(limits, nextMonthBoundary)).resolves.toBe(false);
  });

  it('uses EdgeOne BLOB without requiring a KV binding', async () => {
    const values = new Map<string, string>();
    const blob: NonNullable<RuntimeBindings['EDGEONE_BLOB']> = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      delete: vi.fn(async (key: string) => { values.delete(key); }),
      list: vi.fn(async () => ({ objects: [] })),
    };
    const stores = createPersistentChatbotStores({ PLATFORM: 'edgeone', EDGEONE_BLOB: blob });
    const target = group({ totalCostLimit: 0.1 });
    const at = Date.parse('2026-03-01T00:00:00.000Z');

    await stores.costStore.add(target, 0.1, at);
    await expect(stores.costStore.isWithinLimits(target, at)).resolves.toBe(false);
    expect(stores.costStore.consistency).toBe('provider-defined');
  });

  it('uses the D1 store and reports atomic cost upserts', async () => {
    const queries: string[] = [];
    const statement = {
      bind: vi.fn(),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true })),
    };
    statement.bind.mockImplementation(() => statement);
    const db = { prepare: vi.fn((query: string) => { queries.push(query); return statement; }) };
    const stores = createPersistentChatbotStores({ DB: db as unknown as RuntimeBindings['DB'] });
    const target = group({ monthlyCostLimit: 2 });
    const at = Date.parse('2026-04-01T00:00:00.000Z');

    await expect(stores.costStore.isWithinLimits(target, at)).resolves.toBe(true);
    await stores.costStore.add(target, 0.5, at);

    expect(stores.costStore.consistency).toBe('atomic-upsert');
    expect(queries[1]).toContain('ON CONFLICT(group_id) DO UPDATE');
  });

  it.skipIf(!DatabaseSyncConstructor)('runs D1 context and cost stores against the complete migration schema', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      for (const migration of [
        '0001_initial.sql',
        '0002_conversation_group_external_id.sql',
        '0003_chatbot_runtime_state.sql',
      ]) {
        database.exec(readFileSync(new URL(`../../../../migrations/${migration}`, import.meta.url), 'utf8'));
      }

      const stores = createPersistentChatbotStores({ DB: d1Adapter(database) });
      const target = group({ dailyCostLimit: 0.25, monthlyCostLimit: 0.5, totalCostLimit: 0.75 });
      const beforeMidnight = Date.parse('2026-01-15T23:59:59.999Z');
      const afterMidnight = Date.parse('2026-01-16T00:00:00.000Z');
      const nextMonth = Date.parse('2026-02-01T00:00:00.000Z');

      await stores.conversationStore.append(target.id, [{ role: 'user', content: 'persisted context' }]);
      await expect(stores.conversationStore.getRecent(target.id, 20)).resolves.toEqual([
        { role: 'user', content: 'persisted context' },
      ]);
      await stores.costStore.add(target, 0.25, beforeMidnight);
      await expect(stores.costStore.isWithinLimits(target, beforeMidnight)).resolves.toBe(false);
      await expect(stores.costStore.isWithinLimits(target, afterMidnight)).resolves.toBe(true);
      await stores.costStore.add(target, 0.25, afterMidnight);
      await expect(stores.costStore.isWithinLimits(target, afterMidnight)).resolves.toBe(false);
      await expect(stores.costStore.isWithinLimits(target, nextMonth)).resolves.toBe(true);
      await stores.costStore.add(target, 0.25, nextMonth);
      await expect(stores.costStore.isWithinLimits(target, nextMonth)).resolves.toBe(false);
    } finally {
      database.close();
    }
  });

  it('fails clearly when the selected platform has no persistent state binding', () => {
    expect(() => createPersistentChatbotStores({ PLATFORM: 'esa' })).toThrow(
      'Persistent chatbot state storage is not configured for esa',
    );
  });
});
