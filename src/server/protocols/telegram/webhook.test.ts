import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => ({
  account: {
    appId: '123456789',
    protocol: 'telegram',
    credentials: { botId: '123456789', botToken: '123456789:AA-test-token', secretToken: 'tg-secret' },
    appSecret: 'tg-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'telegram', name: 'Telegram', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));
vi.mock('./api', () => ({ getTelegramBotIdentity: vi.fn(async () => ({ id: '123456789', username: 'mybot', name: 'Bot' })) }));

import { createTelegramWebhookRouter } from './webhook';

function groupUpdate() {
  return {
    update_id: 4001,
    message: {
      message_id: 88, date: 1_800_000_000,
      chat: { id: -100123, type: 'supergroup' },
      from: { id: 42, is_bot: false, username: 'tester', first_name: 'Test', last_name: 'User' },
      text: '/help@mybot 你好',
      entities: [{ type: 'bot_command', offset: 0, length: 11 }],
    },
  };
}

function request(body: unknown, secret = 'tg-secret') {
  return createTelegramWebhookRouter({ handleMessage: state.handleMessage }).request('/webhook/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify(body),
  });
}

describe('Telegram webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('verifies the secret token and normalizes a group command', async () => {
    const response = await request(groupUpdate());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'telegram' }),
      expect.objectContaining({
        id: '88', groupId: '-100123', userId: '42', userName: 'Test User',
        text: '/help 你好', mentionsBot: true, conversationType: 'group', eventType: 'telegram.supergroup',
      }),
      expect.anything(),
    );
  });

  it('treats direct messages as private conversations', async () => {
    const response = await request({
      update_id: 4002,
      message: { message_id: 89, date: 1_800_000_001, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false }, text: '/start' },
    });
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupId: '42', userId: '42', text: '/start', mentionsBot: true, conversationType: 'private',
    }), expect.anything());
  });

  it('rejects missing or incorrect secret tokens', async () => {
    const missing = await request(groupUpdate(), '');
    expect(missing.status).toBe(401);
    const wrong = await request(groupUpdate(), 'wrong');
    expect(wrong.status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('ignores updates from other bots', async () => {
    const update = groupUpdate();
    update.message.from.is_bot = true;
    const response = await request(update);
    expect(response.status).toBe(200);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
