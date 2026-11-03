import { describe, expect, it } from 'vitest';
import type { KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { createSessionToken, SESSION_COOKIE } from '../auth';
import { createApiRouter } from './index';
import { createMemeLibrary } from '../plugins/chatbot/meme-library';
import { createKVMemeStore } from '../plugins/chatbot/meme-storage';

function fixture() {
  const values = new Map<string, string>();
  const KV: KVNamespaceLike = {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
  const bindings = { PLATFORM: 'edgeone', KV, SYS_SECRET: 'chatbot-runtime-api-test' } as RuntimeBindings;
  const group = {
    id: 'group-1', accountId: 'account-1', externalId: 'group-openid', conversationType: 'group', name: 'Group', enabled: true,
    providerId: 'provider-1', model: 'test-model', systemPrompt: '', reasoningEffort: 'default', nonMentionReplyRate: 1,
    whitelistEnabled: false, whitelistUserIds: [], dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0,
    skillIds: [], mcpIds: [], ruleIds: [], config: { bridge_mode: 'chat', bridge_owner_ids: 'console-owner' }, createdAt: '', updatedAt: '',
  };
  values.set('nonebotmaker:records:groups:group-1', JSON.stringify(group));
  values.set('nonebotmaker:records:plugins:plugin-1', JSON.stringify({ id: 'plugin-1', type: 'elysia-best/plugin-chatbot', enabled: true, config: {}, createdAt: '', updatedAt: '' }));
  values.set('nonebotmaker:records:accounts:account-1', JSON.stringify({ id: 'account-1', pluginId: 'plugin-1', protocol: 'qq', enabled: true, credentials: { appId: 'test-app', appSecret: 'test-secret' }, config: {}, createdAt: '', updatedAt: '' }));
  const api = createApiRouter();
  return { values, bindings, api, group };
}

async function authorized(f: ReturnType<typeof fixture>, path: string, init: RequestInit = {}) {
  const token = await createSessionToken(f.bindings);
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  if (init.method && init.method !== 'GET') headers.set('Origin', 'http://localhost');
  return f.api.request(path, { ...init, headers }, f.bindings);
}

describe('chatbot conversation management API', () => {
  it('requires a management session and lists only records owned by the requested account', async () => {
    const f = fixture();
    expect((await f.api.request('/chatbot/conversations', {}, f.bindings)).status).toBe(401);
    const list = await authorized(f, '/chatbot/conversations?accountId=account-1');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ data: [{ id: 'group-1', accountId: 'account-1', externalId: 'group-openid', mode: 'chat' }] });
  });

  it('reads and updates silent, mode, initial prompt and tool policies by conversation scope', async () => {
    const f = fixture();
    const status = await authorized(f, '/chatbot/conversations/account-1/group-1');
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ data: { mode: 'chat', silent: false, contextMessages: 0 } });
    const update = (body: unknown) => authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await update({ action: 'silent', silent: true })).status).toBe(200);
    expect((await update({ action: 'mode', mode: 'reserved2' })).status).toBe(200);
    expect((await update({ action: 'initialPrompt', prompt: 'summarize next' })).status).toBe(200);
    expect((await update({ action: 'tools', disabledTools: ['chat_send'] })).status).toBe(200);
    const after = await authorized(f, '/chatbot/conversations/account-1/group-1');
    expect(await after.json()).toMatchObject({ data: { mode: 'reserved2', silent: true, initialPromptPending: true, disabledTools: ['chat_send'] } });
  });

  it('rejects cross-account path access and invalid mutation values', async () => {
    const f = fixture();
    expect((await authorized(f, '/chatbot/conversations/other-account/group-1')).status).toBe(404);
    const oversize = await authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'initialPrompt', prompt: 'x'.repeat(5000) }) });
    expect(oversize.status).toBe(400);
    const unsafeTools = await authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'tools', disabledTools: ['../Bash'] }) });
    expect(unsafeTools.status).toBe(400);
  });

  it('allows only authenticated control-plane sessions to reject a pending MCP operation as the configured conversation owner', async () => {
    const f = fixture();
    const scope = JSON.stringify(['account-1', 'group', 'group-openid']);
    const stateKey = `nonebotmaker:chatbot:context:state:${encodeURIComponent(scope)}`;
    f.values.set(stateKey, JSON.stringify({ toolApprovals: [{ id: 'approval-1', call: { id: 'call-1', type: 'function', function: { name: 'mcp_write', arguments: '{"value":"x"}' } }, requestedBy: 'member', requestedAt: 1, expiresAt: Date.now() + 60_000, status: 'pending' }] }));
    const path = '/chatbot/conversations/account-1/group-1/control';
    const unauthorized = await f.api.request(path, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approvalDecision', approvalId: 'approval-1', decision: 'reject' }) }, f.bindings);
    expect(unauthorized.status).toBe(401);
    const response = await authorized(f, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approvalDecision', approvalId: 'approval-1', decision: 'reject' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { decision: 'reject', actingOwnerId: 'console-owner', messages: ['工具请求已拒绝。'] } });
    expect(JSON.parse(f.values.get(stateKey)!).toolApprovals[0].status).toBe('rejected');
  });

  it('lists and deletes only the approved meme metadata for the selected conversation', async () => {
    const f = fixture();
    const store = createKVMemeStore(f.bindings)!;
    const library = createMemeLibrary({ store, review: async () => 'allow' });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    await library.save({ accountId: 'account-1', conversationScope: JSON.stringify(['account-1', 'group', 'group-openid']), name: 'approved-wave', bytes, contentType: 'image/png', createdBy: 'owner' });
    const control = (body: unknown) => authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const listed = await control({ action: 'memeList' });
    expect(listed.status).toBe(200);
    const items = (await listed.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(items).toMatchObject([{ name: 'approved-wave', contentType: 'image/png', size: bytes.byteLength }]);
    expect(items[0]).not.toHaveProperty('bytes');
    expect((await control({ action: 'memeDelete', memeName: 'approved-wave' })).status).toBe(200);
    expect(await library.list('account-1')).toEqual([]);
  });

  it('uploads, lists and deletes account-scoped MP3 voice assets through authenticated controls', async () => {
    const f = fixture();
    const path = '/chatbot/conversations/account-1/group-1/control';
    const payload = { action: 'voiceUpload', voiceName: 'welcome.mp3', voiceContentType: 'audio/mpeg', voiceData: 'SUQzAAA=' };
    const denied = await f.api.request(path, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(payload) }, f.bindings);
    expect(denied.status).toBe(401);
    const control = (body: unknown) => authorized(f, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const uploaded = await control(payload);
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ data: { asset: { accountId: 'account-1', name: 'welcome.mp3', contentType: 'audio/mpeg', size: 5 } } });
    const listed = await control({ action: 'voiceList' });
    const items = (await listed.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(items).toMatchObject([{ name: 'welcome.mp3', contentType: 'audio/mpeg', size: 5 }]);
    expect(items[0]).not.toHaveProperty('bytes');
    expect(await (await control({ action: 'voiceDelete', voiceName: 'welcome.mp3' })).json()).toMatchObject({ data: { deleted: true } });
    expect(await (await control({ action: 'voiceList' })).json()).toMatchObject({ data: { items: [] } });
  });

  it('supports scoped slang candidate research edits and manual approval in the authenticated console', async () => {
    const f = fixture();
    const control = (body: unknown) => authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await control({ action: 'slangCreate', slangTerm: 'qwerx', slangContext: 'A sample use in the group.' });
    expect(created.status).toBe(200);
    const candidate = (await created.json() as { data: { item: { id: string; status: string } } }).data.item;
    expect(candidate.status).toBe('pending');
    const updated = await control({ action: 'slangUpdate', slangId: candidate.id, slangDetails: { meaning: 'A group greeting', usage: 'Used at greeting', example: 'qwerx!', risk: 'Context specific', sources: ['https://example.com/slang'] } });
    expect(updated.status).toBe(200);
    const approved = await control({ action: 'slangApprove', slangId: candidate.id });
    expect((await approved.json() as { data: { item: { status: string; meaning: string } } }).data.item).toMatchObject({ status: 'confirmed', meaning: 'A group greeting' });
    expect((await control({ action: 'slangList' })).status).toBe(200);
    expect((await control({ action: 'slangReject', slangId: candidate.id })).status).toBe(409);
  });

  it('manages approved memes and reviewed slang only inside the authenticated target conversation', async () => {
    const f = fixture();
    const stores = createKVMemeStore(f.bindings)!;
    const memeLibrary = createMemeLibrary({ store: stores, review: async () => 'allow' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8]);
    const scope = JSON.stringify(['account-1', 'group', 'group-openid']);
    await memeLibrary.save({ accountId: 'account-1', conversationScope: scope, name: 'approved-wave', bytes: png, contentType: 'image/png', createdBy: 'owner' });
    const control = (body: unknown) => authorized(f, '/chatbot/conversations/account-1/group-1/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const memes = await control({ action: 'memeList' });
    expect((await memes.json() as { data: { items: Array<Record<string, unknown>> } }).data.items).toMatchObject([{ name: 'approved-wave', contentType: 'image/png', size: png.byteLength }]);
    expect((await control({ action: 'memeDelete', memeName: 'approved-wave' })).status).toBe(200);
    const candidate = await control({ action: 'slangCreate', slangTerm: 'qwerx', slangContext: 'Sample usage in the group.' });
    expect(candidate.status).toBe(200);
    const id = (await candidate.json() as { data: { item: { id: string } } }).data.item.id;
    const edited = await control({ action: 'slangUpdate', slangId: id, slangDetails: { meaning: 'A greeting', usage: 'Used at start', example: 'qwerx!', risk: 'Local only', sources: ['https://example.com/ref'] } });
    expect((await edited.json() as { data: { item: { meaning: string } } }).data.item.meaning).toBe('A greeting');
    const approved = await control({ action: 'slangApprove', slangId: id });
    expect((await approved.json() as { data: { item: { status: string } } }).data.item.status).toBe('confirmed');
    const list = await control({ action: 'slangList' });
    expect((await list.json() as { data: { items: Array<{ id: string; status: string }> } }).data.items).toMatchObject([{ id, status: 'confirmed' }]);
  });

  it('rejects cross-account group listings even when the external openid matches', async () => {
    const f = fixture();
    f.values.set('nonebotmaker:records:groups:group-2', JSON.stringify({ ...f.group, id: 'group-2', accountId: 'account-2', name: 'Other account' }));
    const response = await authorized(f, '/chatbot/conversations/account-2/group-1');
    expect(response.status).toBe(404);
  });
});
