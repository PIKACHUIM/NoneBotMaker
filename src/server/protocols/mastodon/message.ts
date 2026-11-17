import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface MastodonStatus {
  id?: unknown;
  in_reply_to_id?: unknown;
  in_reply_to_account_id?: unknown;
  content?: unknown;
  spoiler_text?: unknown;
  visibility?: unknown;
  account?: { id?: unknown; acct?: unknown; display_name?: unknown; username?: unknown };
  mentions?: Array<{ id?: unknown; acct?: unknown }>;
  media_attachments?: Array<{ id?: unknown; type?: unknown; url?: unknown; description?: unknown }>;
  reblog?: unknown;
  created_at?: unknown;
}

export interface MastodonStreamEvent {
  event?: unknown;
  payload?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function mastodonText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ChatAttachment[] = [];
  for (const item of value.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { type?: unknown; url?: unknown; description?: unknown };
    const url = stringValue(record.url, 2048);
    if (!/^https?:\/\//i.test(url)) continue;
    const type = record.type === 'image' || record.type === 'audio' || record.type === 'video' ? record.type : 'file';
    attachments.push({ url, type, filename: stringValue(record.description, 128) || undefined });
  }
  return attachments;
}

export function normalizeMastodonStatus(
  status: MastodonStatus,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (status.reblog) return null;
  const authorId = stringValue(status.account?.id, 32);
  if (!authorId || authorId === account.appId) return null;

  const content = mastodonText(stringValue(status.content, 20_000));
  const spoiler = stringValue(status.spoiler_text, 512);
  const attachments = normalizeAttachments(status.media_attachments);
  const text = [spoiler, content].filter(Boolean).join('\n\n') || (attachments.length ? '[附件]' : '');
  if (!text) return null;

  const direct = status.visibility === 'direct';
  const mentioned = Array.isArray(status.mentions)
    ? status.mentions.some((mention) => stringValue(mention.id, 32) === account.appId)
    : false;
  const replyToBot = stringValue(status.in_reply_to_account_id, 32) === account.appId;
  const acct = stringValue(status.account?.acct, 128) || authorId;
  const messageId = stringValue(status.id, 64) || `${receivedAt}`;
  const createdAt = typeof status.created_at === 'string' ? Date.parse(status.created_at) : NaN;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: `acct:${acct}`,
    userId: acct,
    ...(stringValue(status.account?.display_name, 128) ? { userName: stringValue(status.account?.display_name, 128) } : {}),
    text,
    mentionsBot: direct || mentioned || replyToBot,
    receivedAt: Number.isFinite(createdAt) ? createdAt : receivedAt,
    eventId: `mastodon:${messageId}`,
    eventType: direct ? 'mastodon.direct' : 'mastodon.mention',
    conversationType: direct ? 'private' : 'group',
    ...(attachments.length ? { attachments } : {}),
  };
}
