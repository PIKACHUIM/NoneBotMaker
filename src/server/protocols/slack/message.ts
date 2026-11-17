import type { ChatAccountContext, ChatPlatformMessage } from '../types';

interface SlackFile {
  name?: unknown;
  mimetype?: unknown;
}

interface SlackEvent {
  type?: unknown;
  subtype?: unknown;
  channel?: unknown;
  channel_type?: unknown;
  user?: unknown;
  text?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
  bot_id?: unknown;
  files?: SlackFile[];
}

export interface SlackEventPayload {
  type?: unknown;
  challenge?: unknown;
  api_app_id?: unknown;
  event?: SlackEvent;
  event_id?: unknown;
  event_time?: unknown;
  authorizations?: Array<{ user_id?: unknown; is_bot?: unknown }>;
}

const IGNORED_SUBTYPES = new Set([
  'bot_message',
  'message_changed',
  'message_deleted',
  'message_replied',
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'pinned_item',
  'unpinned_item',
]);

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

/** Converts Slack mrkdwn escapes and link syntax into readable plain text. */
export function decodeSlackText(value: string): string {
  return value
    .replace(/<https?:\/\/[^>|]+\|([^>]+)>/g, '$1')
    .replace(/<https?:\/\/([^>]+)>/g, '$1')
    .replace(/<!([^>|]+)\|([^>]+)>/g, '@$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function slackBotUserId(payload: SlackEventPayload): string {
  const entry = Array.isArray(payload.authorizations) ? payload.authorizations.find((item) => item.is_bot === true) : undefined;
  return stringValue(entry?.user_id, 64);
}

export function normalizeSlackEvent(
  payload: SlackEventPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const event = payload.event;
  if (!event || typeof event !== 'object') return null;
  if (event.type !== 'message') return null;
  const subtype = stringValue(event.subtype, 64);
  if (subtype && IGNORED_SUBTYPES.has(subtype)) return null;
  if (event.bot_id) return null;

  const channelId = stringValue(event.channel, 64);
  const userId = stringValue(event.user, 64);
  const messageId = stringValue(event.ts, 64);
  if (!channelId || !userId || !messageId) return null;

  const botUserId = slackBotUserId(payload);
  const channelType = stringValue(event.channel_type, 32);
  const conversationType = channelType === 'im' ? 'private' : 'group';

  let text = decodeSlackText(stringValue(event.text, 16_384));
  const hasFiles = Array.isArray(event.files) && event.files.length > 0;
  const mentioned = botUserId ? text.includes(`<@${botUserId}>`) : false;
  if (botUserId) text = text.replaceAll(`<@${botUserId}>`, ' ');
  text = text.replaceAll(/\s{2,}/g, ' ').trim();
  if (!text && hasFiles) text = '[文件]';

  return {
    id: messageId,
    accountId: account.account.id,
    botId: botUserId || account.appId,
    groupId: channelId,
    userId,
    text: text.slice(0, 16_384),
    mentionsBot: conversationType === 'private' || mentioned,
    receivedAt: typeof payload.event_time === 'number' && Number.isFinite(payload.event_time) ? payload.event_time * 1000 : receivedAt,
    ...(payload.event_id ? { eventId: `slack:${stringValue(payload.event_id, 128)}` } : {}),
    eventType: `slack.${channelType || 'channel'}`,
    conversationType,
  };
}
