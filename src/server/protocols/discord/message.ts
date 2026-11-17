import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface DiscordGatewayPacket {
  op?: unknown;
  s?: unknown;
  t?: unknown;
  d?: unknown;
}

interface DiscordMessageCreate {
  id?: unknown;
  channel_id?: unknown;
  guild_id?: unknown;
  content?: unknown;
  author?: { id?: unknown; username?: unknown; global_name?: unknown; bot?: unknown };
  mentions?: Array<{ id?: unknown }>;
  attachments?: unknown[];
  timestamp?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeDiscordMessage(
  data: unknown,
  account: ChatAccountContext,
  botId: string,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as DiscordMessageCreate;
  const author = payload.author;
  if (!author || author.bot === true) return null;
  const userId = stringValue(author.id, 32);
  const channelId = stringValue(payload.channel_id, 32);
  const messageId = stringValue(payload.id, 32);
  if (!userId || !channelId || !messageId) return null;
  if (botId && userId === botId) return null;

  const guildId = stringValue(payload.guild_id, 32);
  const conversationType = guildId ? 'group' : 'private';
  let text = stringValue(payload.content, 4000);
  const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.length > 0;
  const mentioned = text.includes(`<@${botId}>`) || text.includes(`<@!${botId}>`) ||
    (Array.isArray(payload.mentions) && payload.mentions.some((entry) => stringValue(entry?.id, 32) === botId));
  if (botId) {
    text = text.replaceAll(`<@!${botId}>`, ' ').replaceAll(`<@${botId}>`, ' ');
  }
  text = text.replaceAll(/\s{2,}/g, ' ').trim();
  if (!text && hasAttachments) text = '[文件]';
  if (!text) return null;

  const name = stringValue(author.global_name, 64) || stringValue(author.username, 64);
  const timestamp = stringValue(payload.timestamp, 64);
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: botId || account.appId,
    groupId: channelId,
    userId,
    ...(name ? { userName: name } : {}),
    text: text.slice(0, 4000),
    mentionsBot: conversationType === 'private' || mentioned,
    receivedAt: Number.isFinite(parsed) ? parsed : receivedAt,
    eventId: `discord:${messageId}`,
    eventType: guildId ? 'discord.guild' : 'discord.dm',
    conversationType,
  };
}
