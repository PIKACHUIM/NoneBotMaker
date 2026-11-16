import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { sha1Hex, safeEqual } from '../crypto';
import { xmlValue } from '../http';

/** WeChat verifies callbacks with SHA1 over the sorted token, timestamp and nonce. */
export async function verifyWeChatSignature(
  token: string,
  signature: string,
  timestamp: string,
  nonce: string,
): Promise<boolean> {
  if (!token || !signature || !/^\d{1,12}$/.test(timestamp) || !nonce) return false;
  return safeEqual(await sha1Hex([token, timestamp, nonce].sort().join('')), signature.toLowerCase());
}

const PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  voice: '[语音]',
  video: '[视频]',
  shortvideo: '[视频]',
  location: '[位置]',
  link: '[链接]',
  file: '[文件]',
};

export function normalizeWeChatMessage(
  xml: string,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const messageType = xmlValue(xml, 'MsgType').toLowerCase();
  if (!messageType) return null;
  // Events such as subscribe/unsubscribe carry no user text and are acknowledged only.
  if (messageType === 'event') return null;
  const userId = xmlValue(xml, 'FromUserName').slice(0, 512);
  if (!userId) return null;
  const createTime = xmlValue(xml, 'CreateTime');
  const timestamp = /^\d{1,12}$/.test(createTime) ? Number(createTime) * 1000 : receivedAt;
  const messageId = (xmlValue(xml, 'MsgId') || `${userId}:${createTime || receivedAt}`).slice(0, 512);
  const content = messageType === 'text' ? xmlValue(xml, 'Content') : PLACEHOLDERS[messageType] ?? `[${messageType}]`;
  const text = content.replaceAll(/\s{2,}/g, ' ').trim().slice(0, 16_384);

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: userId,
    userId,
    text,
    mentionsBot: true,
    receivedAt: timestamp,
    eventId: messageId,
    eventType: `wechat.${messageType}`,
    conversationType: 'private',
  };
}
