import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface VkMessage {
  id?: unknown;
  date?: unknown;
  peer_id?: unknown;
  from_id?: unknown;
  text?: unknown;
  attachments?: unknown;
}

export interface VkPayload {
  type?: unknown;
  group_id?: unknown;
  secret?: unknown;
  object?: {
    message?: VkMessage;
  };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ChatAttachment[] = [];
  for (const item of value.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = stringValue(record.type, 32);
    if (type === 'photo') {
      const photo = record.photo as { sizes?: Array<{ url?: unknown; width?: unknown; height?: unknown }> } | undefined;
      const sizes = Array.isArray(photo?.sizes) ? photo!.sizes : [];
      const largest = [...sizes].sort((left, right) => Number(right.width ?? 0) - Number(left.width ?? 0))[0];
      const url = stringValue(largest?.url, 2048);
      if (/^https?:\/\//i.test(url)) attachments.push({ url, type: 'image', width: Number(largest?.width ?? 0) || undefined, height: Number(largest?.height ?? 0) || undefined });
      continue;
    }
    if (type === 'doc') {
      const doc = record.doc as { url?: unknown; title?: unknown } | undefined;
      const url = stringValue(doc?.url, 2048);
      if (/^https?:\/\//i.test(url)) attachments.push({ url, type: 'file', filename: stringValue(doc?.title, 128) || undefined });
      continue;
    }
    if (type === 'audio_message') {
      const audio = record.audio_message as { link_mp3?: unknown } | undefined;
      const url = stringValue(audio?.link_mp3, 2048);
      if (/^https?:\/\//i.test(url)) attachments.push({ url, type: 'audio' });
    }
  }
  return attachments;
}

export function normalizeVkMessage(
  payload: VkPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  const message = payload.object?.message;
  if (!message) return null;
  const peerId = stringValue(message.peer_id, 32);
  const fromId = stringValue(message.from_id, 32);
  if (!peerId || !fromId || fromId === account.appId) return null;

  const attachments = normalizeAttachments(message.attachments);
  const text = stringValue(message.text, 8000) || (attachments.length ? '[附件]' : '');
  if (!text) return null;

  const group = Number(peerId) >= 2_000_000_000;
  const messageId = stringValue(message.id, 64) || `${receivedAt}`;
  return {
    id: messageId,
    accountId: account.account.id,
    botId: account.appId,
    groupId: peerId,
    userId: fromId,
    text,
    mentionsBot: true,
    receivedAt: typeof message.date === 'number' && Number.isFinite(message.date) ? message.date * 1000 : receivedAt,
    eventId: `vk:${messageId}`,
    eventType: group ? 'vk.chat' : 'vk.private',
    conversationType: group ? 'group' : 'private',
    ...(attachments.length ? { attachments } : {}),
  };
}
