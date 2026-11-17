import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface MatrixEvent {
  event_id?: unknown;
  sender?: unknown;
  origin_server_ts?: unknown;
  type?: unknown;
  content?: {
    msgtype?: unknown;
    body?: unknown;
    url?: unknown;
    filename?: unknown;
    info?: { mimetype?: unknown; size?: unknown };
    'm.mentions'?: { user_ids?: unknown };
    'm.relates_to'?: { 'm.in_reply_to'?: { event_id?: unknown } };
  };
  unsigned?: { age?: unknown };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function mediaKind(msgtype: string): 'image' | 'audio' | 'video' | 'file' {
  if (msgtype === 'm.image') return 'image';
  if (msgtype === 'm.audio') return 'audio';
  if (msgtype === 'm.video') return 'video';
  return 'file';
}

export function normalizeMatrixEvent(
  event: MatrixEvent,
  roomId: string,
  account: ChatAccountContext,
  receivedAt: number,
  direct: boolean,
): ChatPlatformMessage | null {
  if (event.type !== 'm.room.message') return null;
  const sender = stringValue(event.sender, 128);
  if (!sender || sender === account.appId) return null;

  const msgtype = stringValue(event.content?.msgtype, 32);
  const body = stringValue(event.content?.body, 8000);
  const mentionIds = event.content?.['m.mentions']?.user_ids;
  const mentioned = Array.isArray(mentionIds)
    ? mentionIds.some((id) => id === account.appId)
    : false;
  const replyTo = stringValue(event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id, 128);
  const text = body || (msgtype ? `[${mediaKind(msgtype)}]` : '');
  if (!text) return null;

  const messageId = stringValue(event.event_id, 128) || `${receivedAt}`;
  const timestamp = typeof event.origin_server_ts === 'number' && Number.isFinite(event.origin_server_ts)
    ? event.origin_server_ts
    : receivedAt;
  const attachment = msgtype && msgtype !== 'm.text' && msgtype !== 'm.notice'
    ? [{
        url: stringValue(event.content?.url, 2048),
        type: mediaKind(msgtype),
        filename: stringValue(event.content?.filename, 256) || undefined,
        contentType: stringValue(event.content?.info?.mimetype, 128) || undefined,
        size: Number(event.content?.info?.size ?? 0) || undefined,
      }].filter((item) => item.url)
    : [];

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: roomId,
    userId: sender,
    text,
    mentionsBot: direct || mentioned || body.includes(account.appId) || Boolean(replyTo),
    receivedAt: timestamp,
    eventId: `matrix:${messageId}`,
    eventType: direct ? 'matrix.direct' : 'matrix.room',
    conversationType: direct ? 'private' : 'group',
    ...(attachment.length ? { attachments: attachment } : {}),
  };
}
