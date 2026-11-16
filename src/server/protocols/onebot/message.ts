import type { ChatAccountContext, ChatAttachment, ChatPlatformMessage } from '../types';

export interface OneBotSegment {
  type?: unknown;
  data?: Record<string, unknown>;
}

export interface OneBotPayload {
  time?: unknown;
  self_id?: unknown;
  post_type?: unknown;
  message_type?: unknown;
  sub_type?: unknown;
  message_id?: unknown;
  group_id?: unknown;
  user_id?: unknown;
  message?: unknown;
  raw_message?: unknown;
  message_format?: unknown;
  sender?: { user_id?: unknown; nickname?: unknown; card?: unknown };
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function unescapeCq(value: string): string {
  return value
    .replaceAll('&#91;', '[')
    .replaceAll('&#93;', ']')
    .replaceAll('&#44;', ',')
    .replaceAll('&amp;', '&');
}

function parseCqParameters(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of value.split(',')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index < 1) continue;
    result[pair.slice(0, index)] = unescapeCq(pair.slice(index + 1));
  }
  return result;
}

function secureAttachment(value: unknown, type: ChatAttachment['type'], filename?: string): ChatAttachment | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const contentType = type === 'image' ? 'image/*' : type === 'audio' ? 'audio/*' : type === 'video' ? 'video/*' : 'application/octet-stream';
  return {
    url: url.toString(), type, contentType,
    ...(filename && filename.length <= 256 ? { filename } : {}),
  };
}

export interface OneBotMessageContent {
  text: string;
  mentionsBot: boolean;
  attachments: ChatAttachment[];
}

/** Accepts both array-format and CQ-code string-format OneBot messages. */
export function parseOneBotMessage(payload: OneBotPayload, selfId: string): OneBotMessageContent {
  let text = '';
  let mentionsBot = false;
  const attachments: ChatAttachment[] = [];

  const addText = (value: string): void => { text += value; };

  const addSegment = (type: string, data: Record<string, unknown>): void => {
    const field = (key: string): string => stringValue(data[key], 4096);
    switch (type) {
      case 'text':
        addText(field('text'));
        break;
      case 'at': {
        const target = field('qq');
        if (target === selfId) mentionsBot = true;
        else if (target === 'all') addText('@全体成员 ');
        else if (target) addText(`@${target} `);
        break;
      }
      case 'image':
      case 'record':
      case 'video':
      case 'file': {
        const kind = type === 'record' ? 'audio' : type;
        const attachment = secureAttachment(field('url') || field('file'), kind as ChatAttachment['type'], field('name') || field('file'));
        if (attachment) attachments.push(attachment);
        addText({ image: '[图片]', record: '[语音]', video: '[视频]', file: '[文件]' }[type] ?? '[文件]');
        break;
      }
      case 'face':
        addText('[表情]');
        break;
      case 'reply':
        break;
      case 'share':
      case 'json':
      case 'xml':
        addText('[卡片消息]');
        break;
      default:
        addText(`[${type || '未知消息'}]`);
    }
  };

  if (Array.isArray(payload.message)) {
    for (const entry of payload.message.slice(0, 100)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const segment = entry as OneBotSegment;
      const type = stringValue(segment.type, 64);
      const data = segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data) ? segment.data : {};
      addSegment(type, data);
    }
  } else {
    const raw = typeof payload.message === 'string' ? payload.message : typeof payload.raw_message === 'string' ? payload.raw_message : '';
    let index = 0;
    const pattern = /\[CQ:([A-Za-z0-9_.-]+)((?:,[^\]]*)?)\]/g;
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
      addText(unescapeCq(raw.slice(index, match.index)));
      addSegment(match[1], parseCqParameters(match[2].replace(/^,/, '')));
      index = match.index + match[0].length;
    }
    addText(unescapeCq(raw.slice(index)));
  }

  return { text: text.replaceAll(/\s{2,}/g, ' ').trim().slice(0, 16_384), mentionsBot, attachments: attachments.slice(0, 20) };
}

export function normalizeOneBotMessage(
  payload: OneBotPayload,
  account: ChatAccountContext,
  receivedAt: number,
): ChatPlatformMessage | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.post_type !== 'message') return null;
  const selfId = stringValue(payload.self_id, 64);
  if (!selfId) return null;
  const messageType = stringValue(payload.message_type, 32);
  if (messageType !== 'group' && messageType !== 'private' && messageType !== 'discuss') return null;

  const userId = stringValue(payload.user_id, 64);
  const groupId = messageType === 'private' ? userId : stringValue(payload.group_id, 64);
  const messageId = stringValue(payload.message_id, 512);
  if (!userId || !groupId || !messageId) return null;

  const content = parseOneBotMessage(payload, selfId);
  const conversationType = messageType === 'private' ? 'private' : 'group';
  const timestamp = typeof payload.time === 'number' && Number.isFinite(payload.time) ? payload.time * 1000 : receivedAt;

  return {
    id: messageId,
    accountId: account.account.id,
    botId: selfId,
    groupId,
    userId,
    ...(stringValue(payload.sender?.card, 128) || stringValue(payload.sender?.nickname, 128)
      ? { userName: stringValue(payload.sender?.card, 128) || stringValue(payload.sender?.nickname, 128) }
      : {}),
    text: content.text,
    mentionsBot: conversationType === 'private' || content.mentionsBot,
    receivedAt: timestamp,
    eventId: `${selfId}:${messageId}:${stringValue(payload.time, 20)}`,
    eventType: `onebot.${messageType}`,
    conversationType,
    ...(content.attachments.length ? { attachments: content.attachments } : {}),
  };
}
