import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { hmacSha256Base64 } from '../crypto';

const state = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  account: {
    appId: '2000123456',
    protocol: 'line',
    credentials: { channelId: '2000123456', channelSecret: 'line-secret', channelAccessToken: 'line-token', botUserId: 'Ubot' },
    appSecret: 'line-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'line', name: 'LINE', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { createLineWebhookRouter } from './webhook';

async function request(body: unknown, secret = 'line-secret') {
  const raw = JSON.stringify(body);
  const signature = await hmacSha256Base64(secret, raw);
  return createLineWebhookRouter({ handleMessage: state.handleMessage, now: () => state.now }).request('/webhook/line', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Line-Signature': signature },
    body: raw,
  });
}

function groupEvent(): {
  destination: string;
  events: Array<{
    type: string;
    timestamp: number;
    webhookEventId: string;
    replyToken: string;
    source: { type: string; userId: string; groupId?: string };
    message: { id: string; type: string; text: string };
  }>;
} {
  return {
    destination: 'Ubot',
    events: [{
      type: 'message',
      timestamp: 1_800_000_000_000,
      webhookEventId: 'webhook-1',
      replyToken: 'reply-token',
      source: { type: 'group', groupId: 'Cgroup', userId: 'U42' },
      message: { id: '325708', type: 'text', text: '@Helper 你好' },
    }],
  };
}

describe('LINE webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('verifies the channel secret and normalizes a group mention', async () => {
    const response = await request(groupEvent());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'line' }),
      expect.objectContaining({
        id: '325708', groupId: 'Cgroup', userId: 'U42',
        text: '你好', mentionsBot: true, conversationType: 'group', eventId: 'line:webhook-1',
      }),
      expect.anything(),
    );
  });

  it('treats one-to-one chats as private conversations', async () => {
    const payload = groupEvent();
    payload.events[0].source = { type: 'user', userId: 'U42' };
    payload.events[0].message.text = 'hello';
    await request(payload);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupId: 'U42', text: 'hello', mentionsBot: true, conversationType: 'private',
    }), expect.anything());
  });

  it('rejects incorrect signatures and mismatched destinations', async () => {
    expect((await request(groupEvent(), 'wrong')).status).toBe(401);
    const payload = groupEvent();
    payload.destination = 'Uother';
    expect((await request(payload)).status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
