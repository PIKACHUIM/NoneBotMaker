import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from './types';
import { sendMessengerText } from './messenger/api';
import { sendVkMedia, sendVkText } from './vk/api';
import { sendZulipText } from './zulip/api';
import { sendRocketChatText } from './rocketchat/api';
import { sendDodoText, getDodoGatewayUrl } from './dodo/api';
import { sendMatrixText } from './matrix/api';
import { sendRevoltText } from './revolt/api';
import { sendMastodonText } from './mastodon/api';
import { sendInstagramText } from './instagram/api';
import { sendViberText } from './viber/api';
import { sendMisskeyText } from './misskey/api';

function account(protocol: string, credentials: Record<string, string>): ChatAccountContext {
  return {
    appId: 'app', protocol, credentials, pluginEnabled: true,
    account: { id: 'account', pluginId: 'plugin', protocol, name: protocol, enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as ChatAccountContext;
}

const options = { seq: 1, conversationType: 'group' as const };

function jsonFetch(result: unknown = {}) {
  return vi.fn<typeof fetch>(async () => Response.json(result));
}

describe('new chat protocol senders', () => {
  it('posts Messenger text through the Graph Send API', async () => {
    const fetchMock = jsonFetch({ message_id: 'm' });
    await sendMessengerText(account('messenger', { pageId: '1', pageAccessToken: 'page-token' }), 'user-1', '', 'hello', options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/me/messages');
    expect(String(init?.body)).toContain('"id":"user-1"');
  });

  it('sends VK text and rejects media', async () => {
    const fetchMock = jsonFetch({ response: 1 });
    await sendVkText(account('vk', { groupId: '1', accessToken: 'vk-token' }), '2000000001', '', 'hello', options, fetchMock);
    expect(String(fetchMock.mock.calls[0][0])).toContain('messages.send');
    expect(String((fetchMock.mock.calls[0][1]?.body as URLSearchParams).get('peer_id'))).toBe('2000000001');
    await expect(sendVkMedia(account('vk', { groupId: '1', accessToken: 'vk-token' }), '1', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options)).rejects.toThrow('not supported');
  });

  it('posts Zulip stream replies with the topic', async () => {
    const fetchMock = jsonFetch({ result: 'success' });
    await sendZulipText(account('zulip', { siteUrl: 'https://chat.example.com', botEmail: 'bot@example.com', apiKey: 'key' }), 'stream:4:topic', '', 'hello', options, fetchMock);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ type: 'stream', to: '4', topic: 'topic', content: 'hello' });
  });

  it('posts Rocket.Chat messages by room id', async () => {
    const fetchMock = jsonFetch({ success: true });
    await sendRocketChatText(account('rocketchat', { serverUrl: 'https://rc.example.com', userId: 'bot', authToken: 'token' }), 'room-1', '', 'hello', options, fetchMock);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/chat.postMessage');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ roomId: 'room-1', text: 'hello' });
  });

  it('resolves the DoDo gateway and sends channel or direct messages', async () => {
    const gateway = jsonFetch({ status: 0, data: { endpoint: 'wss://gateway.example/ws' } });
    expect(await getDodoGatewayUrl(account('dodo', { clientId: 'c', token: 't' }), gateway)).toBe('wss://gateway.example/ws');

    const fetchMock = jsonFetch({ status: 0, data: {} });
    const dodo = account('dodo', { clientId: 'c', token: 't' });
    await sendDodoText(dodo, 'channel-1', '', 'hello', options, fetchMock);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/channel/message/send');
    await sendDodoText(dodo, 'island-1|user-1', '', 'hello', { seq: 1, conversationType: 'private' }, fetchMock);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/personal/message/send');
  });

  it('sends Matrix messages with an encoded room id', async () => {
    const fetchMock = jsonFetch({});
    await sendMatrixText(account('matrix', { homeserverUrl: 'https://matrix.example.com', userId: '@bot:x', accessToken: 'token' }), '!room:example.com', '', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/rooms/!room%3Aexample.com/send/m.room.message/');
    expect(init?.method).toBe('PUT');
  });

  it('sends Instagram, Viber and Misskey messages', async () => {
    const igFetch = jsonFetch({ message_id: 'm' });
    await sendInstagramText(account('instagram', { igUserId: '20002', pageAccessToken: 'token' }), 'user-1', '', 'hello', options, igFetch);
    expect(String(igFetch.mock.calls[0][0])).toContain('/20002/messages');

    const viberFetch = jsonFetch({ status: 0 });
    await sendViberText(account('viber', { authToken: 'token', botName: 'Bot' }), 'user-1', '', 'hello', options, viberFetch);
    expect(String(viberFetch.mock.calls[0][0])).toContain('chatapi.viber.com/pa/send_message');
    expect(JSON.parse(String(viberFetch.mock.calls[0][1]?.body))).toMatchObject({ receiver: 'user-1', sender: { name: 'Bot' }, text: 'hello' });

    const mkFetch = jsonFetch({ createdNote: { id: 'n' } });
    await sendMisskeyText(account('misskey', { host: 'https://misskey.example', userId: 'u', token: 'token' }), 'user:author', 'abcdefgh', 'hello', options, mkFetch);
    expect(String(mkFetch.mock.calls[0][0])).toContain('/api/notes/create');
    expect(JSON.parse(String(mkFetch.mock.calls[0][1]?.body))).toMatchObject({ text: 'hello', visibility: 'public', replyId: 'abcdefgh' });
  });

  it('sends Revolt messages and Mastodon statuses', async () => {
    const revoltFetch = jsonFetch({});
    await sendRevoltText(account('revolt', { botId: 'bot', botToken: 'token' }), 'channel-1', '', 'hello', options, revoltFetch);
    expect(String(revoltFetch.mock.calls[0][0])).toContain('/channels/channel-1/messages');

    const mastoFetch = jsonFetch({ id: '1' });
    await sendMastodonText(account('mastodon', { instanceUrl: 'https://mastodon.example', accountId: '7', accessToken: 'token' }), 'acct:alice@example.social', '42', 'hello', options, mastoFetch);
    expect(String(mastoFetch.mock.calls[0][0])).toContain('/api/v1/statuses');
    expect(JSON.parse(String(mastoFetch.mock.calls[0][1]?.body))).toMatchObject({
      status: '@alice@example.social hello', visibility: 'unlisted', in_reply_to_id: '42',
    });
  });
});
