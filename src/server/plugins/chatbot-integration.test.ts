import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHATBOT_PLUGIN_TYPE, type D1DatabaseLike, type D1StatementLike, type GroupRecord, type RuntimeBindings } from '../../shared/types';
import { createSessionToken } from '../auth';
import { createApiRouter } from '../routes';
import { resolveQQAccountByAppId, resolveQQAccountById } from '../protocols/qq/accounts';
import { initializeD1Setup } from '../storage/d1-setup';
import { createConversationLogRepository } from '../storage/conversation-log-repository';
import { createPersistentChatbotStores, createStoredChatbotHandler } from './chatbot/runtime';
import { createD1MatcherSessionStore } from './dispatcher';
import { sendQQMedia } from '../protocols/qq/api';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function d1Adapter(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1StatementLike {
      const statement = database.prepare(query);
      let values: SQLInputValue[] = [];
      return {
        bind(...bound: unknown[]) { values = bound as SQLInputValue[]; return this; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

async function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const DB = d1Adapter(database);
  await initializeD1Setup(DB);
  const bindings: RuntimeBindings = { DB, SYS_SECRET: 'integration-only-secret', LOG_RECORD: 'true', PLATFORM: 'local' };
  const token = await createSessionToken(bindings);
  const api = createApiRouter();
  const save = async (kind: string, data: Record<string, unknown>) => {
    const response = await api.request(`https://local.nonebot.dev/${kind}`, {
      method: 'POST',
      headers: { origin: 'https://local.nonebot.dev', cookie: `nbm_session=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }, bindings);
    const body = await response.json() as { data?: Record<string, unknown>; error?: string };
    expect(response.status, `${kind}: ${JSON.stringify(body)}`).toBe(201);
    return body.data!;
  };
  const plugin = await save('plugins', { name: 'QQ plugin', type: CHATBOT_PLUGIN_TYPE });
  const provider = await save('providers', { name: 'AI gateway', baseUrl: 'https://api.vendor.dev/v1', apiKey: 'integration-ai-secret', enabled: true, models: ['integration-model'], priceMultiplier: 3, mediaCapabilities: ['image', 'speech'] });
  await save('prices', { name: 'Integration model price', model: 'integration-model', currency: 'USD', inputCostPerMillion: 2, outputCostPerMillion: 6, cacheInputCostPerMillion: 0.5, enabled: true });
  const identity = await save('policies', { id: 'integration-identity', type: 'identity', name: 'Integration identity', enabled: true,
    providerId: provider.id, model: 'integration-model', reasoningEffort: 'high', toolIds: [],
    config: { bridge_group_batch_seconds: 0, max_context: 4096 } });
  const dialog = await save('policies', { id: 'integration-dialog', type: 'dialog', name: 'Integration dialog', enabled: true });
  const createBot = (appId: string) => save('accounts', { pluginId: plugin.id, protocol: 'qq', name: `QQ ${appId}`, credentials: { appId, appSecret: `integration-app-${appId}` } });
  const createGroup = async (accountId: string, config: Record<string, unknown> = {}, voicePolicyId = '') => await save('groups', {
    accountId, externalId: 'room-openid', name: 'Room', identityPolicyId: identity.id, dialogPolicyId: dialog.id, voicePolicyId,
    providerId: '', model: '', reasoningEffort: 'default',
    config: { bridge_owner_ids: 'alice', bridge_mode: 'chat', ...config },
    nonMentionReplyRate: 1,
  }) as unknown as GroupRecord;
  return { database, DB, bindings, api, token, save, createBot, createGroup, plugin, provider, identity };
}

describe('management to chatbot persistent integration', () => {
  it('resolves capability policies into model, prompt, dialog settings and extensions', async () => {
    const { bindings, createBot, save, provider } = await setup();
    const accountRecord = await createBot('1001');
    await save('skills', { id: 'skill-policy', name: 'Policy skill', description: '', enabled: true, config: { prompt: 'POLICY SKILL PROMPT' } });
    await save('prices', { name: 'Policy model price', model: 'policy-model', currency: 'USD', inputCostPerMillion: 1, outputCostPerMillion: 2, enabled: true });
    const identity = await save('policies', {
      type: 'identity', name: 'Identity policy', providerId: provider.id, model: 'policy-model',
      systemPrompt: 'POLICY PROMPT', reasoningEffort: 'low', skillIds: ['skill-policy'],
    });
    const dialog = await save('policies', { type: 'dialog', name: 'Dialog policy', config: { agent_max_output_tokens: 2048 } });
    await save('groups', {
      accountId: accountRecord.id, externalId: 'room-openid, room-openid-2', name: 'Room',
      identityPolicyId: identity.id, dialogPolicyId: dialog.id,
      providerId: '', model: '', systemPrompt: '', reasoningEffort: 'default',
      config: { bridge_owner_ids: 'alice', bridge_group_batch_seconds: 0, max_context: 4096 },
      nonMentionReplyRate: 1,
    });

    const account = await resolveQQAccountById(accountRecord.id as string, bindings);
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: 'policy reply' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    };
    const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), sendReply: vi.fn(async () => undefined), fetch: fetchImpl });
    await handler(account!, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'policy-message', accountId: account!.account.id, botId: account!.appId, groupId: 'room-openid-2', userId: 'alice', text: 'hello', mentionsBot: true, receivedAt: Date.now() });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'policy-model', reasoning_effort: 'low', max_completion_tokens: 2048 });
    const system = (calls[0].messages as Array<{ role: string; content: string }>).find((entry) => entry.role === 'system');
    expect(system?.content).toContain('POLICY PROMPT');
    expect(system?.content).toContain('POLICY SKILL PROMPT');
  });

  it('resolves two-field accounts, bills model price times API multiplier and exposes plugin details', async () => {
    const { database, bindings, createBot, createGroup } = await setup();
    const accountRecord = await createBot('1001');
    const group = await createGroup(accountRecord.id as string);
    const account = await resolveQQAccountById(accountRecord.id as string, bindings);
    expect(account).not.toBeNull();
    expect((await resolveQQAccountByAppId('1001', bindings))?.account.id).toBe(accountRecord.id);
    const send = vi.fn(async () => undefined);
    const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).startsWith('https://cloudflare-dns.com/')
      ? Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] })
      : Response.json({ choices: [{ message: { content: 'hello from model' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), sendReply: send, fetch: fetchImpl });
    await handler(account!, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'message-1', accountId: account!.account.id, botId: account!.appId, groupId: 'room-openid', userId: 'alice', userName: 'Alice', text: 'hello', mentionsBot: true, receivedAt: Date.now() });
    expect(send).toHaveBeenCalled();
    const cost = database.prepare('SELECT total_spend FROM chatbot_group_costs').get() as { total_spend: number };
    expect(cost.total_spend).toBeCloseTo(0.00015, 8);
    const logs = await createConversationLogRepository(bindings).list({ groupId: group.id });
    expect(logs.items.some((log) => log.direction === 'in' && log.userId === 'alice' && log.groupExternalId === 'room-openid')).toBe(true);
    expect(logs.items.some((log) => log.pluginType === CHATBOT_PLUGIN_TYPE && Boolean(log.details))).toBe(true);
    const usage = logs.items.find((log) => log.details?.usage)?.details?.usage;
    expect(usage).toMatchObject({ promptTokens: 10, completionTokens: 5, cachedPromptTokens: 0 });
    expect(JSON.stringify(logs)).not.toContain('integration-ai-secret');
    expect(JSON.stringify(logs)).not.toContain('integration-app-1001');
  });

  it('keeps identical external group openids isolated across two platform accounts after handler recreation', async () => {
    const { bindings, createBot, createGroup } = await setup();
    const firstRecord = await createBot('1001');
    const secondRecord = await createBot('1002');
    await createGroup(firstRecord.id as string);
    await createGroup(secondRecord.id as string);
    const first = await resolveQQAccountById(firstRecord.id as string, bindings);
    const second = await resolveQQAccountById(secondRecord.id as string, bindings);
    const calls: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (String(_input).startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: 'reply' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    };
    const sendReply = vi.fn(async () => undefined);
    const dispatch = async (account: NonNullable<typeof first>, text: string, id: string) => {
      const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), fetch: fetchImpl, sendReply });
      await handler(account, { eventType: 'GROUP_AT_MESSAGE_CREATE', id, accountId: account.account.id, botId: account.appId, groupId: 'room-openid', userId: 'alice', text, mentionsBot: true, receivedAt: Date.now() });
    };
    await dispatch(first!, 'first-account-private-context', 'first-message');
    await dispatch(second!, 'second-account-only', 'second-message');
    expect(JSON.stringify(calls[1])).not.toContain('first-account-private-context');
    await dispatch(first!, 'follow-up', 'third-message');
    expect(JSON.stringify(calls[2])).toContain('first-account-private-context');
    expect(JSON.stringify(calls[2])).not.toContain('second-account-only');
  });

  it('uses cached-input pricing from the independent model-price record', async () => {
    const { database, bindings, createBot, createGroup } = await setup();
    const accountRecord = await createBot('1001');
    await createGroup(accountRecord.id as string);
    const account = await resolveQQAccountById(accountRecord.id as string, bindings);
    const fetchImpl: typeof fetch = async (url) => String(url).startsWith('https://cloudflare-dns.com/')
      ? Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] })
      : Response.json({ choices: [{ message: { content: 'cached reply' } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 6 } } });
    const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), sendReply: async () => undefined, fetch: fetchImpl });
    await handler(account!, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'cached-message', accountId: account!.account.id, botId: account!.appId, groupId: 'room-openid', userId: 'alice', text: 'hello', mentionsBot: true, receivedAt: Date.now() });
    const cost = database.prepare('SELECT total_spend FROM chatbot_group_costs').get() as { total_spend: number };
    expect(cost.total_spend).toBeCloseTo(0.000123, 8);
  });

  it('runs management to TTS to QQ binary upload and records model plus speech costs', async () => {
    const { bindings, database, api, token, identity, save, createBot, createGroup } = await setup();
    const accountRecord = await createBot('2001');
    const authorizedSpeech = await api.request(`https://local.nonebot.dev/policies/${identity.id}`, {
      method: 'PATCH',
      headers: { origin: 'https://local.nonebot.dev', cookie: `nbm_session=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toolIds: ['chat_tts'] }),
    }, bindings);
    expect(authorizedSpeech.status, JSON.stringify(await authorizedSpeech.json())).toBe(200);
    const voice = await save('policies', { type: 'voice', name: 'Integration speech', enabled: true, config: { voice_model: 'integration-tts' } });
    const group = await createGroup(accountRecord.id as string, { voice_model: 'legacy-voice-must-not-override' }, voice.id as string);
    await save('prices', { name: 'Speech price', model: 'integration-tts', currency: 'USD', unit: 'characters', inputCostPerMillion: 15, outputCostPerMillion: 0, enabled: true });
    const account = await resolveQQAccountByAppId('2001', bindings);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let modelRounds = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ message: ++modelRounds === 1 ? { content: '', tool_calls: [{ id: 'speech-call', type: 'function', function: { name: 'chat_tts', arguments: '{"text":"你好呀"}' } }] } : { content: 'speech sent' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      if (url.endsWith('/audio/speech')) return new Response(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]), { headers: { 'content-type': 'audio/mpeg' } });
      if (url.endsWith('/getAppAccessToken')) return Response.json({ access_token: 'test-only-qq-access', expires_in: 3600 });
      if (url.endsWith('/files')) return Response.json({ file_info: 'test-file-info' });
      if (url.endsWith('/messages')) return Response.json({ id: 'qq-media-message' });
      throw new Error(`Unexpected integration endpoint: ${url}`);
    };
    const sendReply = vi.fn(async () => undefined);
    const handler = createStoredChatbotHandler(bindings, { ...createPersistentChatbotStores(bindings), fetch: fetchImpl, sendReply,
      sendMedia: (bot, target, messageId, media, options) => sendQQMedia(bot, target, messageId, media, options, fetchImpl),
    });
    await handler(account!, { eventType: 'GROUP_AT_MESSAGE_CREATE', id: 'tts-message', accountId: account!.account.id, botId: account!.appId, groupId: 'room-openid', userId: 'alice', text: '请用语音回复', mentionsBot: true, receivedAt: Date.now() });
    const uploaded = calls.find((call) => call.url.endsWith('/files'))!;
    expect(uploaded.body).toMatchObject({ file_type: 3, file_name: 'speech.mp3', file_data: 'SUQzBAAA', srv_send_msg: false });
    expect(calls.find((call) => call.url.endsWith('/messages'))?.body).toMatchObject({ msg_type: 7, msg_id: 'tts-message', msg_seq: 1, media: { file_info: 'test-file-info' } });
    expect(sendReply).not.toHaveBeenCalled();
    expect(modelRounds).toBe(2);
    expect((database.prepare('SELECT total_spend FROM chatbot_group_costs').get() as { total_spend: number }).total_spend).toBeCloseTo(0.000435, 8);
    const logs = await createConversationLogRepository(bindings).list({ groupId: group.id });
    expect(logs.items.some((log) => log.status === 'speech_completed' && log.details?.cost === 0.000135)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('SUQzBAAA');
    expect(JSON.stringify(logs)).not.toContain('test-only-qq-access');
  });

  it('round-trips arbitrary plugin log fields and searches nested openids without exposing secrets', async () => {
    const { bindings, api, token } = await setup();
    const at = Date.now();
    await createConversationLogRepository(bindings).append([{
      id: 'other-plugin-log', pluginId: 'other-plugin', pluginType: 'integration/other-adapter', eventId: 'other-event',
      accountId: 'other-account', groupId: 'other-group', groupExternalId: 'other-room', userId: 'other-user',
      direction: 'in', status: 'received', content: 'other plugin message', createdAt: at, expiresAt: at + 86_400_000,
      details: { sender: { openid: 'nested-sender-openid', displayName: 'Test sender' }, guild: { openid: 'nested-guild-openid' }, customMetric: 12, apiKey: 'never-log-me', media: 'data:image/png;base64,AAAA' },
    }]);
    const response = await api.request('https://local.nonebot.dev/logs?pluginType=integration%2Fother-adapter&q=nested-guild-openid', { headers: { cookie: `nbm_session=${token}` } }, bindings);
    expect(response.status).toBe(200);
    const result = await response.json() as { items: Array<{ details: Record<string, unknown> }>; total: number; fields: Array<{ key: string }> };
    expect(result.total).toBe(1);
    expect(result.items[0].details.customMetric).toBe(12);
    expect(result.items[0].details.sender).toEqual({ openid: 'nested-sender-openid', displayName: 'Test sender' });
    expect(result.fields.some((field) => field.key === 'details.guild')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('never-log-me');
    expect(JSON.stringify(result)).not.toContain('base64,AAAA');
    const missing = await api.request('https://local.nonebot.dev/logs?openid=no-such-openid', { headers: { cookie: `nbm_session=${token}` } }, bindings);
    expect((await missing.json() as { total: number }).total).toBe(0);
    const matched = await api.request('https://local.nonebot.dev/logs?openid=other-user&q=other%20plugin', { headers: { cookie: `nbm_session=${token}` } }, bindings);
    expect((await matched.json() as { total: number }).total).toBe(1);
  });

  it('preserves plugin details on an old D1 schema before and after the log migration', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    for (const name of ['0001_initial.sql', '0002_conversation_group_external_id.sql', '0003_chatbot_runtime_state.sql']) {
      database.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const bindings: RuntimeBindings = { DB: d1Adapter(database), LOG_RECORD: 'true' };
    const at = Date.now();
    const repository = createConversationLogRepository(bindings);
    await repository.append([{
      id: 'legacy-schema-new-log', pluginId: 'plugin', pluginType: CHATBOT_PLUGIN_TYPE, accountId: 'account',
      groupId: 'group', groupExternalId: 'room', userId: 'user', direction: 'in', content: 'message', status: 'received',
      details: { customField: 'preserve-before-migration' }, createdAt: at, expiresAt: at + 86_400_000,
    }]);
    expect((await repository.list({})).items[0]).toMatchObject({ pluginType: CHATBOT_PLUGIN_TYPE, details: { customField: 'preserve-before-migration' } });
    database.exec(readFileSync(new URL('../../../migrations/0004_plugin_conversation_logs.sql', import.meta.url), 'utf8'));
    expect((await createConversationLogRepository(bindings).list({})).items[0]).toMatchObject({ pluginType: CHATBOT_PLUGIN_TYPE, details: { customField: 'preserve-before-migration' } });
  });

  it('atomically consumes persisted matcher sessions without changing managed records', async () => {
    const { bindings, database } = await setup();
    const store = createD1MatcherSessionStore(bindings);
    const session = { matcherId: 'plugin:dialog', nextHandler: 1, state: { answer: '42' }, expiresAt: Date.now() + 60_000 };
    await store.put('qq/bot/group/user', session);
    const results = await Promise.all([store.take('qq/bot/group/user'), store.take('qq/bot/group/user')]);
    expect(results.filter(Boolean)).toEqual([session]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM records WHERE kind = 'plugins'").get()).toEqual({ count: 1 });
  });

  it('protects the new price collection and refuses a cross-origin authenticated write', async () => {
    const { api, bindings, token } = await setup();
    expect((await api.request('https://local.nonebot.dev/prices', {}, bindings)).status).toBe(401);
    expect((await api.request('https://local.nonebot.dev/prices', {
      method: 'POST', headers: { cookie: `nbm_session=${token}`, origin: 'https://evil.dev', 'content-type': 'application/json' }, body: '{}',
    }, bindings)).status).toBe(403);
  });
});
