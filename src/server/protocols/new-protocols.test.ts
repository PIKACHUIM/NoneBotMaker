import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from './types';
import { hmacSha256Hex } from './crypto';

function account(protocol: string, credentials: Record<string, string>): ChatAccountContext {
  return {
    appId: credentials.pageId || credentials.groupId || credentials.botEmail || credentials.userId
      || credentials.clientId || credentials.botId || credentials.accountId || 'app',
    protocol,
    credentials,
    pluginEnabled: true,
    account: {
      id: `${protocol}-1`, pluginId: 'plugin-1', protocol, name: protocol,
      enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '',
    },
  } as ChatAccountContext;
}

const state = vi.hoisted(() => ({
  accounts: [] as ChatAccountContext[],
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('./accounts', () => ({
  listChatAccounts: vi.fn(async (protocol: string) => state.accounts.filter((item) => item.protocol === protocol)),
}));

import { createMessengerWebhookRouter } from './messenger/webhook';
import { createVkWebhookRouter } from './vk/webhook';
import { createZulipWebhookRouter } from './zulip/webhook';
import { createRocketChatWebhookRouter } from './rocketchat/webhook';
import { createInstagramWebhookRouter } from './instagram/webhook';
import { createViberWebhookRouter } from './viber/webhook';
import { normalizeDodoEvent } from './dodo/message';
import { normalizeMatrixEvent } from './matrix/message';
import { normalizeRevoltMessage, revoltChannelTypes } from './revolt/message';
import { normalizeMastodonStatus, mastodonText } from './mastodon/message';
import { normalizeMessengerEvent } from './messenger/message';
import { normalizeVkMessage } from './vk/message';
import { normalizeZulipMessage } from './zulip/message';
import { normalizeRocketChatMessage } from './rocketchat/message';
import { normalizeViberMessage } from './viber/message';
import { normalizeMisskeyNote } from './misskey/message';

const messenger = account('messenger', {
  pageId: '10001', pageAccessToken: 'page-token', appSecret: 'app-secret', verifyToken: 'verify-me',
});
const vk = account('vk', {
  groupId: '123', accessToken: 'vk-token', secret: 'vk-secret', confirmationToken: 'confirm-me',
});
const zulip = account('zulip', {
  siteUrl: 'https://chat.example.com', botEmail: 'bot@example.com', apiKey: 'api-key', token: 'zulip-token',
});
const rocketchat = account('rocketchat', {
  serverUrl: 'https://rc.example.com', userId: 'bot-user', authToken: 'rc-auth', token: 'rc-token',
});
const dodo = account('dodo', { clientId: 'client-1', token: 'dodo-token' });
const matrix = account('matrix', { homeserverUrl: 'https://matrix.example.com', userId: '@bot:example.com', accessToken: 'mx-token' });
const revolt = account('revolt', { botId: 'bot-1', botToken: 'revolt-token' });
const mastodon = account('mastodon', { instanceUrl: 'https://mastodon.example', accountId: '7', accessToken: 'masto-token' });
const instagram = account('instagram', { igUserId: '20002', pageAccessToken: 'ig-token', appSecret: 'ig-secret', verifyToken: 'ig-verify' });
const viber = account('viber', { authToken: 'viber-token', botName: 'Bot' });
const misskey = account('misskey', { host: 'https://misskey.example', userId: 'user-9', token: 'mk-token' });

function post(router: { request(input: string, init?: RequestInit): Response | Promise<Response> }, path: string, body: unknown, headers: Record<string, string> = {}) {
  return router.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('new chat protocol normalizers', () => {
  it('normalizes Messenger, VK, Zulip and Rocket.Chat messages', () => {
    expect(normalizeMessengerEvent({
      sender: { id: 'user-1' }, timestamp: 1_700_000_000_000,
      message: { mid: 'm-1', text: 'hello', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/a.png' } }] },
    }, messenger, 1)).toMatchObject({
      id: 'm-1', groupId: 'user-1', conversationType: 'private', text: 'hello',
      attachments: [{ url: 'https://cdn.example/a.png', type: 'image' }],
    });

    expect(normalizeVkMessage({
      type: 'message_new',
      object: { message: { id: 9, peer_id: 2_000_000_005, from_id: 55, text: 'vk hello', date: 1_700_000_000 } },
    }, vk, 1)).toMatchObject({ id: '9', groupId: '2000000005', userId: '55', conversationType: 'group' });

    expect(normalizeZulipMessage({
      data: 'zulip hello',
      message: { id: 12, sender_id: 3, sender_full_name: 'Alice', type: 'stream', stream_id: 4, subject: 'topic', content: 'zulip hello' },
    }, zulip, 1)).toMatchObject({ groupId: 'stream:4:topic', conversationType: 'group', text: 'zulip hello' });

    expect(normalizeRocketChatMessage({
      token: 'rc-token', channel_id: 'room-1', user_id: 'user-2', user_name: 'Bob', text: 'rc hello', timestamp: '2026-01-01T00:00:00.000Z',
    }, rocketchat, 1)).toMatchObject({ groupId: 'room-1', userId: 'user-2', text: 'rc hello' });
  });

  it('normalizes Instagram, Viber and Misskey events', () => {
    expect(normalizeMessengerEvent({
      sender: { id: 'ig-user' }, timestamp: 1, message: { mid: 'ig-1', text: 'ig hello' },
    }, instagram, 1)).toMatchObject({ id: 'ig-1', groupId: 'ig-user', conversationType: 'private' });

    expect(normalizeViberMessage({
      event: 'message', timestamp: 1, message_token: 'v-1',
      sender: { id: 'v-user', name: 'Vera' }, message: { type: 'text', text: 'viber hello' },
    }, viber, 1)).toMatchObject({ id: 'v-1', groupId: 'v-user', text: 'viber hello', userName: 'Vera' });

    expect(normalizeMisskeyNote({
      id: 'mk-1', userId: 'author', text: 'misskey hello', visibility: 'public',
      mentions: ['user-9'], user: { username: 'alice' },
    }, misskey, 1)).toMatchObject({ id: 'mk-1', groupId: 'user:author', mentionsBot: true, text: 'misskey hello' });

    expect(normalizeMisskeyNote({
      id: 'mk-2', userId: 'author', text: 'dm', visibility: 'specified', mentions: ['user-9'],
    }, misskey, 1)).toMatchObject({ conversationType: 'private', mentionsBot: true });
  });

  it('normalizes DoDo, Matrix, Revolt and Mastodon events', () => {
    expect(normalizeDodoEvent({
      eventId: 'e-1', eventType: '2001',
      eventBody: { channelId: 'channel-1', messageId: 'd-1', messageBody: { content: 'dodo hello' }, personal: { dodoSourceId: 'u-1' } },
    }, dodo, 1)).toMatchObject({ groupId: 'channel-1', userId: 'u-1', conversationType: 'group' });

    expect(normalizeDodoEvent({
      eventId: 'e-2', eventType: '1001',
      eventBody: { islandSourceId: 'island-1', messageId: 'd-2', messageBody: { content: 'dm' }, personal: { dodoSourceId: 'u-2' } },
    }, dodo, 1)).toMatchObject({ groupId: 'island-1|u-2', conversationType: 'private' });

    expect(normalizeMatrixEvent({
      event_id: '$e1', sender: '@alice:example.com', type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'mx hello', 'm.mentions': { user_ids: ['@bot:example.com'] } },
    }, '!room:example.com', matrix, 1, false)).toMatchObject({
      groupId: '!room:example.com', userId: '@alice:example.com', mentionsBot: true, conversationType: 'group',
    });

    const channels = revoltChannelTypes({ channels: [{ _id: 'dm-1', channel_type: 'DirectMessage' }] });
    expect(normalizeRevoltMessage({
      type: 'Message', _id: 'r-1', channel: 'dm-1', author: { _id: 'u-3', username: 'Carol' }, content: 'revolt hello',
    }, revolt, channels, 1)).toMatchObject({ groupId: 'dm-1', conversationType: 'private', mentionsBot: true });

    expect(normalizeMastodonStatus({
      id: '99', content: '<p>masto hello</p>', visibility: 'direct',
      account: { id: '8', acct: 'alice@example.social' }, mentions: [{ id: '7' }],
    }, mastodon, 1)).toMatchObject({
      groupId: 'acct:alice@example.social', conversationType: 'private', text: 'masto hello', mentionsBot: true,
    });
    expect(mastodonText('<p>a<br>b &amp; c</p>')).toBe('a\nb & c');
  });
});

describe('new chat protocol webhooks', () => {
  beforeEach(() => {
    state.accounts = [messenger, vk, zulip, rocketchat, instagram, viber];
    state.handleMessage.mockClear();
  });

  it('verifies the Messenger challenge and signature', async () => {
    const router = createMessengerWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const challenge = await router.request('/webhook/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc');
    expect(challenge.status).toBe(200);
    expect(await challenge.text()).toBe('abc');

    const body = {
      object: 'page',
      entry: [{ id: '10001', time: 1, messaging: [{ sender: { id: 'user-1' }, timestamp: 1, message: { mid: 'm-1', text: 'hi' } }] }],
    };
    const raw = JSON.stringify(body);
    const signature = await hmacSha256Hex('app-secret', raw);
    const ok = await router.request('/webhook/messenger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
      body: raw,
    });
    expect(ok.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'messenger' }), expect.objectContaining({ id: 'm-1' }), expect.anything());

    const rejected = await router.request('/webhook/messenger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      body: raw,
    });
    expect(rejected.status).toBe(401);
  });

  it('answers VK confirmation and verifies the callback secret', async () => {
    const router = createVkWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const confirmation = await post(router, '/webhook/vk', { type: 'confirmation', group_id: 123, secret: 'vk-secret' });
    expect(await confirmation.text()).toBe('confirm-me');

    const rejected = await post(router, '/webhook/vk', { type: 'message_new', group_id: 123, secret: 'wrong' });
    expect(rejected.status).toBe(401);

    const ok = await post(router, '/webhook/vk', {
      type: 'message_new', group_id: 123, secret: 'vk-secret',
      object: { message: { id: 5, peer_id: 55, from_id: 55, text: 'hi', date: 1_700_000_000 } },
    });
    expect(await ok.text()).toBe('ok');
    expect(state.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'vk' }), expect.objectContaining({ id: '5' }), expect.anything());
  });

  it('verifies the Instagram challenge and signature', async () => {
    const router = createInstagramWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const challenge = await router.request('/webhook/instagram?hub.mode=subscribe&hub.verify_token=ig-verify&hub.challenge=xyz');
    expect(await challenge.text()).toBe('xyz');

    const body = {
      object: 'instagram',
      entry: [{ id: '20002', time: 1, messaging: [{ sender: { id: 'ig-user' }, timestamp: 1, message: { mid: 'ig-1', text: 'hi' } }] }],
    };
    const raw = JSON.stringify(body);
    const signature = await hmacSha256Hex('ig-secret', raw);
    const ok = await router.request('/webhook/instagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
      body: raw,
    });
    expect(ok.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'instagram' }), expect.objectContaining({ id: 'ig-1' }), expect.anything());
  });

  it('verifies the Viber content signature', async () => {
    const router = createViberWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const body = {
      event: 'message', timestamp: 1, message_token: 'v-1',
      sender: { id: 'v-user', name: 'Vera' }, message: { type: 'text', text: 'hi' },
    };
    const raw = JSON.stringify(body);
    const signature = await hmacSha256Hex('viber-token', raw);
    const ok = await router.request('/webhook/viber', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-viber-content-signature': signature },
      body: raw,
    });
    expect(ok.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'viber' }), expect.objectContaining({ id: 'v-1' }), expect.anything());

    const rejected = await router.request('/webhook/viber', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-viber-content-signature': '0'.repeat(64) },
      body: raw,
    });
    expect(rejected.status).toBe(401);
  });

  it('verifies Zulip and Rocket.Chat webhook tokens', async () => {
    const zulipRouter = createZulipWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const zulipMessage = await post(zulipRouter, '/webhook/zulip', {
      token: 'zulip-token', data: 'hello',
      message: { id: 1, sender_id: 2, type: 'private', content: 'hello' },
    });
    expect(zulipMessage.status).toBe(200);
    expect((await post(zulipRouter, '/webhook/zulip', { token: 'bad', data: 'x' })).status).toBe(401);

    const rcRouter = createRocketChatWebhookRouter({ handleMessage: state.handleMessage, now: () => 1 });
    const rcMessage = await post(rcRouter, '/webhook/rocketchat', {
      token: 'rc-token', channel_id: 'room-1', user_id: 'user-1', text: 'hello', timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(rcMessage.status).toBe(200);
    expect((await post(rcRouter, '/webhook/rocketchat', { token: 'bad', channel_id: 'room-1', user_id: 'user-1', text: 'x' })).status).toBe(401);
  });
});
