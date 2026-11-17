import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface ZulipMessage {
  id?: unknown;
  sender_id?: unknown;
  sender_email?: unknown;
  sender_full_name?: unknown;
  type?: unknown;
  stream_id?: unknown;
  display_recipient?: unknown;
  subject?: unknown;
  content?: unknown;
  timestamp?: unknown;
}

export interface ZulipPayload {
  token?: unknown;
  data?: unknown;
  message?: ZulipMessage | string;
  bot_email?: unknown;
  trigger?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeZulipMessage(
  payload: ZulipPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const message = typeof payload.message === 'string'
    ? (() => { try { return JSON.parse(payload.message as string) as ZulipMessage; } catch { return null; } })()
    : payload.message;
  if (!message) return null;
  const senderId = stringValue(message.sender_id, 32);
  if (!senderId) return null;

  const text = stringValue(payload.data, 8000) || stringValue(message.content, 8000);
  if (!text) return null;

  const stream = message.type === 'stream';
  const streamId = stringValue(message.stream_id, 32);
  const topic = stringValue(message.subject, 256);
  const groupId = stream ? `stream:${streamId}:${topic}` : `dm:${senderId}`;
  const messageId = stringValue(message.id, 64) || `${receivedAt}`;
  const senderName = stringValue(message.sender_full_name, 128);

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId,
    userId: senderId,
    ...(senderName ? { userName: senderName } : {}),
    text,
    mentionsBot: true,
    receivedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? message.timestamp * 1000 : receivedAt,
    eventId: `zulip:${messageId}`,
    eventType: stream ? 'zulip.stream' : 'zulip.private',
    conversationType: stream ? 'group' : 'private',
  };
}
