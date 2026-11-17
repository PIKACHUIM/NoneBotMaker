import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface LineWebhookPayload {
  destination?: unknown;
  events?: LineEvent[];
}

interface LineEvent {
  type?: unknown;
  timestamp?: unknown;
  webhookEventId?: unknown;
  replyToken?: unknown;
  source?: { type?: unknown; userId?: unknown; groupId?: unknown; roomId?: unknown };
  message?: { id?: unknown; type?: unknown; text?: unknown };
}

const PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  video: '[视频]',
  audio: '[音频]',
  file: '[文件]',
  location: '[位置]',
  sticker: '[表情]',
};

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeLineEvent(
  event: LineEvent,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!event || event.type !== 'message') return null;
  const message = event.message;
  if (!message || typeof message !== 'object') return null;
  const source = event.source ?? {};
  const sourceType = stringValue(source.type, 32);
  const userId = stringValue(source.userId, 64);
  if (!userId) return null;
  const conversationId = sourceType === 'group'
    ? stringValue(source.groupId, 128)
    : sourceType === 'room'
      ? stringValue(source.roomId, 128)
      : userId;
  if (!conversationId) return null;

  const messageType = stringValue(message.type, 32) || 'text';
  let text = stringValue(message.text, 16_384) || PLACEHOLDERS[messageType] || '[消息]';
  const conversationType = sourceType === 'user' ? 'private' : 'group';
  const mentioned = conversationType === 'group' && text.includes('@');
  if (mentioned) text = text.replace(/^@\S+\s+/, '').trim();

  const messageId = stringValue(message.id, 64) || stringValue(event.webhookEventId, 128);
  if (!messageId) return null;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: conversationId,
    userId,
    text: text.slice(0, 16_384),
    mentionsBot: conversationType === 'private' || mentioned,
    receivedAt: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : receivedAt,
    ...(event.webhookEventId ? { eventId: `line:${stringValue(event.webhookEventId, 128)}` } : {}),
    eventType: `line.${sourceType || 'unknown'}`,
    conversationType,
    ...(event.replyToken ? { replyToken: stringValue(event.replyToken, 256) } : {}),
  };
}
