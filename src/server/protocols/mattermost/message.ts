import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface MattermostWebhookPayload {
  token?: unknown;
  team_id?: unknown;
  channel_id?: unknown;
  channel_name?: unknown;
  user_id?: unknown;
  user_name?: unknown;
  post_id?: unknown;
  text?: unknown;
  trigger_word?: unknown;
  file_ids?: unknown;
  timestamp?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export function normalizeMattermostPost(
  payload: MattermostWebhookPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const channelId = stringValue(payload.channel_id, 64);
  const userId = stringValue(payload.user_id, 64);
  if (!channelId || !userId) return null;

  const trigger = stringValue(payload.trigger_word, 64);
  let text = stringValue(payload.text, 16_384);
  if (trigger && text.toLowerCase().startsWith(trigger.toLowerCase())) {
    text = text.slice(trigger.length).trim();
  }
  const hasFiles = Array.isArray(payload.file_ids) && payload.file_ids.length > 0;
  if (!text && hasFiles) text = '[文件]';

  const messageId = stringValue(payload.post_id, 64) || `${receivedAt}`;
  const name = stringValue(payload.user_name, 128);
  const channelName = stringValue(payload.channel_name, 128);

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: channelId,
    userId,
    ...(name ? { userName: name } : {}),
    text: text.slice(0, 16_384),
    mentionsBot: true,
    receivedAt: typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp) ? payload.timestamp : receivedAt,
    eventId: `mattermost:${messageId}`,
    eventType: channelName === 'direct-messages' ? 'mattermost.direct' : 'mattermost.channel',
    conversationType: channelName === 'direct-messages' ? 'private' : 'group',
  };
}
