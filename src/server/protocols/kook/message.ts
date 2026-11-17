import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface KookEvent {
  channel_type?: unknown;
  type?: unknown;
  target_id?: unknown;
  author_id?: unknown;
  content?: unknown;
  msg_id?: unknown;
  msg_timestamp?: unknown;
  extra?: {
    type?: unknown;
    mention?: unknown[];
    author?: { id?: unknown; username?: unknown; bot?: unknown };
  };
}

const PLACEHOLDERS: Record<number, string> = {
  2: '[图片]',
  3: '[视频]',
  4: '[文件]',
  8: '[语音]',
  10: '[卡片]',
};

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeKookEvent(
  event: KookEvent,
  account: ChatAccountContext,
  botId: string,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!event || typeof event !== 'object') return null;
  const type = typeof event.type === 'number' ? event.type : 0;
  if (type === 255) return null;
  const author = event.extra?.author;
  if (!author || author.bot === true) return null;
  const userId = stringValue(event.author_id, 64);
  const targetId = stringValue(event.target_id, 128);
  const messageId = stringValue(event.msg_id, 128);
  if (!userId || !targetId || !messageId) return null;
  if (botId && userId === botId) return null;

  const channelType = stringValue(event.channel_type, 16);
  const conversationType = channelType === 'PERSON' ? 'private' : 'group';
  const raw = stringValue(event.content, 16_384);
  const mentionList = Array.isArray(event.extra?.mention) ? event.extra.mention : [];
  const mentioned = mentionList.some((entry) => stringValue(entry, 64) === botId) ||
    (botId ? raw.includes(`(met)${botId}(met)`) : false);
  const text = (PLACEHOLDERS[type] ?? raw)
    .replace(/\(met\)[^()]*\(met\)/g, ' ')
    .replace(/\(rol\)[^()]*\(rol\)/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim();
  if (!text) return null;

  const name = stringValue(author.username, 64);
  return {
    id: messageId,
    accountId: account.account.id,
    botId: botId || account.appId,
    groupId: targetId,
    userId,
    ...(name ? { userName: name } : {}),
    text: text.slice(0, 16_384),
    mentionsBot: conversationType === 'private' || mentioned,
    receivedAt: typeof event.msg_timestamp === 'number' && Number.isFinite(event.msg_timestamp) ? event.msg_timestamp : receivedAt,
    eventId: `kook:${messageId}`,
    eventType: `kook.${channelType.toLowerCase() || 'group'}`,
    conversationType,
  };
}
