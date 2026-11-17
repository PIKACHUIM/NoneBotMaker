import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface MessengerEvent {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    attachments?: unknown;
  };
}

export interface MessengerEntry {
  id?: unknown;
  time?: unknown;
  messaging?: unknown;
}

export interface MessengerPayload {
  object?: unknown;
  entry?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function attachmentType(value: unknown): ChatAttachment['type'] {
  return value === 'image' || value === 'audio' || value === 'video' ? value : 'file';
}

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ChatAttachment[] = [];
  for (const item of value.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { type?: unknown; payload?: { url?: unknown } };
    const url = stringValue(record.payload?.url, 2048);
    if (!/^https?:\/\//i.test(url)) continue;
    attachments.push({ url, type: attachmentType(record.type) });
  }
  return attachments;
}

export function normalizeMessengerEvent(
  event: MessengerEvent,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const senderId = stringValue(event.sender?.id, 64);
  if (!senderId) return null;
  if (event.message?.is_echo === true) return null;

  const messageId = stringValue(event.message?.mid, 128) || `${receivedAt}`;
  const attachments = normalizeAttachments(event.message?.attachments);
  const text = stringValue(event.message?.text, 8000) || (attachments.length ? '[附件]' : '');
  if (!text) return null;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: senderId,
    userId: senderId,
    text,
    mentionsBot: true,
    receivedAt: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : receivedAt,
    eventId: `messenger:${messageId}`,
    eventType: 'messenger.message',
    conversationType: 'private',
    ...(attachments.length ? { attachments } : {}),
  };
}
