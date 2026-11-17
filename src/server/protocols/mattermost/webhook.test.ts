import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => ({
  account: {
    appId: 'https://mm.example.com',
    protocol: 'mattermost',
    credentials: { baseUrl: 'https://mm.example.com', token: 'hook-token', accessToken: 'bot-token' },
    appSecret: 'hook-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'mattermost', name: 'Mattermost', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { createMattermostWebhookRouter } from './webhook';

function request(body: Record<string, unknown>) {
  return createMattermostWebhookRouter({ handleMessage: state.handleMessage, now: () => 1_800_000_000_000 }).request('/webhook/mattermost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function payload() {
  return {
    token: 'hook-token',
    team_id: 'team-1',
    channel_id: 'channel-1',
    channel_name: 'town-square',
    user_id: 'user-1',
    user_name: 'alice',
    post_id: 'post-1',
    text: '!ask 你好',
    trigger_word: '!ask',
    timestamp: 1_800_000_000_000,
  };
}

describe('Mattermost webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('verifies the outgoing webhook token and strips the trigger word', async () => {
    const response = await request(payload());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'mattermost' }),
      expect.objectContaining({
        id: 'post-1', groupId: 'channel-1', userId: 'user-1', userName: 'alice',
        text: '你好', mentionsBot: true, conversationType: 'group', eventId: 'mattermost:post-1',
      }),
      expect.anything(),
    );
  });

  it('rejects a missing or incorrect token', async () => {
    expect((await request({ ...payload(), token: '' })).status).toBe(401);
    expect((await request({ ...payload(), token: 'wrong' })).status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
