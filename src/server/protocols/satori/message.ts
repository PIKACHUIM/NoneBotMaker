import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface SatoriSignal {
  op?: unknown;
  body?: unknown;
  sn?: unknown;
}

export interface SatoriEvent {
  id?: unknown;
  type?: unknown;
  platform?: unknown;
  self_id?: unknown;
  timestamp?: unknown;
  channel?: { id?: unknown; type?: unknown };
  user?: { id?: unknown; name?: unknown; nick?: unknown };
  message?: { id?: unknown; content?: unknown; user?: { id?: unknown; name?: unknown } };
  guild?: { id?: unknown };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

const AT_TAG = /<at\b[^>]*\/>/g;

export function normalizeSatoriEvent(
  event: SatoriEvent,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!event || event.type !== 'message-created') return null;
  const message = event.message;
  if (!message || typeof message !== 'object') return null;
  const channelId = stringValue(event.channel?.id, 128);
  const messageId = stringValue(message.id, 128);
  const userId = stringValue(event.user?.id, 64) || stringValue(message.user?.id, 64);
  if (!channelId || !messageId || !userId) return null;

  const selfId = stringValue(event.self_id, 64) || stringValue(account.credentials.selfId, 64) || account.appId;
  const raw = stringValue(message.content, 16_384);
  const channelType = typeof event.channel?.type === 'number' ? event.channel.type : 0;
  const conversationType = channelType === 1 ? 'private' : 'group';
  const mentioned = raw.includes(`<at id="${selfId}"`) || /<at\b[^>]*\bname=/.test(raw);
  const text = raw.replace(AT_TAG, ' ').replaceAll(/\s{2,}/g, ' ').trim();
  if (!text) return null;

  const name = stringValue(event.user?.nick, 64) || stringValue(event.user?.name, 64) || stringValue(message.user?.name, 64);
  const timestamp = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? (event.timestamp < 1_000_000_000_000 ? event.timestamp * 1000 : event.timestamp)
    : receivedAt;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: selfId,
    groupId: channelId,
    userId,
    ...(name ? { userName: name } : {}),
    text: text.slice(0, 16_384),
    mentionsBot: conversationType === 'private' || mentioned,
    receivedAt: timestamp,
    eventId: `satori:${messageId}`,
    eventType: 'satori.message-created',
    conversationType,
  };
}
