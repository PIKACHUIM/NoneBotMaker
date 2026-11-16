import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { isSafeSessionWebhook } from './api';

export interface DingTalkPayload {
  msgtype?: unknown;
  text?: { content?: unknown };
  content?: unknown;
  conversationId?: unknown;
  conversationType?: unknown;
  senderStaffId?: unknown;
  senderId?: unknown;
  senderNick?: unknown;
  msgId?: unknown;
  createAt?: unknown;
  sessionWebhook?: unknown;
  isInAtList?: unknown;
  robotCode?: unknown;
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

const PLACEHOLDERS: Record<string, string> = {
  picture: '[图片]',
  audio: '[语音]',
  video: '[视频]',
  file: '[文件]',
  richText: '[富文本消息]',
};

export function normalizeDingTalkMessage(
  payload: DingTalkPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const conversationId = trimmed(payload.conversationId, 512);
  const userId = trimmed(payload.senderStaffId, 512) || trimmed(payload.senderId, 512);
  const messageId = trimmed(payload.msgId, 512);
  if (!conversationId || !userId || !messageId) return null;

  const messageType = trimmed(payload.msgtype, 64) || 'text';
  const text = (messageType === 'text' && typeof payload.text?.content === 'string'
    ? payload.text.content
    : PLACEHOLDERS[messageType] ?? `[${messageType}]`).replaceAll(/\s{2,}/g, ' ').trim().slice(0, 16_384);
  const conversationType = String(payload.conversationType ?? '2') === '1' ? 'private' : 'group';
  const sessionWebhook = trimmed(payload.sessionWebhook, 2048);
  const createAt = typeof payload.createAt === 'number' && Number.isFinite(payload.createAt) ? payload.createAt : receivedAt;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    // Direct chats use the staff ID so schedules and private allowlists share one identifier.
    groupId: conversationType === 'private' ? userId : conversationId,
    userId,
    ...(typeof payload.senderNick === 'string' ? { userName: payload.senderNick.slice(0, 128) } : {}),
    text,
    mentionsBot: conversationType === 'private' || payload.isInAtList === true,
    receivedAt: createAt,
    eventId: messageId,
    eventType: `dingtalk.${messageType}`,
    conversationType,
    ...(sessionWebhook && isSafeSessionWebhook(sessionWebhook) ? { replyToken: sessionWebhook } : {}),
  };
}
