import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface ViberPayload {
  event?: unknown;
  timestamp?: unknown;
  message_token?: unknown;
  sender?: { id?: unknown; name?: unknown };
  message?: {
    type?: unknown;
    text?: unknown;
    media?: unknown;
    file_name?: unknown;
  };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function attachment(message: ViberPayload['message']): ChatAttachment[] {
  const url = stringValue(message?.media, 2048);
  if (!/^https?:\/\//i.test(url)) return [];
  const type = message?.type === 'picture' ? 'image' : message?.type === 'video' ? 'video' : 'file';
  return [{ url, type, filename: stringValue(message?.file_name, 128) || undefined }];
}

export function normalizeViberMessage(
  payload: ViberPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (payload.event !== 'message') return null;
  const senderId = stringValue(payload.sender?.id, 64);
  if (!senderId) return null;

  const media = attachment(payload.message);
  const text = stringValue(payload.message?.text, 8000) || (media.length ? '[附件]' : '');
  if (!text) return null;

  const messageId = stringValue(payload.message_token, 64) || `${receivedAt}`;
  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: senderId,
    userId: senderId,
    ...(stringValue(payload.sender?.name, 128) ? { userName: stringValue(payload.sender?.name, 128) } : {}),
    text,
    mentionsBot: true,
    receivedAt: typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) ? payload.timestamp : receivedAt,
    eventId: `viber:${messageId}`,
    eventType: 'viber.message',
    conversationType: 'private',
    ...(media.length ? { attachments: media } : {}),
  };
}
