import { describe, expect, it, vi } from 'vitest';
import { getQQAccessToken, replyToQQGroup, sendQQMedia } from './api';
import { createChatbotHandler } from '../../plugins/chatbot/handler';
import type { GroupRecord, ModelPriceRecord, ProviderRecord } from '../../../shared/types';
import type { QQAccountContext } from './types';

function account(appId: string) {
  return { appId, clientSecret: 'client-secret' };
}

describe('QQ media delivery', () => {
  it.each([['group', 'image', 1], ['private', 'audio', 3], ['group', 'video', 2], ['private', 'file', 4]] as const)('uploads %s %s then sends file_info with one sequence', async (conversationType, type, fileType) => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json(url.endsWith('getAppAccessToken') ? { access_token: 'token', expires_in: 7200 } : url.endsWith('/files') ? { file_info: 'opaque-file-info' } : { id: 'sent' });
    };
    const bot = { appId: `media-${conversationType}-${type}`, appSecret: 'secret' } as QQAccountContext;
    const filename = type === 'audio' ? 'voice.mp3' : 'test.bin';
    await sendQQMedia(bot, 'open/id', 'message', { type, bytes: new Uint8Array([0, 127, 255]), contentType: 'application/octet-stream', filename }, { seq: 4, conversationType }, fetch);
    const uploaded = calls.find((call) => call.url.endsWith('/files'))!;
    expect(uploaded.url).toBe(`https://api.bot.qq.com/v2/${conversationType === 'private' ? 'users' : 'groups'}/open%2Fid/files`);
    expect(uploaded.body).toEqual({ file_type: fileType, srv_send_msg: false, file_data: 'AH//', file_name: filename });
    expect(calls[calls.length - 1]?.body).toEqual({ msg_type: 7, content: ' ', media: { file_info: 'opaque-file-info' }, msg_id: 'message', msg_seq: 4 });
  });

  it('does not send a message when upload fails or payload is oversized', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json(String(input).endsWith('getAppAccessToken') ? { access_token: 'token', expires_in: 7200 } : { err_code: 12 });
    };
    const bot = { appId: 'failed-media', appSecret: 'secret' } as QQAccountContext;
    const media = { type: 'file' as const, bytes: new Uint8Array([1]), contentType: 'text/plain', filename: 'file.txt' };
    await expect(sendQQMedia(bot, 'group', 'message', media, { seq: 1, conversationType: 'group' }, fetch)).rejects.toThrow('upload response');
    expect(calls.some((url) => url.endsWith('/messages'))).toBe(false);
    for (const filename of ['../voice.mp3', 'dir\\voice.mp3', 'voice\n.mp3', 'a'.repeat(257)]) {
      await expect(sendQQMedia(bot, 'group', 'message', { ...media, filename }, { seq: 1, conversationType: 'group' }, fetch)).rejects.toThrow('filename');
    }
    await expect(sendQQMedia(bot, 'group', 'message', { ...media, bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, { seq: 1, conversationType: 'group' }, fetch)).rejects.toThrow('5 MB');
  });

  it.each(['media', 'tts'] as const)('executes chat_%s through actual QQ upload/send service', async (mode) => {
    let round = 0;
    const messages: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
      if (url.includes('media.example')) return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/audio/speech')) return new Response(new Uint8Array([0x49, 0x44, 0x33, 0]), { headers: { 'content-type': 'audio/mpeg' } });
      if (url.endsWith('getAppAccessToken')) return Response.json({ access_token: 'token', expires_in: 7200 });
      if (url.endsWith('/files')) return Response.json({ file_info: 'tool-file' });
      if (url.startsWith('https://api.bot.qq.com/')) { messages.push(JSON.parse(String(init?.body))); return Response.json({ id: 'sent' }); }
      const call = mode === 'tts' ? { name: 'chat_tts', arguments: '{"text":"hello"}' } : { name: 'chat_send_media', arguments: '{"url":"https://media.example/image","type":"image"}' };
      return Response.json({ choices: [{ message: ++round === 1 ? { content: '', tool_calls: [{ id: 'tool', type: 'function', function: call }] } : { content: 'already sent' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    };
    const bot = { appId: `tool-${mode}`, appSecret: 'app-secret', account: { id: 'account', enabled: true, pluginId: 'plugin' }, pluginEnabled: true, pluginConfig: { voice_model: 'tts-model' } } as unknown as QQAccountContext;
    const group = { id: `group-${mode}`, accountId: 'account', externalId: 'group', enabled: true, providerId: 'provider', model: 'model', whitelistEnabled: false, skillIds: [], mcpIds: [], ruleIds: [] } as unknown as GroupRecord;
    const provider = { id: 'provider', enabled: true, baseUrl: 'https://api.vendor.example/v1', apiKey: 'api-key', mediaCapabilities: ['speech'] } as ProviderRecord;
    const handler = createChatbotHandler({
      findGroup: async () => group, findProvider: async () => provider,
      findPrice: async (model, unit) => ({ id: model, model, enabled: true, unit, currency: 'USD', inputCostPerMillion: 1, outputCostPerMillion: 1 } as ModelPriceRecord),
      getRecentContext: async () => [], isWithinCostLimits: async () => true, recordGroupCost: async () => undefined,
      sendReply: (account, target, id, content, options) => replyToQQGroup(account, target, id, content, fetch, options?.seq, options?.conversationType),
      sendMedia: (account, target, id, media, options) => sendQQMedia(account, target, id, media, options, fetch), fetch,
    });
    await handler(bot, { id: 'message', accountId: 'account', botId: bot.appId, groupId: 'group', userId: 'user', text: mode === 'tts' ? '请用语音回复' : 'hello', mentionsBot: true, receivedAt: Date.now(), eventType: 'GROUP_AT_MESSAGE_CREATE' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ msg_type: 7, media: { file_info: 'tool-file' }, msg_seq: 1 });
  });
});

describe('QQ API access tokens', () => {
  it('accepts expires_in as a numeric string and caches until the refresh window', async () => {
    let now = 1_000;
    const fetch = vi.fn(async () => Response.json({ access_token: 'token', expires_in: '7200' }));
    const bot = account('string-expiry-test');

    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    now += 7_000_000;
    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    expect(fetch).toHaveBeenCalledOnce();

    now += 150_000;
    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses canonical AppSecret for tokens and invalidates the cache on credential rotation', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: 'rotated', expires_in: 7200 }));
    const bot = { appId: 'credential-rotation', appSecret: 'first' };
    await getQQAccessToken(bot, fetch);
    await getQQAccessToken({ ...bot, appSecret: 'second' }, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ appId: bot.appId, clientSecret: 'second' });
  });

  it('rejects platform error codes even when HTTP status is successful', async () => {
    const fetch: typeof globalThis.fetch = async (input) => Response.json(String(input).endsWith('getAppAccessToken') ? { access_token: 'token', expires_in: 7200 } : { code: 304023 });
    await expect(replyToQQGroup({ appId: 'platform-error-code', appSecret: 'secret' } as QQAccountContext, 'target', 'message', 'reply', fetch)).rejects.toThrow('reply failed');
  });

  it('sends C2C to users endpoint with encoded openid, increasing sequence and timeout', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json(String(input).endsWith('getAppAccessToken') ? { access_token: 'test', expires_in: 7200 } : {});
    });
    const bot = { appId: 'private-reply', appSecret: 'app-secret' } as QQAccountContext;
    await replyToQQGroup(bot, 'openid/a', 'msg', 'part 1', fetch, 1, 'private');
    await replyToQQGroup(bot, 'openid/a', 'msg', 'part 2', fetch, 2, 'private');
    const replies = calls.filter((call) => call.url.includes('/v2/'));
    expect(replies.map((call) => call.url)).toEqual(Array(2).fill('https://api.bot.qq.com/v2/users/openid%2Fa/messages'));
    expect(replies.map((call) => JSON.parse(String(call.init?.body)).msg_seq)).toEqual([1, 2]);
    expect(replies[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    await replyToQQGroup(bot, 'openid/a', 'old-msg', 'wake', fetch, 3, 'private', true);
    const active = JSON.parse(String(calls[calls.length - 1]?.init?.body));
    expect(active).toMatchObject({ content: 'wake', msg_seq: 3 });
    expect(active.msg_id).toBeUndefined();
  });
});
