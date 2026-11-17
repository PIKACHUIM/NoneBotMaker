import { describe, expect, it } from 'vitest';
import type { ChatAccountContext } from '../types';
import { normalizeSatoriEvent } from './message';

function account(): ChatAccountContext {
  return {
    appId: 'bot-1',
    protocol: 'satori',
    credentials: { endpoint: 'http://127.0.0.1:5140', platform: 'onebot', selfId: 'bot-1', token: 'satori-token' },
    appSecret: 'satori-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'satori', name: 'Satori', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

describe('Satori message normalization', () => {
  it('normalizes a channel mention into a group conversation', () => {
    const normalized = normalizeSatoriEvent({
      id: 1,
      type: 'message-created',
      self_id: 'bot-1',
      timestamp: 1_700_000_000,
      channel: { id: 'channel-1', type: 0 },
      user: { id: 'user-1', name: 'alice', nick: 'Alice' },
      message: { id: 'msg-1', content: '<at id="bot-1"/> 你好' },
    }, account(), 1_800_000_000_000);
    expect(normalized).toMatchObject({
      id: 'msg-1', groupId: 'channel-1', userId: 'user-1', userName: 'Alice',
      text: '你好', mentionsBot: true, conversationType: 'group', eventId: 'satori:msg-1', receivedAt: 1_700_000_000_000,
    });
  });

  it('treats direct channels as private conversations', () => {
    const normalized = normalizeSatoriEvent({
      id: 2,
      type: 'message-created',
      self_id: 'bot-1',
      channel: { id: 'dm-1', type: 1 },
      user: { id: 'user-2', name: 'bob' },
      message: { id: 'msg-2', content: 'hello' },
    }, account(), 1_800_000_000_000);
    expect(normalized).toMatchObject({ text: 'hello', mentionsBot: true, conversationType: 'private' });
  });

  it('ignores other event types and empty messages', () => {
    expect(normalizeSatoriEvent({ type: 'message-deleted' }, account(), 0)).toBeNull();
    expect(normalizeSatoriEvent({ type: 'message-created', channel: { id: 'c' }, message: { id: 'm', content: '' } }, account(), 0)).toBeNull();
  });
});
