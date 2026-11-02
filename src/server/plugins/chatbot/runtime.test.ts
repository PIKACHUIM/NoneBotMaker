import { readFileSync } from 'node:fs';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { D1DatabaseLike, D1StatementLike, GroupRecord, KVNamespaceLike, RuntimeBindings } from '../../../shared/types';
import { createPersistentChatbotStores, createStoredChatbotHandler } from './runtime';
import { createRepository } from '../../storage/repository';
import { encryptSecrets } from '../../storage/secrets';
import { sendQQMedia } from '../../protocols/qq/api';

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

  it.skipIf(!DatabaseSyncConstructor)('atomically claims each approval once across recreated D1 stores and preserves scope isolation', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      database.exec(readFileSync(new URL('../../../../migrations/0001_initial.sql', import.meta.url), 'utf8'));
      const bindings = { DB: d1Adapter(database) };
      const first = createPersistentChatbotStores(bindings).conversationStore;
      const second = createPersistentChatbotStores(bindings).conversationStore;
      const results = await Promise.all([first.claimApproval!('scope-1', 'approval'), second.claimApproval!('scope-1', 'approval')]);
      expect(results.filter(Boolean)).toHaveLength(1);
      await expect(createPersistentChatbotStores(bindings).conversationStore.claimApproval!('scope-1', 'approval')).resolves.toBe(false);
      await expect(second.claimApproval!('scope-2', 'approval')).resolves.toBe(true);
      expect(database.prepare("SELECT COUNT(*) AS count FROM records WHERE kind = 'chatbot-approval-claims-v1'").get()).toMatchObject({ count: 2 });
    } finally { database.close(); }
  });

  it('does not advertise atomic approval claims for eventual KV stores', () => {
    const { kv } = memoryKV();
    expect(createPersistentChatbotStores({ KV: kv }).conversationStore.claimApproval).toBeUndefined();
  });

  it('persists complete tool turns, supports replacement/reset and isolates memory state', async () => {
    const { kv } = memoryKV();
    const { conversationStore } = createPersistentChatbotStores({ KV: kv });
    const key = JSON.stringify(['account-1', 'group', 'room']);
    const other = JSON.stringify(['account-2', 'group', 'room']);
    const entries = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: '', tool_calls: [{ id: 'call', type: 'function' as const, function: { name: 'chat_time', arguments: '{}' } }] },
      { role: 'tool' as const, content: 'time', tool_call_id: 'call' },
      { role: 'assistant' as const, content: 'done' },
    ];
    await conversationStore.append(key, entries);
    await expect(conversationStore.getRecent(key, 2)).resolves.toEqual(entries);
    await expect(conversationStore.getRecent(other, 100)).resolves.toEqual([]);
    await conversationStore.setState!(key, { memory: 'durable', role: 'short', mode: 'reserved2' });
    const recreated = createPersistentChatbotStores({ KV: kv }).conversationStore;
    await expect(recreated.getState!(key)).resolves.toMatchObject({ memory: 'durable', role: 'short' });
    await expect(recreated.getState!(other)).resolves.toEqual({});
    await recreated.replace!(key, [{ role: 'assistant', content: 'summary' }]);
    await expect(recreated.getRecent(key, 100)).resolves.toEqual([{ role: 'assistant', content: 'summary' }]);
    await recreated.clear!(key);
    await expect(recreated.getRecent(key, 100)).resolves.toEqual([]);
    await expect(recreated.getState!(key)).resolves.toMatchObject({ memory: 'durable' });
  });

  it('decrypts legacy encrypted group numeric config before provider request normalization', async () => {
    const { kv, values } = memoryKV();
    kv.list = vi.fn(async (options) => ({ keys: [...values.keys()].filter((key) => key.startsWith(options?.prefix ?? '')).map((name) => ({ name })), list_complete: true }));
    const bindings: RuntimeBindings = { KV: kv, SYS_SECRET: 'test-sys-secret' };
    const records = createRepository(bindings);
    const legacy = await encryptSecrets({ token: 123 }, undefined, bindings);
    await records.put('groups', { ...group(), config: { agent_max_output_tokens: legacy.token } });
    await records.put('providers', await encryptSecrets({ id: 'provider-1', name: 'provider', baseUrl: 'https://provider.example/v1', apiKey: 'provider-key', enabled: true, models: ['test-model'], createdAt: '', updatedAt: '' }, undefined, bindings));
    const requests: any[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('dns-query')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: 'done' } }] });
    });
    const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), sendReply: vi.fn(async () => undefined), fetch: fetchImpl });
    const account = { appId: 'app', appSecret: 'app-secret', pluginEnabled: true, account: { id: 'account-1', pluginId: 'plugin-1', name: 'bot', protocol: 'qq', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' } };
    await handler(account, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'message', accountId: 'account-1', botId: 'app', groupId: 'external-group-1', userId: 'user', text: 'hello', mentionsBot: true, receivedAt: Date.now() });
    expect(requests[0].max_completion_tokens).toBe(123);
  });

  it('runs StoredHandler through real speech generation and QQ media upload/send with character billing', async () => {
    const { kv, values } = memoryKV();
    kv.list = vi.fn(async (options) => ({ keys: [...values.keys()].filter((key) => key.startsWith(options?.prefix ?? '')).map((name) => ({ name })), list_complete: true }));
    const bindings: RuntimeBindings = { KV: kv, SYS_SECRET: 'test-sys-secret' };
    const records = createRepository(bindings);
    await records.put('groups', { ...group(), config: { voice_model: 'tts-1' } });
    await records.put('providers', await encryptSecrets({ id: 'provider-1', name: 'provider', baseUrl: 'https://provider.example/v1', apiKey: 'speech-provider-key', enabled: true, models: ['test-model'], mediaCapabilities: ['speech'], priceMultiplier: 2, createdAt: '', updatedAt: '' }, undefined, bindings));
    for (const [model, unit, inputPrice] of [['test-model', 'tokens', 1], ['tts-1', 'characters', 15]] as const) await records.put('prices', { id: unit, name: model, model, unit, enabled: true, currency: 'USD', inputCostPerMillion: inputPrice, outputCostPerMillion: 0, createdAt: '', updatedAt: '' });
    const requests: Array<{ url: string; body: any }> = [];
    let modelRound = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('dns-query')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(url), body });
      if (String(url).endsWith('/audio/speech')) return new Response(new Uint8Array([0x49, 0x44, 0x33, 0]), { headers: { 'content-type': 'audio/mpeg' } });
      if (String(url).endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'qq-media-token', expires_in: 7200 });
      if (String(url).endsWith('/files')) return Response.json({ file_info: 'uploaded-speech-file' });
      if (String(url).endsWith('/messages')) return Response.json({ id: 'qq-sent-id' });
      return Response.json({ choices: [{ message: ++modelRound === 1 ? { content: '', tool_calls: [{ id: 'speech', type: 'function', function: { name: 'chat_tts', arguments: '{"text":"hello"}' } }] } : { content: 'do not duplicate media' } }], usage: { prompt_tokens: 10, completion_tokens: 0 } });
    });
    const stores = createPersistentChatbotStores(bindings);
    const handler = createStoredChatbotHandler(bindings, { ...stores, fetch: fetchImpl, sendReply: vi.fn(async () => { throw new Error('Unexpected final text send'); }), sendMedia: (account, targetId, id, media, options) => sendQQMedia(account, targetId, id, media, options, fetchImpl) });
    const account = { appId: 'tts-runtime-app', appSecret: 'tts-runtime-secret', pluginEnabled: true, account: { id: 'account-1', pluginId: 'plugin-1', name: 'bot', protocol: 'qq', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' } };
    await handler(account, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'message', accountId: 'account-1', botId: account.appId, groupId: 'external-group-1', userId: 'user', text: '请用语音回复', mentionsBot: true, receivedAt: Date.now() });
    const upload = requests.find(({ url }) => url.endsWith('/files'))!;
    expect(upload.body).toMatchObject({ file_type: 3, srv_send_msg: false, file_data: 'SUQzAA==' });
    const sent = requests.find(({ url }) => url.endsWith('/messages'))!;
    expect(sent.body).toMatchObject({ msg_type: 7, msg_id: 'message', msg_seq: 1, media: { file_info: 'uploaded-speech-file' } });
    const costState = JSON.parse([...values.entries()].find(([key]) => key.startsWith('nonebotmaker:chatbot:cost:'))![1]);
    expect(costState.totalSpend).toBeCloseTo(0.00019, 8);
    expect(requests.filter(({ url }) => url.endsWith('/messages'))).toHaveLength(1);
  });

  it('expires context envelopes even when a BLOB provider does not support TTL', async () => {
    const values = new Map<string, string>();
    const blob = { get: async (key: string) => values.get(key) ?? null, put: async (key: string, value: string) => { values.set(key, value); } };
    const { conversationStore } = createPersistentChatbotStores({ PLATFORM: 'edgeone', EDGEONE_BLOB: blob });
    await conversationStore.append('room', [{ role: 'user', content: 'past' }]);
    const [key, value] = [...values.entries()][0];
    const envelope = JSON.parse(value);
    values.set(key, JSON.stringify({ ...envelope, expiresAt: Date.now() - 1 }));
    await expect(conversationStore.getRecent('room', 100)).resolves.toEqual([]);
  });

  it('fails clearly when the selected platform has no persistent state binding', () => {
    expect(() => createPersistentChatbotStores({ PLATFORM: 'esa' })).toThrow(
      'Persistent chatbot state storage is not configured for esa',
    );
  });
});
