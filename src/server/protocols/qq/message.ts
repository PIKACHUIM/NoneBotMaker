import type { QQAccountContext, QQGroupMessage } from './types';

interface QQGroupEventPayload {
  id?: string;
  t?: string;
  d?: unknown;
}

export function normalizeQQGroupMessage(
  payload: QQGroupEventPayload,
  account: QQAccountContext,
  receivedAt: number,
): QQGroupMessage | null {
  if (payload.t !== 'GROUP_AT_MESSAGE_CREATE' && payload.t !== 'GROUP_MESSAGE_CREATE') return null;
  const data = payload.d as {
    id?: unknown;
    group_openid?: unknown;
    content?: unknown;
    author?: { member_openid?: unknown; id?: unknown; username?: unknown; bot?: unknown };
    mentions?: unknown;
  } | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.author?.bot === true) return null;

  const messageId = typeof data.id === 'string' ? data.id : '';
  const groupId = typeof data.group_openid === 'string' ? data.group_openid : '';
  const userId = typeof data.author?.member_openid === 'string'
    ? data.author.member_openid
    : typeof data.author?.id === 'string'
      ? data.author.id
      : '';
  const text = typeof data.content === 'string' ? data.content : '';
  if (!messageId || !groupId || !userId) return null;

  const mentionsBot =
    payload.t === 'GROUP_AT_MESSAGE_CREATE' ||
    (Array.isArray(data.mentions) &&
      data.mentions.some((mention) => typeof mention === 'object' && mention !== null && (mention as { id?: unknown }).id === account.appId)) ||
    text.includes(`<@!${account.appId}>`) ||
    text.includes(`<@${account.appId}>`);
  const cleanText = text
    .replaceAll(`<@!${account.appId}>`, '')
    .replaceAll(`<@${account.appId}>`, '')
    .trim();

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId,
    userId,
    ...(typeof data.author?.username === 'string' ? { userName: data.author.username } : {}),
    text: cleanText,
    mentionsBot,
    receivedAt,
    ...(typeof payload.id === 'string' ? { eventId: payload.id } : {}),
    eventType: payload.t,
  };
}
