import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { BUILTIN_CHAT_TOOL_NAMES } from '../../shared/plugin-catalog';
import { MODEL_PRICE_PRESETS } from '../../shared/model-pricing';
import { createApiRouter } from './index';

const sqliteModule = await import('node:sqlite').catch(() => null);
const DatabaseSyncConstructor = sqliteModule?.DatabaseSync;

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
          statement.run(...values);
          return { success: true };
        },
      };
    },
  };
}

describe('online setup routes', () => {
  it('reports a missing D1 binding without failing the page', async () => {
    const response = await createApiRouter().request('/setup/status', {}, {} as RuntimeBindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        databaseConfigured: false,
        schemaReady: false,
        missing: ['DB binding'],
        pendingMigrations: 0,
      },
    });
  });

  it.skipIf(!DatabaseSyncConstructor)('requires SYS_SECRET and initializes D1 idempotently', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      const bindings = {
        DB: d1Adapter(database),
        SYS_SECRET: 'setup-token',
      } as RuntimeBindings;
      const router = createApiRouter();

      const before = await router.request('/setup/status', {}, bindings);
      expect((await before.json() as { data: { schemaReady: boolean } }).data.schemaReady).toBe(false);

      const missingToken = await router.request('/setup', { method: 'POST' }, bindings);
      expect(missingToken.status).toBe(401);

      const wrongToken = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      }, bindings);
      expect(wrongToken.status).toBe(401);

      const initialized = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer setup-token' },
      }, bindings);
      expect(initialized.status).toBe(200);
      expect(await initialized.json()).toMatchObject({
        data: { databaseConfigured: true, schemaReady: true, pendingMigrations: 0 },
      });
      const columns = database.prepare('PRAGMA table_info(chatbot_conversation_memories)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual([
        'id', 'account_id', 'group_id', 'conversation_type', 'group_external_id',
        'name', 'title', 'description', 'type', 'content', 'status', 'created_at', 'updated_at', 'expires_at',
      ]);
      const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chatbot_conversation_memories'").all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
        'chatbot_conversation_memories_by_scope_time', 'chatbot_conversation_memories_by_expiry',
      ]));
      const insertMemory = database.prepare(`INSERT INTO chatbot_conversation_memories
        (id, account_id, group_id, conversation_type, group_external_id, name,
         title, type, content, status, created_at, updated_at, expires_at)
        VALUES (?, 'account-1', ?, ?, ?, 'greeting', 'Greeting', 'user', 'hello', ?, 1, 1, 2)`);
      insertMemory.run('memory-a', 'record-1', 'group', 'qq-group-a', 'confirmed');
      expect(database.prepare('SELECT description FROM chatbot_conversation_memories WHERE id = ?').get('memory-a')).toMatchObject({ description: '' });
      insertMemory.run('memory-b', 'record-1', 'group', 'qq-group-b', 'pending');
      insertMemory.run('memory-private', 'record-1', 'private', 'qq-group-a', 'confirmed');
      expect(() => insertMemory.run('memory-c', 'another-record', 'group', 'qq-group-a', 'confirmed')).toThrow();
      expect(() => insertMemory.run('invalid-status', 'record-1', 'group', 'qq-group-c', 'candidate')).toThrow();

      const rowsAfterFirstSetup = database.prepare('SELECT kind, id, value, updated_at FROM records ORDER BY kind, id').all();
      const seeded = rowsAfterFirstSetup.map((row) => row as { kind: string; id: string; value: string });
      const policies = seeded.filter((row) => row.kind === 'policies').map((row) => JSON.parse(row.value) as Record<string, unknown>);
      expect(policies.map((policy) => policy.type).sort()).toEqual(['cost', 'dialog', 'identity', 'memory', 'voice']);
      expect(policies.find((policy) => policy.type === 'identity')).toMatchObject({
        providerId: '', model: '', systemPrompt: '', skillIds: [], mcpIds: [], ruleIds: [], toolIds: [],
      });
      expect(policies.find((policy) => policy.type === 'voice')).toMatchObject({ config: { voice_model: '' } });
      expect(policies.find((policy) => policy.type === 'memory')).toMatchObject({ config: { memory_enabled: true, maxEntries: 100, retentionDays: 7, memoryMode: 'manual' } });
      expect(policies.find((policy) => policy.type === 'cost')).toMatchObject({ config: { dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0 } });
      const prices = seeded.filter((row) => row.kind === 'prices').map((row) => JSON.parse(row.value) as Record<string, unknown>);
      expect(MODEL_PRICE_PRESETS).toHaveLength(56); // Preserve the existing 52 text/speech snapshots and add four image models.
      expect(prices).toHaveLength(MODEL_PRICE_PRESETS.length);
      expect(prices.every((price) => typeof price.sourceUrl === 'string' && typeof price.updatedAt === 'string')).toBe(true);
      expect(prices.filter((price) => price.imageOutputCostPerMillion !== undefined).map((price) => price.model).sort()).toEqual([
        'gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
      ]);
      const flare = prices.find((price) => price.model === 'gpt-image-2.5-flare');
      expect(flare).toMatchObject({
        inputCostPerMillion: 5, outputCostPerMillion: 30, cacheInputCostPerMillion: 1.25, updatedAt: '2026-11-13',
        imageInputCostPerMillion: 8, imageCachedInputCostPerMillion: 2, imageOutputCostPerMillion: 30,
      });
      expect(prices.find((price) => price.model === 'gpt-image-2.5')).toMatchObject({
        inputCostPerMillion: flare!.inputCostPerMillion,
        cacheInputCostPerMillion: flare!.cacheInputCostPerMillion,
        imageInputCostPerMillion: flare!.imageInputCostPerMillion,
        imageCachedInputCostPerMillion: flare!.imageCachedInputCostPerMillion,
        imageOutputCostPerMillion: flare!.imageOutputCostPerMillion,
      });
      const tools = seeded.filter((row) => row.kind === 'tools').map((row) => JSON.parse(row.value) as { id: string; enabled: boolean; config: Record<string, unknown> });
      expect(tools).toHaveLength(BUILTIN_CHAT_TOOL_NAMES.length);
      expect(tools.map((tool) => tool.id).sort()).toEqual(BUILTIN_CHAT_TOOL_NAMES.map((name) => `builtin-${name.replaceAll('_', '-')}`).sort());
      expect(tools.filter((tool) => !tool.enabled)).toMatchObject([
        { id: 'builtin-chat-generate-image', config: { kind: 'builtin', name: 'chat_generate_image', providerId: '', model: '', fallbackCostPerImage: 0 } },
      ]);
      expect(tools.filter((tool) => tool.enabled).every((tool) => Object.keys(tool.config).sort().join(',') === 'kind,name')).toBe(true);

      const status = await router.request('/setup/status', {}, bindings);
      expect(status.status).toBe(200);
      expect(database.prepare('SELECT kind, id, value, updated_at FROM records ORDER BY kind, id').all()).toEqual(rowsAfterFirstSetup);

      const repeated = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer setup-token' },
      }, bindings);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({ data: { schemaReady: true } });
      expect(database.prepare('SELECT kind, id, value, updated_at FROM records ORDER BY kind, id').all()).toEqual(rowsAfterFirstSetup);
    } finally {
      database.close();
    }
  });

  it.skipIf(!DatabaseSyncConstructor)('fills missing defaults without replacing custom policies, tools or prices', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      const bindings = { DB: d1Adapter(database), SYS_SECRET: 'setup-token' } as RuntimeBindings;
      const router = createApiRouter();
      const request = () => router.request('/setup', { method: 'POST', headers: { Authorization: 'Bearer setup-token' } }, bindings);
      expect((await request()).status).toBe(200);
      const rows = database.prepare('SELECT kind, id, value FROM records').all() as Array<{ kind: string; id: string; value: string }>;
      const identity = rows.find((row) => row.kind === 'policies' && JSON.parse(row.value).type === 'identity')!;
      const originalPrice = rows.find((row) => row.kind === 'prices')!;
      const imageTool = rows.find((row) => row.kind === 'tools' && row.id === 'builtin-chat-generate-image')!;
      const nativeTool = rows.find((row) => row.kind === 'tools' && row.id === 'builtin-chat-tts')!;
      const missingNativeTool = rows.find((row) => row.kind === 'tools' && row.id === 'builtin-chat-time')!;
      const editedIdentity = { ...JSON.parse(identity.value), name: 'Customized identity', systemPrompt: 'Do not replace' };
      const editedTool = { ...JSON.parse(imageTool.value), name: 'Customized image tool' };
      const disabledNativeTool = { ...JSON.parse(nativeTool.value), enabled: false };
      database.prepare('UPDATE records SET value = ? WHERE kind = ? AND id = ?').run(JSON.stringify(editedIdentity), identity.kind, identity.id);
      database.prepare('UPDATE records SET value = ? WHERE kind = ? AND id = ?').run(JSON.stringify(editedTool), imageTool.kind, imageTool.id);
      database.prepare('UPDATE records SET value = ? WHERE kind = ? AND id = ?').run(JSON.stringify(disabledNativeTool), nativeTool.kind, nativeTool.id);
      database.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(missingNativeTool.kind, missingNativeTool.id);
      const customPrice = { ...JSON.parse(originalPrice.value), id: 'custom-price', name: 'My relay price', inputCostPerMillion: 999 };
      database.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(originalPrice.kind, originalPrice.id);
      database.prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?)')
        .run('prices', customPrice.id, JSON.stringify(customPrice), customPrice.updatedAt);
      const missingPolicy = rows.find((row) => row.kind === 'policies' && JSON.parse(row.value).type === 'dialog')!;
      database.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(missingPolicy.kind, missingPolicy.id);

      expect((await request()).status).toBe(200);
      const after = database.prepare('SELECT kind, id, value FROM records').all() as Array<{ kind: string; id: string; value: string }>;
      expect(after.find((row) => row.kind === 'policies' && row.id === identity.id)?.value).toBe(JSON.stringify(editedIdentity));
      expect(after.find((row) => row.kind === 'policies' && row.id === missingPolicy.id)).toBeDefined();
      expect(after.find((row) => row.kind === 'tools' && row.id === imageTool.id)?.value).toBe(JSON.stringify(editedTool));
      expect(after.find((row) => row.kind === 'tools' && row.id === nativeTool.id)?.value).toBe(JSON.stringify(disabledNativeTool));
      expect(after.find((row) => row.kind === 'tools' && row.id === missingNativeTool.id)).toBeDefined();
      expect(after.filter((row) => row.kind === 'tools')).toHaveLength(BUILTIN_CHAT_TOOL_NAMES.length);
      expect(after.find((row) => row.kind === 'prices' && row.id === customPrice.id)?.value).toBe(JSON.stringify(customPrice));
      expect(after.some((row) => row.kind === 'prices' && row.id === originalPrice.id)).toBe(false);
      expect(after.filter((row) => row.kind === 'prices')).toHaveLength(MODEL_PRICE_PRESETS.length);
    } finally {
      database.close();
    }
  });

  it.skipIf(!DatabaseSyncConstructor)('detects incomplete conversation memory schemas on read-only status', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      database.exec('CREATE TABLE chatbot_conversation_memories (id TEXT PRIMARY KEY)');
      const response = await createApiRouter().request('/setup/status', {}, { DB: d1Adapter(database) } as RuntimeBindings);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: {
        schemaReady: false,
        missing: expect.arrayContaining(['chatbot_conversation_memories.group_external_id', 'chatbot_conversation_memories.expires_at']),
      } });
    } finally {
      database.close();
    }
  });

  it('explicitly fills missing defaults on KV without requiring D1 or changing saved prices', async () => {
    const values = new Map<string, string>();
    const KV: KVNamespaceLike = {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); },
      async list({ prefix = '' } = {}) {
        return { keys: [...values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    };
    const bindings = { KV, SYS_SECRET: 'setup-token' } as RuntimeBindings;
    const router = createApiRouter();
    const request = (token = 'setup-token') => router.request('/setup/defaults', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }, bindings);
    expect((await request('wrong-token')).status).toBe(401);
    expect(values.size).toBe(0);
    expect((await request()).status).toBe(200);
    expect(values.size).toBe(MODEL_PRICE_PRESETS.length + 5 + BUILTIN_CHAT_TOOL_NAMES.length);
    const custom = { ...MODEL_PRICE_PRESETS[0], inputCostPerMillion: 123 };
    values.set(`nonebotmaker:records:prices:${custom.id}`, JSON.stringify(custom));
    const previous = new Map(values);
    expect((await request()).status).toBe(200);
    expect(values).toEqual(previous);
    expect(JSON.parse(values.get(`nonebotmaker:records:prices:${custom.id}`)!)).toMatchObject({ inputCostPerMillion: 123 });
  });

  it('supports explicit defaults for EdgeOne Blob storage', async () => {
    const values = new Map<string, string>();
    const EDGEONE_BLOB = {
      async get(key: string) { return values.get(key) ?? null; },
      async put(key: string, value: string) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
      async list({ prefix }: { prefix: string }) {
        return { objects: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
      },
    };
    const bindings = { PLATFORM: 'edgeone', EDGEONE_BLOB, SYS_SECRET: 'setup-token' } as RuntimeBindings;
    const request = () => createApiRouter().request('/setup/defaults', {
      method: 'POST', headers: { Authorization: 'Bearer setup-token' },
    }, bindings);
    expect((await request()).status).toBe(200);
    expect(values.size).toBe(MODEL_PRICE_PRESETS.length + 5 + BUILTIN_CHAT_TOOL_NAMES.length);
    expect(JSON.parse(values.get('nonebotmaker/records/policies/default-memory')!)).toMatchObject({
      type: 'memory', config: { maxEntries: 100, retentionDays: 7, memoryMode: 'manual' },
    });
    const previous = new Map(values);
    expect((await request()).status).toBe(200);
    expect(values).toEqual(previous);
  });

  it('fails closed when no setup token is configured', async () => {
    const router = createApiRouter();
    const response = await router.request('/setup', { method: 'POST' }, {} as RuntimeBindings);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'setup_unavailable' });
    expect((await router.request('/setup/defaults', { method: 'POST' }, {} as RuntimeBindings)).status).toBe(503);
    const noStorage = await router.request('/setup/defaults', {
      method: 'POST', headers: { Authorization: 'Bearer setup-token' },
    }, { SYS_SECRET: 'setup-token' } as RuntimeBindings);
    expect(noStorage.status).toBe(503);
    expect(await noStorage.json()).toEqual({ error: 'storage_unavailable' });
  });
});
