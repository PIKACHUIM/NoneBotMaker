import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface RocketChatPayload {
  token?: unknown;
  channel_id?: unknown;
  channel_name?: unknown;
  user_id?: unknown;
  user_name?: unknown;
  text?: unknown;
  timestamp?: unknown;
  bot?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeRocketChatMessage(
  payload: RocketChatPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (payload.bot === true) return null;
  const channelId = stringValue(payload.channel_id, 128);
  const userId = stringValue(payload.user_id, 128);
  if (!channelId || !userId) return null;
  if (userId === account.appId) return null;

  const text = stringValue(payload.text, 8000);
  if (!text) return null;
  const timestamp = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
  const messageId = `${channelId}:${userId}:${Number.isFinite(timestamp) ? timestamp : receivedAt}`;
  const userName = stringValue(payload.user_name, 128);

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: channelId,
    userId,
    ...(userName ? { userName } : {}),
    text,
    mentionsBot: true,
    receivedAt: Number.isFinite(timestamp) ? timestamp : receivedAt,
    eventId: `rocketchat:${messageId}`,
    eventType: 'rocketchat.message',
    conversationType: 'group',
  };
}
