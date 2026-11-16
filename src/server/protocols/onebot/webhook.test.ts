import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => ({
  account: {
    appId: '10001',
    protocol: 'onebot',
    credentials: { selfId: '10001', apiBaseUrl: 'https://onebot.example', accessToken: '', secret: 'report-secret' },
    appSecret: 'report-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'onebot', name: 'OneBot', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ resolveChatAccountByCredential: vi.fn(async () => state.account) }));

import { hmacSha1Hex } from '../crypto';
import { createOneBotWebhookRouter } from './webhook';

function groupPayload() {
  return {
    time: 1_800_000_000,
    self_id: 10001,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 9001,
    group_id: 555,
    user_id: 777,
    message: [
      { type: 'at', data: { qq: '10001' } },
      { type: 'text', data: { text: ' 你好 ' } },
    ],
    sender: { user_id: 777, nickname: 'Tester', card: '' },
  };
}

async function signedRequest(payload: unknown) {
  const raw = JSON.stringify(payload);
  return createOneBotWebhookRouter({ handleMessage: state.handleMessage }).request('/webhook/onebot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Signature': `sha1=${await hmacSha1Hex('report-secret', raw)}` },
    body: raw,
  });
}

describe('OneBot webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('verifies the report signature and normalizes group segments', async () => {
    const response = await signedRequest(groupPayload());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'onebot' }),
      expect.objectContaining({
        id: '9001', groupId: '555', userId: '777', userName: 'Tester',
        text: '你好', mentionsBot: true, conversationType: 'group', eventType: 'onebot.group',
      }),
      expect.anything(),
    );
  });

  it('parses CQ-code string messages and uses the user ID for private chats', async () => {
    const response = await signedRequest({
      time: 1_800_000_001, self_id: '10001', post_type: 'message', message_type: 'private', message_id: 9002,
      user_id: 778, message: '你好[CQ:face,id=1]', message_format: 'string', sender: { nickname: 'DM' },
    });
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupId: '778', userId: '778', text: '你好[表情]', mentionsBot: true, conversationType: 'private',
    }), expect.anything());
  });

  it('rejects reports without a valid signature', async () => {
    const raw = JSON.stringify(groupPayload());
    const response = await createOneBotWebhookRouter({ handleMessage: state.handleMessage }).request('/webhook/onebot', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
    });
    expect(response.status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('acknowledges non-message reports without processing', async () => {
    const response = await signedRequest({ post_type: 'meta_event', meta_event_type: 'heartbeat', self_id: 10001 });
    expect(response.status).toBe(200);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
