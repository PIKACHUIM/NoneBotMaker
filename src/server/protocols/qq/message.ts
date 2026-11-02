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
  if (payload.t !== 'GROUP_AT_MESSAGE_CREATE' && payload.t !== 'GROUP_MESSAGE_CREATE' && payload.t !== 'C2C_MESSAGE_CREATE') return null;
  const isPrivate = payload.t === 'C2C_MESSAGE_CREATE';
  const data = payload.d as {
    id?: unknown;
    group_openid?: unknown;
    content?: unknown;
    author?: { member_openid?: unknown; user_openid?: unknown; id?: unknown; username?: unknown; bot?: unknown };
    mentions?: unknown;
    attachments?: unknown;
  } | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.author?.bot === true) return null;

  const messageId = typeof data.id === 'string' ? data.id : '';
  const userId = isPrivate && typeof data.author?.user_openid === 'string'
    ? data.author.user_openid
    : typeof data.author?.member_openid === 'string'
      ? data.author.member_openid
      : typeof data.author?.id === 'string' ? data.author.id : '';
  const groupId = isPrivate ? userId : typeof data.group_openid === 'string' ? data.group_openid : '';
  const text = typeof data.content === 'string' ? data.content.slice(0, 16_384) : '';
  if (!messageId || !groupId || !userId || messageId.length > 512 || groupId.length > 512 || userId.length > 512) return null;

  const mentionsBot =
    isPrivate || payload.t === 'GROUP_AT_MESSAGE_CREATE' ||
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
    conversationType: isPrivate ? 'private' : 'group',
    attachments: normalizeAttachments(data.attachments),
  };
}

function normalizeAttachments(value: unknown): NonNullable<QQGroupMessage['attachments']> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const attachment = entry as Record<string, unknown>;
    if (typeof attachment.url !== 'string' || attachment.url.length > 4096) return [];
    let url: URL;
    try { url = new URL(attachment.url.startsWith('//') ? `https:${attachment.url}` : attachment.url); }
    catch { return []; }
    if (url.protocol !== 'https:' || url.username || url.password) return [];
    const contentType = typeof attachment.content_type === 'string' ? attachment.content_type.slice(0, 100) : '';
    const kind = contentType.startsWith('image/') ? 'image' : contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('video/') ? 'video' : 'file';
    return [{
      url: url.toString(), type: kind,
      ...(contentType ? { contentType } : {}),
      ...(typeof attachment.filename === 'string' ? { filename: attachment.filename.slice(0, 256) } : {}),
      ...Object.fromEntries(['size', 'width', 'height'].flatMap((key) =>
        typeof attachment[key] === 'number' && Number.isFinite(attachment[key]) && attachment[key] >= 0 ? [[key, attachment[key]]] : [])),
    }];
  });
}
