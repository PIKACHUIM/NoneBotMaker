import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface MisskeyNote {
  id?: unknown;
  createdAt?: unknown;
  userId?: unknown;
  text?: unknown;
  cw?: unknown;
  visibility?: unknown;
  channelId?: unknown;
  replyId?: unknown;
  renoteId?: unknown;
  mentions?: unknown;
  reply?: { userId?: unknown };
  renote?: unknown;
  user?: { id?: unknown; username?: unknown; name?: unknown };
  files?: Array<{ url?: unknown; type?: unknown; name?: unknown }>;
}

export interface MisskeyFrame {
  type?: unknown;
  body?: { type?: unknown; body?: MisskeyNote | unknown };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function attachments(files: MisskeyNote['files']): ChatAttachment[] {
  if (!Array.isArray(files)) return [];
  const result: ChatAttachment[] = [];
  for (const file of files.slice(0, 10)) {
    const url = stringValue(file?.url, 2048);
    if (!/^https?:\/\//i.test(url)) continue;
    const contentType = stringValue(file?.type, 128);
    const type = contentType.startsWith('image/') ? 'image'
      : contentType.startsWith('audio/') ? 'audio'
        : contentType.startsWith('video/') ? 'video' : 'file';
    result.push({ url, type, contentType: contentType || undefined, filename: stringValue(file?.name, 128) || undefined });
  }
  return result;
}

export function normalizeMisskeyNote(
  note: MisskeyNote,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (note.renote && !note.text) return null;
  const authorId = stringValue(note.userId, 64);
  if (!authorId || authorId === account.appId) return null;

  const media = attachments(note.files);
  const text = [stringValue(note.cw, 512), stringValue(note.text, 8000)].filter(Boolean).join('\n\n')
    || (media.length ? '[附件]' : '');
  if (!text) return null;

  const channelId = stringValue(note.channelId, 64);
  const direct = note.visibility === 'specified';
  const mentions = Array.isArray(note.mentions)
    ? note.mentions.some((mention) => mention === account.appId || (mention && typeof mention === 'object' && (mention as { id?: unknown }).id === account.appId))
    : false;
  const replyToBot = stringValue(note.reply?.userId, 64) === account.appId;
  const messageId = stringValue(note.id, 64) || `${receivedAt}`;
  const createdAt = typeof note.createdAt === 'string' ? Date.parse(note.createdAt) : NaN;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: channelId ? `channel:${channelId}` : `user:${authorId}`,
    userId: authorId,
    ...(stringValue(note.user?.name || note.user?.username, 128) ? { userName: stringValue(note.user?.name || note.user?.username, 128) } : {}),
    text,
    mentionsBot: direct || mentions || replyToBot,
    receivedAt: Number.isFinite(createdAt) ? createdAt : receivedAt,
    eventId: `misskey:${messageId}`,
    eventType: direct ? 'misskey.direct' : 'misskey.note',
    conversationType: direct ? 'private' : 'group',
    ...(media.length ? { attachments: media } : {}),
  };
}
