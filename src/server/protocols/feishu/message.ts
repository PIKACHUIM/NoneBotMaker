import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface FeishuPayload {
  encrypt?: unknown;
  type?: unknown;
  challenge?: unknown;
  token?: unknown;
  header?: {
    event_id?: unknown;
    event_type?: unknown;
    app_id?: unknown;
    token?: unknown;
    create_time?: unknown;
  };
  event?: unknown;
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function parseTextContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

const PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  file: '[文件]',
  audio: '[语音]',
  media: '[视频]',
  sticker: '[表情]',
  post: '[富文本消息]',
};

/** Converts an im.message.receive_v1 event into the shared conversation message. */
export function normalizeFeishuMessage(
  payload: FeishuPayload,
  account: ChatAccountContext,
  receivedAt: number,
  botOpenId = '',
): ChatPlatformMessage | null {
  if (payload.header?.event_type !== 'im.message.receive_v1') return null;
  const event = payload.event as {
    sender?: { sender_id?: { open_id?: unknown }; sender_type?: unknown };
    message?: {
      message_id?: unknown;
      chat_id?: unknown;
      chat_type?: unknown;
      message_type?: unknown;
      content?: unknown;
      create_time?: unknown;
      mentions?: unknown;
    };
  } | null;
  if (!event || typeof event !== 'object' || !event.message) return null;
  if (event.sender?.sender_type !== 'user') return null;

  const message = event.message;
  const messageId = trimmed(message.message_id, 512);
  const chatId = trimmed(message.chat_id, 512);
  const userId = trimmed(event.sender?.sender_id?.open_id, 512);
  if (!messageId || !chatId || !userId) return null;

  const messageType = trimmed(message.message_type, 64) || 'text';
  const rawText = messageType === 'text' ? parseTextContent(message.content) : PLACEHOLDERS[messageType] ?? `[${messageType}]`;
  const text = rawText.replaceAll(/@_user_\d+/g, '').replaceAll(/\s{2,}/g, ' ').trim().slice(0, 16_384);
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const mentionsBot = trimmed(message.chat_type, 16) === 'p2p' || mentions.some((mention) =>
    typeof mention === 'object' && mention !== null &&
    (mention as { id?: { open_id?: unknown } }).id?.open_id === botOpenId) ||
    (!botOpenId && mentions.length > 0);
  const createTime = message.create_time;
  const timestamp = typeof createTime === 'string' && /^\d{1,16}$/.test(createTime)
    ? Number(createTime)
    : typeof createTime === 'number' && Number.isFinite(createTime) ? createTime : receivedAt;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: chatId,
    userId,
    text,
    mentionsBot,
    receivedAt: timestamp,
    ...(typeof payload.header?.event_id === 'string' ? { eventId: payload.header.event_id.slice(0, 512) } : {}),
    eventType: 'im.message.receive_v1',
    conversationType: trimmed(message.chat_type, 16) === 'p2p' ? 'private' : 'group',
  };
}
