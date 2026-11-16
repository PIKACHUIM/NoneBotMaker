import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => ({
  account: {
    appId: 'ding-app-key',
    protocol: 'dingtalk',
    credentials: { appKey: 'ding-app-key', appSecret: 'ding-secret', robotCode: 'robot-1' },
    appSecret: 'ding-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'dingtalk', name: 'DingTalk', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { hmacSha256Base64 } from '../crypto';
import { createDingTalkWebhookRouter } from './webhook';

function body() {
  return {
    msgtype: 'text',
    text: { content: ' hello ' },
    conversationId: 'cid_group',
    conversationType: '2',
    senderStaffId: 'staff-1',
    senderNick: 'Tester',
    msgId: 'msg-1',
    createAt: 1_700_000_000_000,
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
    isInAtList: true,
  };
}

async function signedRequest(payload: unknown) {
  const timestamp = String(Date.now());
  const sign = await hmacSha256Base64('ding-secret', `${timestamp}\n` + 'ding-secret');
  return createDingTalkWebhookRouter({ handleMessage: state.handleMessage }).request('/webhook/dingtalk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', timestamp, sign },
    body: JSON.stringify(payload),
  });
}

describe('DingTalk webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('verifies the callback signature and normalizes the robot message', async () => {
    const response = await signedRequest(body());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ errcode: 0, errmsg: 'ok' });
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'dingtalk' }),
      expect.objectContaining({
        id: 'msg-1', groupId: 'cid_group', userId: 'staff-1', userName: 'Tester', text: 'hello',
        mentionsBot: true, conversationType: 'group', replyToken: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      }),
      expect.anything(),
    );
  });

  it('rejects an invalid signature', async () => {
    const response = await createDingTalkWebhookRouter({ handleMessage: state.handleMessage }).request('/webhook/dingtalk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', timestamp: String(Date.now()), sign: 'invalid' },
      body: JSON.stringify(body()),
    });
    expect(response.status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('drops unsafe sessionWebhook values', async () => {
    const response = await signedRequest({ ...body(), sessionWebhook: 'https://attacker.example/session' });
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ replyToken: expect.anything() }), expect.anything());
  });

  it('uses the staff ID as the external ID for direct chats', async () => {
    const response = await signedRequest({ ...body(), conversationType: '1' });
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupId: 'staff-1', conversationType: 'private', mentionsBot: true,
    }), expect.anything());
  });
});
