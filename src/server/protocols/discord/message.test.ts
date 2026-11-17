import { describe, expect, it } from 'vitest';
import type { ChatAccountContext } from '../types';
import { normalizeDiscordMessage } from './message';

const botId = '123456789012345678';

function account(): ChatAccountContext {
  return {
    appId: botId,
    protocol: 'discord',
    credentials: { botId, botToken: 'token' },
    appSecret: 'token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'discord', name: 'Discord', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: '9001',
    channel_id: '8001',
    guild_id: '7001',
    content: `<@${botId}> 你好`,
    author: { id: '42', username: 'alice', global_name: 'Alice', bot: false },
    mentions: [{ id: botId }],
    ...overrides,
  };
}

describe('Discord message normalization', () => {
  it('normalizes a guild mention into a group conversation', () => {
    const normalized = normalizeDiscordMessage(message(), account(), botId, 1_800_000_000_000);
    expect(normalized).toMatchObject({
      id: '9001', groupId: '8001', userId: '42', userName: 'Alice',
      text: '你好', mentionsBot: true, conversationType: 'group', eventId: 'discord:9001', eventType: 'discord.guild',
    });
  });

  it('treats direct messages as private conversations', () => {
    const normalized = normalizeDiscordMessage(message({ guild_id: undefined, content: 'hello' }), account(), botId, 1_800_000_000_000);
    expect(normalized).toMatchObject({ text: 'hello', mentionsBot: true, conversationType: 'private', eventType: 'discord.dm' });
  });

  it('ignores bots, its own messages, and empty content without attachments', () => {
    expect(normalizeDiscordMessage(message({ author: { id: '7', bot: true } }), account(), botId, 0)).toBeNull();
    expect(normalizeDiscordMessage(message({ author: { id: botId, bot: false } }), account(), botId, 0)).toBeNull();
    expect(normalizeDiscordMessage(message({ content: '' }), account(), botId, 0)).toBeNull();
  });

  it('replaces attachment-only messages with a placeholder', () => {
    const normalized = normalizeDiscordMessage(message({ content: '', attachments: [{ id: 'file-1' }] }), account(), botId, 0);
    expect(normalized?.text).toBe('[文件]');
  });
});
