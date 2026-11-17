import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { xmlValue } from '../http';

const PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  voice: '[语音]',
  video: '[视频]',
  shortvideo: '[视频]',
  location: '[位置]',
  link: '[链接]',
  event: '[事件]',
};

function trim(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/**
 * Normalizes a decrypted WeCom application message. Agent messages are
 * one-to-one, so the sender user id doubles as the conversation id.
 */
export function normalizeWeComMessage(
  xml: string,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const userId = trim(xmlValue(xml, 'FromUserName'), 128);
  const msgType = trim(xmlValue(xml, 'MsgType'), 32).toLowerCase();
  const msgId = trim(xmlValue(xml, 'MsgId'), 128);
  const agentId = trim(xmlValue(xml, 'AgentID'), 32);
  if (!userId || !msgType) return null;
  const expectedAgent = typeof account.credentials.agentId === 'string' ? account.credentials.agentId : '';
  if (expectedAgent && agentId && agentId !== expectedAgent) return null;

  const text = msgType === 'text'
    ? trim(xmlValue(xml, 'Content'), 16_384)
    : PLACEHOLDERS[msgType] ?? '[消息]';
  if (!text) return null;

  const createTime = Number(xmlValue(xml, 'CreateTime'));
  return {
    id: msgId || `${userId}:${createTime || receivedAt}`,
    accountId: account.account.id,
    botId: expectedAgent || account.appId,
    groupId: userId,
    userId,
    text,
    mentionsBot: true,
    receivedAt: Number.isFinite(createTime) && createTime > 0 ? createTime * 1000 : receivedAt,
    ...(msgId ? { eventId: `wecom:${msgId}` } : {}),
    eventType: `wecom.${msgType}`,
    conversationType: 'private',
  };
}
