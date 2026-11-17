import { describe, expect, it } from 'vitest';
import type { ChatAccountContext } from '../types';
import { normalizeKookEvent } from './message';

const botId = '10001';

function account(): ChatAccountContext {
  return {
    appId: botId,
    protocol: 'kook',
    credentials: { botId, token: 'kook-token' },
    appSecret: 'kook-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'kook', name: 'KOOK', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    channel_type: 'GROUP',
    type: 9,
    target_id: 'channel-1',
    author_id: '42',
    content: `(met)${botId}(met) 你好`,
    msg_id: 'msg-1',
    msg_timestamp: 1_800_000_000_000,
    extra: { type: 9, mention: [botId], author: { id: '42', username: 'alice', bot: false } },
    ...overrides,
  };
}

describe('KOOK message normalization', () => {
  it('normalizes a channel mention into a group conversation', () => {
    const normalized = normalizeKookEvent(event(), account(), botId, 1_700_000_000_000);
    expect(normalized).toMatchObject({
      id: 'msg-1', groupId: 'channel-1', userId: '42', userName: 'alice',
      text: '你好', mentionsBot: true, conversationType: 'group', eventId: 'kook:msg-1',
    });
  });

  it('treats personal channels as private conversations', () => {
    const normalized = normalizeKookEvent(event({ channel_type: 'PERSON', content: 'hello' }), account(), botId, 0);
    expect(normalized).toMatchObject({ text: 'hello', mentionsBot: true, conversationType: 'private' });
  });

  it('ignores bot authors, its own messages, and system events', () => {
    expect(normalizeKookEvent(event({ extra: { author: { id: '7', bot: true } } }), account(), botId, 0)).toBeNull();
    expect(normalizeKookEvent(event({ author_id: botId }), account(), botId, 0)).toBeNull();
    expect(normalizeKookEvent(event({ type: 255 }), account(), botId, 0)).toBeNull();
  });

  it('uses placeholders for media messages', () => {
    expect(normalizeKookEvent(event({ type: 2, content: 'https://img.example/a.png' }), account(), botId, 0)?.text).toBe('[图片]');
  });
});
