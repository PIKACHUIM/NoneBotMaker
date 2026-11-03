import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { JsonObject, KVNamespaceLike, PolicyRecord, RuntimeBindings } from '../../shared/types';
import { defaultFieldValues, effectiveGroupConfig, normalizeFieldValues, pluginDefinition, policyFields, resolveGroupIdentity } from '../../shared/plugin-catalog';
import { findModelPrice, MODEL_PRICE_PRESETS } from '../../shared/model-pricing';
import { decryptSecrets, encryptSecrets } from '../storage/secrets';
import { ApiError, registerManagementRoutes } from './management';

function createApp() {
  const values = new Map<string, string>();
  const KV: KVNamespaceLike = {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
  const app = new Hono<{ Bindings: RuntimeBindings }>();
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
    return context.json({ error: 'internal_error' }, 500);
  });
  registerManagementRoutes(app);
  return { app, values, bindings: { KV, SYS_SECRET: 'test-sys-secret' } as RuntimeBindings };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('declared plugin configuration', () => {
  it('normalizes legacy group fields while preserving unexposed configuration', async () => {
    const { app, bindings } = createApp();
    const response = await app.request('/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Chatbot',
        type: 'elysia-best/plugin-chatbot',
        config: {
          bridge_max_message_chars: '9999',
          bridge_slang_enabled: 'false',
          agent_model: 42,
          bridge_allowed_groups: 'group-a, group-b',
          undeclared: 'ignored',
        },
      }),
    }, bindings);

    expect(response.status).toBe(201);
    expect((await json(response)).data).toMatchObject({
      config: {
        bridge_max_message_chars: 4000,
        bridge_slang_enabled: false,
        agent_model: 42,
        bridge_allowed_groups: 'group-a, group-b',
        undeclared: 'ignored',
      },
    });
  });

  it('requires declared account credential fields and preserves blank edits', async () => {
    const { app, values, bindings } = createApp();
    const pluginResponse = await app.request('/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Chatbot', type: 'elysia-best/plugin-chatbot' }),
    }, bindings);
    const plugin = (await json(pluginResponse)).data as JsonObject;

    const rejected = await app.request('/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pluginId: plugin.id,
        protocol: 'qq',
        name: 'QQ Bot',
        credentials: { appId: '10001' },
      }),
    }, bindings);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'missing_appSecret' });

    const created = await app.request('/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pluginId: plugin.id,
        protocol: 'qq',
        name: 'QQ Bot',
        credentials: { appId: '10001', appSecret: 'app-secret' },
      }),
    }, bindings);
    expect(created.status).toBe(201);
    const account = (await json(created)).data as JsonObject;

    const updated = await app.request(`/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { appId: '10001', appSecret: '' } }),
    }, bindings);
    expect(updated.status).toBe(200);

    const stored = JSON.parse(values.get(`nonebotmaker:records:accounts:${account.id}`) ?? '{}') as JsonObject;
    const decrypted = await decryptSecrets(stored, bindings);
    expect(decrypted.credentials).toEqual({
      appId: '10001',
      appSecret: 'app-secret',
    });
    const fetched = await app.request(`/accounts/${account.id}`, {}, bindings);
    expect((await json(fetched)).data).toMatchObject({ credentials: { appId: '10001', appSecret: '********' } });
    expect(JSON.stringify(await json(await app.request('/accounts', {}, bindings)))).not.toContain('app-secret');
  });
});

function seed(values: Map<string, string>, kind: string, data: JsonObject) {
  values.set(`nonebotmaker:records:${kind}:${data.id}`, JSON.stringify({ createdAt: '', updatedAt: '', ...data }));
}

function configuredApp(pluginConfig: JsonObject = {}) {
  const setup = createApp();
  seed(setup.values, 'plugins', { id: 'plugin-1', type: 'elysia-best/plugin-chatbot', name: 'Chatbot', config: pluginConfig });
  seed(setup.values, 'accounts', {
    id: 'account-1', pluginId: 'plugin-1', protocol: 'qq', name: 'Bot', enabled: true,
    credentials: { appId: '10001', appSecret: 'existing-secret' }, config: {},
  });
  seed(setup.values, 'providers', { id: 'provider-1', name: 'Provider', baseUrl: '', apiKey: '', models: [] });
  return setup;
}

function writeRequest(setup: ReturnType<typeof createApp>, path: string, data: JsonObject, method = 'POST') {
  return setup.app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  }, setup.bindings);
}

const baseGroup = { id: 'group-1', accountId: 'account-1', externalId: 'external-1', providerId: 'provider-1', name: 'Group' };

describe('configuration scopes and defaults', () => {
  it('declares two credentials, no unimplemented plugin settings, and localized group/log fields', () => {
    const definition = pluginDefinition('elysia-best/plugin-chatbot')!;
    expect(definition.credentialFields.map((field) => field.key)).toEqual(['appId', 'appSecret']);
    expect(definition.configFields.map((field) => field.key)).toEqual(['web_search_engine', 'web_search_results', 'brave_api_key']);
    expect(definition.accountFields).toEqual([]);
    expect(definition.groupFields.some((field) => field.key.startsWith('bridge_voice'))).toBe(false);
    expect(defaultFieldValues(definition.groupFields)).toMatchObject({ voice_model: '', voice_id: 'alloy', voice_speed: 1, voice_max_text_chars: 500, voice_max_bytes: 5 * 1024 * 1024, voice_sends_per_hour: 20 });
    for (const field of [...definition.groupFields, ...definition.logFields!]) {
      expect(field.label.zh).toBeTruthy();
      expect(field.label.en).toBeTruthy();
    }
  });

  it('uses declared defaults for missing, blank, and null numbers and only inherits group keys', () => {
    const definition = pluginDefinition('elysia-best/plugin-chatbot')!;
    expect(normalizeFieldValues(definition.groupFields, {})).toEqual(defaultFieldValues(definition.groupFields));
    const config = effectiveGroupConfig({ bridge_max_message_chars: 900, brave_api_key: 'secret', agent_model: 'old-model' }, {
      agent_max_rounds: '', agent_temperature: null, bridge_max_message_chars: 200,
    });
    expect(config).toMatchObject({ bridge_max_message_chars: 200, agent_max_rounds: 5, agent_temperature: 0.7, context_history_limit: 50, memory_enabled: false });
    expect(config).not.toHaveProperty('brave_api_key');
    expect(config).not.toHaveProperty('agent_model');
  });

  it('stores and returns output token budgets as numbers rather than secrets', async () => {
    const setup = configuredApp();
    const created = await writeRequest(setup, '/groups', { ...baseGroup, config: { agent_max_output_tokens: 8192 } });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ config: { agent_max_output_tokens: 8192 } });
    const stored = JSON.parse(setup.values.get('nonebotmaker:records:groups:group-1')!) as JsonObject;
    expect(stored.config).toMatchObject({ agent_max_output_tokens: 8192 });
    const fetched = await setup.app.request('/groups/group-1', {}, setup.bindings);
    expect((await json(fetched)).data).toMatchObject({ config: { agent_max_output_tokens: 8192 } });
    const saved = await writeRequest(setup, '/groups/group-1', { name: 'Renamed' }, 'PATCH');
    expect((await json(saved)).data).toMatchObject({ config: { agent_max_output_tokens: 8192 } });
  });

  it('recovers formerly encrypted token counts without decrypting other visible plugin secrets', async () => {
    const setup = configuredApp();
    const oldCount = (await encryptSecrets({ token: 8192 }, undefined, setup.bindings)).token;
    const pluginSecrets = await encryptSecrets({ brave_api_key: 'private-brave-key' }, undefined, setup.bindings);
    seed(setup.values, 'plugins', { id: 'plugin-1', type: 'elysia-best/plugin-chatbot', name: 'Plugin', config: { ...pluginSecrets, agent_max_output_tokens: oldCount } });
    seed(setup.values, 'groups', { ...baseGroup, config: { agent_max_output_tokens: oldCount } });
    const before = setup.values.get('nonebotmaker:records:groups:group-1');
    const fetched = await setup.app.request('/groups/group-1', {}, setup.bindings);
    expect((await json(fetched)).data).toMatchObject({ config: { agent_max_output_tokens: 8192 } });
    expect(setup.values.get('nonebotmaker:records:groups:group-1')).toBe(before);
    const plugin = (await json(await setup.app.request('/plugins/plugin-1', {}, setup.bindings))).data as JsonObject;
    expect(plugin.config).toMatchObject({ agent_max_output_tokens: 8192, brave_api_key: '********' });
    const inherited = await writeRequest(setup, '/groups', { ...baseGroup, id: 'group-2', externalId: 'external-2' });
    expect((await json(inherited)).data).toMatchObject({ config: { agent_max_output_tokens: 8192 } });
    expect((await writeRequest(setup, '/groups/group-1', { name: 'Renamed' }, 'PATCH')).status).toBe(200);
    expect((JSON.parse(setup.values.get('nonebotmaker:records:groups:group-1')!) as JsonObject).config).toMatchObject({ agent_max_output_tokens: 8192 });
    expect((await writeRequest(setup, '/plugins/plugin-1', { name: 'Renamed plugin' }, 'PATCH')).status).toBe(200);
    const storedPlugin = JSON.parse(setup.values.get('nonebotmaker:records:plugins:plugin-1')!) as JsonObject;
    expect(storedPlugin.config).toMatchObject({ agent_max_output_tokens: 8192 });
    expect(JSON.stringify(storedPlugin)).not.toContain('private-brave-key');
    expect((await decryptSecrets(storedPlugin, setup.bindings)).config).toMatchObject({ brave_api_key: 'private-brave-key' });
  });

  it('preserves legacy plugin group configuration on partial edits without exposing removed fields', async () => {
    const setup = configuredApp({ bridge_mode: 'reserved', bridge_max_message_chars: 1200, agent_model: 'legacy', retained: true });
    const response = await writeRequest(setup, '/plugins/plugin-1', { config: { brave_api_key: 'new-secret' } }, 'PATCH');
    expect(response.status).toBe(200);
    expect((await json(response)).data).toMatchObject({ config: { bridge_mode: 'reserved', bridge_max_message_chars: 1200, agent_model: 'legacy', retained: true, brave_api_key: '********' } });
  });

  it('returns legacy group overrides on reads without writing and retains them on save', async () => {
    const setup = configuredApp({ bridge_max_message_chars: 1200, bridge_mode: 'reserved', agent_temperature: 0.2, brave_api_key: 'not-inherited' });
    seed(setup.values, 'groups', { ...baseGroup, inputCostPerMillion: 2, outputCostPerMillion: 4 });
    const before = setup.values.get('nonebotmaker:records:groups:group-1');
    const response = await setup.app.request('/groups/group-1', {}, setup.bindings);
    expect(response.status).toBe(200);
    const group = (await json(response)).data as JsonObject;
    expect(group).toMatchObject({ conversationType: 'group', config: { bridge_max_message_chars: 1200, bridge_mode: 'reserved', agent_temperature: 0.2 } });
    expect(group.config).not.toHaveProperty('brave_api_key');
    expect(setup.values.get('nonebotmaker:records:groups:group-1')).toBe(before);
    const saved = await writeRequest(setup, '/groups/group-1', { config: { agent_max_rounds: 100, bridge_max_message_chars: 700 } }, 'PATCH');
    expect(saved.status).toBe(200);
    expect((await json(saved)).data).toMatchObject({ inputCostPerMillion: 2, outputCostPerMillion: 4, config: { bridge_max_message_chars: 700, bridge_mode: 'reserved', agent_temperature: 0.2, agent_max_rounds: 25 } });
    const listed = (await json(await setup.app.request('/groups', {}, setup.bindings))).data as JsonObject[];
    expect(listed[0]).toMatchObject({ config: { bridge_mode: 'reserved', agent_max_rounds: 25 } });
  });

  it('does not add old group prices on new records and inherits only the associated plugin', async () => {
    const setup = configuredApp({ bridge_max_message_chars: 1300 });
    seed(setup.values, 'plugins', { id: 'other-plugin', type: 'elysia-best/plugin-chatbot', config: { bridge_max_message_chars: 3000 } });
    const response = await writeRequest(setup, '/groups', { ...baseGroup, config: { agent_temperature: 0 } });
    expect(response.status).toBe(201);
    const group = (await json(response)).data as JsonObject;
    expect(group).toMatchObject({ config: { bridge_max_message_chars: 1300, agent_temperature: 0 } });
    expect(group).not.toHaveProperty('inputCostPerMillion');
    expect(group).not.toHaveProperty('outputCostPerMillion');
  });
});

describe('legacy credentials and conversation identity', () => {
  it.each([
    { botSecret: 'same', clientSecret: 'same' },
    { botSecret: 'same' },
    { clientSecret: 'same' },
    { botSecret: '', clientSecret: 'same' },
    { appSecret: '', botSecret: 'same', clientSecret: 'same' },
  ])('migrates unambiguous old secrets without requiring reentry: %j', async (legacy) => {
    const setup = configuredApp();
    const old = await encryptSecrets({ id: 'legacy', createdAt: '', updatedAt: '', pluginId: 'plugin-1', protocol: 'qq', name: 'Legacy', config: {}, credentials: { appId: '10002', ...legacy } }, undefined, setup.bindings);
    seed(setup.values, 'accounts', old);
    const response = await writeRequest(setup, '/accounts/legacy', { credentials: { appSecret: '' } }, 'PATCH');
    expect(response.status).toBe(200);
    const stored = JSON.parse(setup.values.get('nonebotmaker:records:accounts:legacy')!) as JsonObject;
    expect((await decryptSecrets(stored, setup.bindings)).credentials).toEqual({ appId: '10002', appSecret: 'same' });
  });

  it('does not merge divergent old secrets and requires an explicit replacement', async () => {
    const setup = configuredApp();
    const old = await encryptSecrets({ id: 'legacy', createdAt: '', updatedAt: '', pluginId: 'plugin-1', protocol: 'qq', name: 'Legacy', config: {}, credentials: { appId: '10002', botSecret: 'old-bot', clientSecret: 'old-client' } }, undefined, setup.bindings);
    seed(setup.values, 'accounts', old);
    const before = setup.values.get('nonebotmaker:records:accounts:legacy');
    const read = await setup.app.request('/accounts/legacy', {}, setup.bindings);
    expect((await json(read)).data).toMatchObject({ credentialStatus: 'legacy_secret_conflict_reenter_appSecret' });
    const rejected = await writeRequest(setup, '/accounts/legacy', { credentials: { appSecret: '' } }, 'PATCH');
    expect(rejected.status).toBe(400);
    expect(await json(rejected)).toEqual({ error: 'legacy_secret_conflict_reenter_appSecret' });
    expect(setup.values.get('nonebotmaker:records:accounts:legacy')).toBe(before);
    const replaced = await writeRequest(setup, '/accounts/legacy', { credentials: { appSecret: 'replacement' } }, 'PATCH');
    expect(replaced.status).toBe(200);
    const stored = JSON.parse(setup.values.get('nonebotmaker:records:accounts:legacy')!) as JsonObject;
    expect((await decryptSecrets(stored, setup.bindings)).credentials).toEqual({ appId: '10002', appSecret: 'replacement' });
  });

  it('rejects duplicate App IDs across plugin instances and on edits', async () => {
    const setup = configuredApp();
    seed(setup.values, 'plugins', { id: 'plugin-2', type: 'elysia-best/plugin-chatbot', config: {} });
    const response = await writeRequest(setup, '/accounts', { pluginId: 'plugin-2', protocol: 'qq', name: 'Duplicate', credentials: { appId: ' 10001 ', appSecret: 'secret' } });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'duplicate_appId' });
    seed(setup.values, 'accounts', { id: 'account-2', pluginId: 'plugin-2', protocol: 'qq', name: 'Bot2', config: {}, credentials: { appId: '10002', appSecret: 'secret' } });
    const edited = await writeRequest(setup, '/accounts/account-2', { credentials: { appId: '10001' } }, 'PATCH');
    expect(edited.status).toBe(409);
  });

  it('allows private and group conversations with the same external ID but rejects duplicates', async () => {
    const setup = configuredApp();
    expect((await writeRequest(setup, '/groups', baseGroup)).status).toBe(201);
    const duplicate = await writeRequest(setup, '/groups', { ...baseGroup, id: 'duplicate' });
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toEqual({ error: 'duplicate_conversation' });
    expect((await writeRequest(setup, '/groups', { ...baseGroup, id: 'private-1', conversationType: 'private' })).status).toBe(201);
    seed(setup.values, 'accounts', { id: 'account-2', pluginId: 'plugin-1', protocol: 'qq', credentials: {}, config: {} });
    expect((await writeRequest(setup, '/groups', { ...baseGroup, id: 'other-account-group', accountId: 'account-2' })).status).toBe(201);
  });

  it.each([{ conversationType: 'private' }, { accountId: 'account-2' }])('locks existing conversation identity: %j', async (change) => {
    const setup = configuredApp();
    seed(setup.values, 'accounts', { id: 'account-2', pluginId: 'plugin-1', protocol: 'qq', credentials: {}, config: {} });
    seed(setup.values, 'groups', baseGroup);
    const response = await writeRequest(setup, '/groups/group-1', change, 'PATCH');
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'group_binding_locked' });
  });

  it('normalizes multiple conversation openids and lets them be edited later', async () => {
    const setup = configuredApp();
    const created = await writeRequest(setup, '/groups', { ...baseGroup, externalId: ' group-a, group-b\ngroup-c ' });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ externalId: 'group-a,group-b,group-c' });

    const edited = await writeRequest(setup, '/groups/group-1', { externalId: 'group-a, group-d' }, 'PATCH');
    expect(edited.status).toBe(200);
    expect((await json(edited)).data).toMatchObject({ externalId: 'group-a,group-d' });

    expect((await writeRequest(setup, '/groups', { ...baseGroup, id: 'group-2', externalId: 'group-x, group-d' })).status).toBe(409);
    expect((await writeRequest(setup, '/groups/group-1', { externalId: ' , ' }, 'PATCH')).status).toBe(400);
  });

  it.each([{ credentials: { appId: 'different' } }, { pluginId: 'plugin-2' }])('locks account identity when conversations are bound: %j', async (change) => {
    const setup = configuredApp();
    seed(setup.values, 'plugins', { id: 'plugin-2', type: 'elysia-best/plugin-chatbot', config: {} });
    seed(setup.values, 'groups', baseGroup);
    const response = await writeRequest(setup, '/accounts/account-1', change, 'PATCH');
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: 'account_binding_locked' });
  });

  it.each(['channel', '', null])('rejects unsupported conversation types: %j', async (conversationType) => {
    const setup = configuredApp();
    expect((await writeRequest(setup, '/groups', { ...baseGroup, conversationType })).status).toBe(400);
  });
});

describe('model prices and provider multipliers', () => {
  it('offers dated presets without populating the price library and allows manual CRUD', async () => {
    const setup = createApp();
    const presets = await json(await setup.app.request('/prices/presets', {}, setup.bindings));
    expect(presets).toMatchObject({ checkedAt: '2026-11-02', realtime: false });
    expect((presets.data as JsonObject[]).every((price) => typeof price.sourceUrl === 'string' && price.currency === 'USD')).toBe(true);
    expect(await json(await setup.app.request('/prices', {}, setup.bindings))).toEqual({ data: [] });
    const response = await writeRequest(setup, '/prices', MODEL_PRICE_PRESETS[0] as unknown as JsonObject);
    expect(response.status).toBe(201);
    const price = (await json(response)).data as JsonObject;
    expect(price).toMatchObject({ model: 'gpt-4.1-mini', inputCostPerMillion: 0.4, cacheInputCostPerMillion: 0.1, currency: 'USD' });
    const updated = await writeRequest(setup, `/prices/${price.id}`, { inputCostPerMillion: 0, outputCostPerMillion: 5 }, 'PATCH');
    expect(updated.status).toBe(200);
    expect((await json(updated)).data).toMatchObject({ inputCostPerMillion: 0, outputCostPerMillion: 5, cacheInputCostPerMillion: 0.1, sourceUrl: price.sourceUrl });
    expect((await setup.app.request(`/prices/${price.id}`, {}, setup.bindings)).status).toBe(200);
    expect((await setup.app.request(`/prices/${price.id}`, { method: 'DELETE' }, setup.bindings)).status).toBe(200);
    expect((await setup.app.request(`/prices/${price.id}`, {}, setup.bindings)).status).toBe(404);
  });

  it.each(['PATCH', 'PUT'])('clears an optional cached input price with null and preserves omitted values: %s', async (method) => {
    const setup = createApp();
    const created = await writeRequest(setup, '/prices', MODEL_PRICE_PRESETS[0] as unknown as JsonObject);
    const price = (await json(created)).data as JsonObject;
    const path = `/prices/${price.id}`;
    const preserved = await writeRequest(setup, path, { name: 'Rename' }, method);
    expect(preserved.status).toBe(200);
    expect((await json(preserved)).data).toMatchObject({ cacheInputCostPerMillion: 0.1 });
    const cleared = await writeRequest(setup, path, { cacheInputCostPerMillion: null }, method);
    expect(cleared.status).toBe(200);
    expect((await json(cleared)).data).not.toHaveProperty('cacheInputCostPerMillion');
    const stored = JSON.parse(setup.values.get(`nonebotmaker:records:prices:${price.id}`)!) as JsonObject;
    expect(stored).not.toHaveProperty('cacheInputCostPerMillion');
    const fetched = await setup.app.request(path, {}, setup.bindings);
    expect((await json(fetched)).data).not.toHaveProperty('cacheInputCostPerMillion');
    const zero = await writeRequest(setup, path, { cacheInputCostPerMillion: 0 }, method);
    expect(zero.status).toBe(200);
    expect((await json(zero)).data).toMatchObject({ cacheInputCostPerMillion: 0 });
  });

  it('accepts null cached input cost on creation without storing null', async () => {
    const setup = createApp();
    const response = await writeRequest(setup, '/prices', { ...MODEL_PRICE_PRESETS[0], cacheInputCostPerMillion: null });
    expect(response.status).toBe(201);
    expect((await json(response)).data).not.toHaveProperty('cacheInputCostPerMillion');
  });

  it.each([
    { inputCostPerMillion: -1 }, { outputCostPerMillion: -1 }, { cacheInputCostPerMillion: -1 },
    { currency: 'CNY' }, { sourceUrl: 'javascript:alert(1)' }, { model: '' },
  ])('rejects invalid model prices: %j', async (change) => {
    const setup = createApp();
    const response = await writeRequest(setup, '/prices', { ...MODEL_PRICE_PRESETS[0], ...change });
    expect(response.status).toBe(400);
  });

  it('defaults old/new provider multipliers to one, preserves zero, and rejects negatives', async () => {
    const setup = configuredApp();
    expect((await json(await setup.app.request('/providers/provider-1', {}, setup.bindings))).data).toMatchObject({ priceMultiplier: 1 });
    const created = await writeRequest(setup, '/providers', { id: 'new-provider', name: 'New' });
    expect((await json(created)).data).toMatchObject({ priceMultiplier: 1 });
    const free = await writeRequest(setup, '/providers/provider-1', { priceMultiplier: 0 }, 'PATCH');
    expect((await json(free)).data).toMatchObject({ priceMultiplier: 0 });
    const invalid = await writeRequest(setup, '/providers/provider-1', { priceMultiplier: -0.1 }, 'PATCH');
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: 'invalid_priceMultiplier' });
  });

  it('persists character price units and defaults legacy prices to tokens', async () => {
    const setup = configuredApp();
    seed(setup.values, 'prices', { id: 'legacy-price', name: 'Legacy', model: 'legacy', currency: 'USD', inputCostPerMillion: 1, outputCostPerMillion: 2 });
    expect((await json(await setup.app.request('/prices/legacy-price', {}, setup.bindings))).data).toMatchObject({ unit: 'tokens' });
    const created = await writeRequest(setup, '/prices', { name: 'Speech', model: 'tts-1', unit: 'characters', inputCostPerMillion: 15, outputCostPerMillion: 0 });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ unit: 'characters' });
    expect((await writeRequest(setup, '/prices', { name: 'Invalid', model: 'x', unit: 'seconds' })).status).toBe(400);
  });

  it('defaults legacy capabilities to image and persists explicit media capability lists', async () => {
    const setup = configuredApp();
    expect((await json(await setup.app.request('/providers/provider-1', {}, setup.bindings))).data).toMatchObject({ mediaCapabilities: ['image'] });
    const changed = await writeRequest(setup, '/providers/provider-1', { mediaCapabilities: ['image', 'audio', 'speech', 'image'] }, 'PATCH');
    expect(changed.status).toBe(200);
    expect((await json(changed)).data).toMatchObject({ mediaCapabilities: ['image', 'audio', 'speech'] });
    expect((await writeRequest(setup, '/providers/provider-1', { mediaCapabilities: [] }, 'PATCH')).status).toBe(200);
    expect((await writeRequest(setup, '/providers/provider-1', { mediaCapabilities: ['unknown'] }, 'PATCH')).status).toBe(400);
  });

  it('matches enabled exact prices then snapshots, without selecting unrelated models', () => {
    expect(findModelPrice(MODEL_PRICE_PRESETS, 'gpt-4.1-mini')?.inputCostPerMillion).toBe(0.4);
    expect(findModelPrice(MODEL_PRICE_PRESETS, 'gpt-4.1-mini-2025-04-14')?.inputCostPerMillion).toBe(0.4);
    expect(findModelPrice(MODEL_PRICE_PRESETS, 'gpt-4.1')).toBeUndefined();
    expect(findModelPrice(MODEL_PRICE_PRESETS, 'tts-1-hd')).toMatchObject({ unit: 'characters', inputCostPerMillion: 30 });
    expect(findModelPrice(MODEL_PRICE_PRESETS, 'tts-1-1106')).toMatchObject({ unit: 'characters', inputCostPerMillion: 15 });
    expect(findModelPrice(MODEL_PRICE_PRESETS.map((price) => ({ ...price, enabled: false })), 'gpt-4.1-mini')).toBeUndefined();
  });
});

describe('structured MCP configuration', () => {
  it('normalizes URL and bearer tokens, encrypts them, and preserves blank secret edits', async () => {
    const setup = createApp();
    const created = await writeRequest(setup, '/mcps', { id: 'mcp-1', name: 'MCP', config: { url: 'https://mcp.example', token: 'Bearer tool-secret' } });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ config: { url: 'https://mcp.example/', authToken: '********' } });
    const updated = await writeRequest(setup, '/mcps/mcp-1', { config: { authToken: '', url: 'https://mcp.example/tools' } }, 'PATCH');
    expect(updated.status).toBe(200);
    const stored = JSON.parse(setup.values.get('nonebotmaker:records:mcps:mcp-1')!) as JsonObject;
    expect(JSON.stringify(stored)).not.toContain('tool-secret');
    expect((await decryptSecrets(stored, setup.bindings)).config).toEqual({ url: 'https://mcp.example/tools', authToken: 'tool-secret' });
  });

  it.each(['token', 'bearerToken'])('migrates encrypted legacy %s without saving a redacted placeholder', async (key) => {
    const setup = createApp();
    const old = await encryptSecrets({ id: 'legacy-mcp', name: 'Legacy', createdAt: '', updatedAt: '', config: { url: 'https://mcp.example', [key]: 'legacy-token' } }, undefined, setup.bindings);
    seed(setup.values, 'mcps', old);
    const before = setup.values.get('nonebotmaker:records:mcps:legacy-mcp');
    const fetched = await setup.app.request('/mcps/legacy-mcp', {}, setup.bindings);
    expect((await json(fetched)).data).toMatchObject({ config: { authToken: '********' } });
    expect(setup.values.get('nonebotmaker:records:mcps:legacy-mcp')).toBe(before);
    expect((await writeRequest(setup, '/mcps/legacy-mcp', { config: { authToken: '' } }, 'PATCH')).status).toBe(200);
    const stored = JSON.parse(setup.values.get('nonebotmaker:records:mcps:legacy-mcp')!) as JsonObject;
    expect((await decryptSecrets(stored, setup.bindings)).config).toEqual({ url: 'https://mcp.example/', authToken: 'legacy-token' });
  });

  it('normalizes legacy allowed tool lists and validates their schema', async () => {
    const setup = createApp();
    const created = await writeRequest(setup, '/mcps', { name: 'Tools', config: { url: 'https://mcp.example', tools: [' search ', 'search', ''] } });
    expect(created.status).toBe(201);
    const config = ((await json(created)).data as JsonObject).config as JsonObject;
    expect(config.allowedTools).toEqual(['search']);
    expect(config).not.toHaveProperty('tools');
    const id = ((await json(await setup.app.request('/mcps', {}, setup.bindings))).data as JsonObject[])[0].id;
    expect((await writeRequest(setup, `/mcps/${id}`, { config: { tools: ['updated'], bearerToken: 'Bearer replacement-secret' } }, 'PATCH')).status).toBe(200);
    const stored = JSON.parse(setup.values.get(`nonebotmaker:records:mcps:${id}`)!) as JsonObject;
    expect((await decryptSecrets(stored, setup.bindings)).config).toMatchObject({ allowedTools: ['updated'], authToken: 'replacement-secret' });
    expect((await writeRequest(setup, '/mcps', { name: 'Invalid', config: { allowedTools: [1] } })).status).toBe(400);
  });

  it.each(['file:///tmp/tools', 'javascript:alert(1)', 'https://user:password@mcp.example'])('rejects unsafe MCP URLs: %s', async (url) => {
    const setup = createApp();
    expect((await writeRequest(setup, '/mcps', { name: 'MCP', config: { url } })).status).toBe(400);
  });
});

describe('shared project memories', () => {
  it('validates memory fields, account references, and account-scoped search', async () => {
    const setup = configuredApp();
    seed(setup.values, 'accounts', {
      id: 'account-2', pluginId: 'plugin-1', protocol: 'qq', name: 'Bot 2', enabled: true, credentials: {}, config: {},
    });
    const first = await writeRequest(setup, '/memories', {
      id: 'memory-1', accountId: 'account-1', type: 'project', name: 'Architecture', title: 'Project notes',
      desc: 'A summary', content: 'Contains unique needle phrase', time: '2026-11-03T00:00:00.000Z',
    });
    expect(first.status).toBe(201);
    expect((await writeRequest(setup, '/memories', {
      id: 'memory-2', accountId: 'account-2', type: 'reference', name: 'Other', title: 'Other notes',
      desc: '', content: 'Other account', time: '2026-11-03',
    })).status).toBe(201);

    expect((await writeRequest(setup, '/memories', {
      accountId: 'account-1', type: 'unknown', name: 'Bad', title: 'Bad', desc: '', content: 'x', time: 'now',
    })).status).toBe(400);
    expect((await writeRequest(setup, '/memories', {
      accountId: 'account-1', type: 'user', name: 'Bad', title: 'Bad', content: 'x', time: 'now',
    })).status).toBe(400);
    expect((await writeRequest(setup, '/memories', {
      accountId: 'account-1', type: 'user', name: 'Bad', title: 'Bad', desc: '', content: 'x', time: 123,
    })).status).toBe(400);
    expect((await writeRequest(setup, '/memories', {
      accountId: 'account-missing', type: 'user', name: 'Bad', title: 'Bad', desc: '', content: 'x', time: 'now',
    })).status).toBe(400);

    const found = await setup.app.request('/memories?accountId=account-1&q=NEEDLE', {}, setup.bindings);
    expect((await json(found)).data).toMatchObject([{ id: 'memory-1' }]);
    const hidden = await setup.app.request('/memories?accountId=account-1&q=Other', {}, setup.bindings);
    expect((await json(hidden)).data).toEqual([]);
    expect((await setup.app.request('/memories/memory-2?accountId=account-1', {}, setup.bindings)).status).toBe(404);
    expect((await writeRequest(setup, '/memories/memory-2?accountId=account-1', { title: 'Changed' }, 'PATCH')).status).toBe(404);
    expect((await setup.app.request('/memories/memory-2?accountId=account-1', { method: 'DELETE' }, setup.bindings)).status).toBe(404);
    expect((await setup.app.request('/memories', {}, setup.bindings)).status).toBe(400);
    expect((await setup.app.request('/accounts/account-1', { method: 'DELETE' }, setup.bindings)).status).toBe(409);

    const updated = await writeRequest(setup, '/memories/memory-1?accountId=account-1', { title: 'Updated notes' }, 'PATCH');
    expect(updated.status).toBe(200);
    expect((await json(updated)).data).toMatchObject({ title: 'Updated notes', accountId: 'account-1' });
    expect((await setup.app.request('/memories/memory-1?accountId=account-1', { method: 'DELETE' }, setup.bindings)).status).toBe(200);
    expect((await setup.app.request('/memories/memory-1?accountId=account-1', {}, setup.bindings)).status).toBe(404);
  });
});

describe('capability policies', () => {
  it('scopes policy fields by type and rejects unknown policy types', async () => {
    const definition = pluginDefinition('elysia-best/plugin-chatbot')!;
    expect(policyFields('dialog').map((field) => field.key)).toEqual(['agent_stream', 'agent_max_rounds', 'agent_max_output_tokens', 'agent_temperature']);
    expect(policyFields('voice').map((field) => field.key)).toEqual(['voice_model', 'voice_id', 'voice_speed', 'voice_max_text_chars', 'voice_max_bytes', 'voice_sends_per_hour']);
    expect(policyFields('identity').map((field) => field.key)).toEqual([
      'bridge_mode', 'bridge_max_message_chars', 'bridge_max_messages_per_minute', 'bridge_group_batch_seconds',
      'bridge_slang_enabled', 'bridge_slang_min_messages', 'bridge_slang_cooldown_seconds',
      'max_context', 'compact_rate', 'bridge_max_media_bytes', 'context_history_limit', 'memory_enabled',
    ]);
    expect(definition.groupFields.filter((field) => !field.scope).map((field) => field.key)).toEqual([
      'bridge_owner_ids', 'bridge_allowed_private', 'bridge_reserved_prompt', 'bridge_reserved2_prompt', 'timezone',
    ]);

    const setup = configuredApp();
    const created = await writeRequest(setup, '/policies', { type: 'dialog', name: 'Fast', config: { agent_max_rounds: 100, agent_temperature: 0 } });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ type: 'dialog', enabled: true, config: { agent_max_rounds: 25, agent_temperature: 0, agent_max_output_tokens: 4096 } });
    expect((await writeRequest(setup, '/policies', { type: 'unknown', name: 'Nope' })).status).toBe(400);
  });

  it('applies referenced policies to conversation settings and blocks deleting policies in use', async () => {
    const setup = configuredApp({ bridge_max_message_chars: 1200, bridge_mode: 'reserved', agent_temperature: 0.2 });
    const identity = (await json(await writeRequest(setup, '/policies', {
      type: 'identity', name: 'Identity', providerId: 'provider-1', model: 'policy-model',
      config: { bridge_max_message_chars: 900, max_context: 32768 },
    }))).data as JsonObject;
    const dialog = (await json(await writeRequest(setup, '/policies', { type: 'dialog', name: 'Dialog' }))).data as JsonObject;

    const created = await writeRequest(setup, '/groups', {
      ...baseGroup, identityPolicyId: identity.id, dialogPolicyId: dialog.id,
      config: { bridge_max_message_chars: 300, bridge_mode: 'reserved' },
    });
    expect(created.status).toBe(201);
    const group = (await json(created)).data as JsonObject;
    expect(group).toMatchObject({ identityPolicyId: identity.id, dialogPolicyId: dialog.id });
    expect(group.config).toMatchObject({ bridge_max_message_chars: 900, max_context: 32768, bridge_mode: 'chat', agent_temperature: 0.7 });

    expect((await setup.app.request(`/policies/${identity.id}`, { method: 'DELETE' }, setup.bindings)).status).toBe(409);
    expect((await writeRequest(setup, '/groups', { ...baseGroup, id: 'group-2', externalId: 'external-2', identityPolicyId: dialog.id })).status).toBe(400);
    expect((await writeRequest(setup, '/groups', { ...baseGroup, id: 'group-2', externalId: 'external-2', identityPolicyId: 'missing-policy' })).status).toBe(400);
  });

  it('blocks deleting skills that only a policy references', async () => {
    const setup = configuredApp();
    seed(setup.values, 'skills', { id: 'skill-1', name: 'Skill', description: '', enabled: true, config: { prompt: 'do it' } });
    const policy = (await json(await writeRequest(setup, '/policies', { type: 'identity', name: 'Identity', skillIds: ['skill-1'] }))).data as JsonObject;
    expect((await setup.app.request('/skills/skill-1', { method: 'DELETE' }, setup.bindings)).status).toBe(409);
    expect((await setup.app.request(`/policies/${policy.id}`, { method: 'DELETE' }, setup.bindings)).status).toBe(200);
    expect((await setup.app.request('/skills/skill-1', { method: 'DELETE' }, setup.bindings)).status).toBe(200);
  });

  it('merges identity overrides with additive extension ids', () => {
    const identity: PolicyRecord = {
      id: 'policy-1', type: 'identity', name: 'Identity', description: '', enabled: true,
      providerId: 'provider-1', model: 'policy-model', systemPrompt: 'POLICY', reasoningEffort: 'high',
      skillIds: ['skill-1'], mcpIds: ['mcp-1'], ruleIds: ['rule-1'], config: {}, createdAt: '', updatedAt: '',
    };
    const base = { providerId: '', model: '', systemPrompt: '', reasoningEffort: 'default' as const, skillIds: [], mcpIds: [], ruleIds: [] };
    expect(resolveGroupIdentity({ ...base, systemPrompt: 'LOCAL', systemPromptMode: 'append', skillIds: ['skill-2', 'skill-1'] }, identity)).toEqual({
      providerId: 'provider-1', model: 'policy-model', systemPrompt: 'POLICY\n\nLOCAL', reasoningEffort: 'high',
      skillIds: ['skill-1', 'skill-2'], mcpIds: ['mcp-1'], ruleIds: ['rule-1'],
    });
    expect(resolveGroupIdentity({ ...base, systemPrompt: 'LOCAL', systemPromptMode: 'override' }, identity).systemPrompt).toBe('LOCAL');
    expect(resolveGroupIdentity({ ...base, systemPrompt: 'LOCAL' }, identity).systemPrompt).toBe('LOCAL');
    expect(resolveGroupIdentity({ ...base, providerId: 'provider-2', model: 'local-model', reasoningEffort: 'low' }, identity))
      .toMatchObject({ providerId: 'provider-2', model: 'local-model', reasoningEffort: 'low', systemPrompt: 'POLICY' });
    expect(resolveGroupIdentity(base, undefined)).toEqual({
      providerId: '', model: '', systemPrompt: '', reasoningEffort: 'default', skillIds: [], mcpIds: [], ruleIds: [],
    });
  });
});
