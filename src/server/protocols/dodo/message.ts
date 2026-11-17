import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface DodoEventBody {
  islandSourceId?: unknown;
  channelId?: unknown;
  messageId?: unknown;
  messageType?: unknown;
  messageBody?: { content?: unknown; url?: unknown; name?: unknown };
  personal?: { dodoSourceId?: unknown; nickName?: unknown };
  member?: { nickname?: unknown };
  reference?: { messageId?: unknown };
}

export interface DodoEvent extends DodoEventBody {
  eventId?: unknown;
  eventType?: unknown;
  eventBody?: DodoEventBody;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function messageText(body: DodoEventBody): string {
  const content = stringValue(body.messageBody?.content, 4000);
  if (content) return content;
  const url = stringValue(body.messageBody?.url, 2048);
  if (!url) return '';
  const name = stringValue(body.messageBody?.name, 128);
  return name ? `[${name}](${url})` : url;
}

export function normalizeDodoEvent(
  event: DodoEvent,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const eventType = stringValue(event.eventType, 16);
  if (eventType !== '2001' && eventType !== '1001') return null;

  const body = event.eventBody ?? event;
  const personal = body.personal;
  const userId = stringValue(personal?.dodoSourceId, 64);
  const messageId = stringValue(body.messageId, 64) || `${receivedAt}`;
  const text = messageText(body);
  if (!userId || !text) return null;

  if (eventType === '2001') {
    const channelId = stringValue(body.channelId, 64);
    if (!channelId) return null;
    return {
      id: messageId,
      accountId: account.account.id,
      botId: account.appId,
      groupId: channelId,
      userId,
      text,
      mentionsBot: true,
      receivedAt,
      eventId: `dodo:${messageId}`,
      eventType: 'dodo.channel',
      conversationType: 'group',
    };
  }

  const islandId = stringValue(body.islandSourceId, 64);
  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: islandId ? `${islandId}|${userId}` : userId,
    userId,
    ...(stringValue(personal?.nickName, 128) ? { userName: stringValue(personal?.nickName, 128) } : {}),
    text,
    mentionsBot: true,
    receivedAt,
    eventId: `dodo:${messageId}`,
    eventType: 'dodo.private',
    conversationType: 'private',
  };
}
