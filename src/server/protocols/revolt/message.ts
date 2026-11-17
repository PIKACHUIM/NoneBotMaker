import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface RevoltAuthor {
  _id?: unknown;
  username?: unknown;
  bot?: unknown;
}

export interface RevoltMessageEvent {
  type?: unknown;
  _id?: unknown;
  channel?: unknown;
  author?: unknown;
  content?: unknown;
  mentions?: unknown;
  nonce?: unknown;
}

export interface RevoltReadyEvent {
  type?: unknown;
  users?: unknown;
  channels?: unknown;
  servers?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

/** Builds the channel-type map used to distinguish channels from direct messages. */
export function revoltChannelTypes(ready: RevoltReadyEvent): Record<string, string> {
  const types: Record<string, string> = {};
  if (!Array.isArray(ready.channels)) return types;
  for (const channel of ready.channels) {
    if (!channel || typeof channel !== 'object') continue;
    const record = channel as { _id?: unknown; channel_type?: unknown };
    const id = stringValue(record._id, 64);
    const type = stringValue(record.channel_type, 32);
    if (id && type) types[id] = type;
  }
  return types;
}

export function normalizeRevoltMessage(
  event: RevoltMessageEvent,
  account: ChatAccountContext,
  channelTypes: Record<string, string>,
  receivedAt: number,
): ChatPlatformMessage | null {
  const author = event.author as RevoltAuthor | undefined;
  const authorId = stringValue(author?._id, 64);
  if (!authorId || authorId === account.appId || author?.bot) return null;

  const channelId = stringValue(event.channel, 64);
  const text = stringValue(event.content, 4000);
  if (!channelId || !text) return null;

  const channelType = channelTypes[channelId] ?? '';
  const direct = channelType === 'DirectMessage' || channelType === 'Group';
  const mentions = Array.isArray(event.mentions)
    ? event.mentions.some((mention) => mention === account.appId || (mention && typeof mention === 'object' && (mention as { _id?: unknown })._id === account.appId))
    : false;
  const messageId = stringValue(event._id, 64) || `${receivedAt}`;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: channelId,
    userId: authorId,
    ...(stringValue(author?.username, 128) ? { userName: stringValue(author?.username, 128) } : {}),
    text,
    mentionsBot: direct || mentions,
    receivedAt,
    eventId: `revolt:${messageId}`,
    eventType: direct ? 'revolt.direct' : 'revolt.channel',
    conversationType: direct ? 'private' : 'group',
  };
}
