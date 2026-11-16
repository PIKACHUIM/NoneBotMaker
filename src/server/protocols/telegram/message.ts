import type { ChatAccountContext, ChatPlatformMessage } from '../types';

export interface TelegramUpdate {
  update_id?: unknown;
  message?: TelegramMessage;
  edited_message?: unknown;
}

interface TelegramMessage {
  message_id?: unknown;
  date?: unknown;
  text?: unknown;
  caption?: unknown;
  chat?: { id?: unknown; type?: unknown };
  from?: { id?: unknown; is_bot?: unknown; username?: unknown; first_name?: unknown; last_name?: unknown };
  entities?: Array<{ type?: unknown; user?: { id?: unknown; is_bot?: unknown; username?: unknown } }>;
  reply_to_message?: { from?: { id?: unknown; is_bot?: unknown } };
  photo?: unknown[];
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
  document?: unknown;
  sticker?: unknown;
  location?: unknown;
  contact?: unknown;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

const PLACEHOLDERS: Array<[keyof TelegramMessage, string]> = [
  ['photo', '[图片]'],
  ['voice', '[语音]'],
  ['audio', '[音频]'],
  ['video', '[视频]'],
  ['document', '[文件]'],
  ['sticker', '[表情]'],
  ['location', '[位置]'],
  ['contact', '[联系人]'],
];

export function normalizeTelegramMessage(
  update: TelegramUpdate,
  account: ChatAccountContext,
  receivedAt: number,
  bot: { id: string; username: string },
): ChatPlatformMessage | null {
  const message = update.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const chatId = stringValue(message.chat?.id, 64);
  const userId = stringValue(message.from?.id, 64);
  const messageId = stringValue(message.message_id, 64);
  if (!chatId || !userId || !messageId) return null;
  if (message.from?.is_bot === true) return null;
  if (bot.username && stringValue(message.from?.username, 64).toLowerCase() === bot.username.toLowerCase()) return null;

  const chatType = stringValue(message.chat?.type, 32);
  if (chatType === 'channel') return null;
  const conversationType = chatType === 'private' ? 'private' : 'group';
  let text = stringValue(message.text, 16_384) || stringValue(message.caption, 16_384);
  if (!text) text = PLACEHOLDERS.find(([key]) => message[key])?.[1] ?? '';

  const mention = bot.username ? new RegExp(`@${bot.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi') : null;
  const mentioned = mention ? mention.test(text) : false;
  const mentionsBot = conversationType === 'private' ||
    mentioned ||
    (Array.isArray(message.entities) && message.entities.some((entity) =>
      entity?.type === 'text_mention' && stringValue(entity.user?.id, 32) === bot.id)) ||
    stringValue(message.reply_to_message?.from?.id, 32) === bot.id;
  if (mention) {
    mention.lastIndex = 0;
    text = text.replace(mention, '');
  }
  text = text.replaceAll(/\s{2,}/g, ' ').trim().slice(0, 16_384);

  const author = message.from;
  const name = [stringValue(author?.first_name, 64), stringValue(author?.last_name, 64)].filter(Boolean).join(' ') ||
    stringValue(author?.username, 64);

  return {
    id: messageId,
    accountId: account.account.id,
    botId: bot.id || account.appId,
    groupId: chatId,
    userId,
    ...(name ? { userName: name } : {}),
    text,
    mentionsBot,
    receivedAt: typeof message.date === 'number' && Number.isFinite(message.date) ? message.date * 1000 : receivedAt,
    ...(typeof update.update_id === 'number' || typeof update.update_id === 'string'
      ? { eventId: `telegram:${String(update.update_id)}` } : {}),
    eventType: `telegram.${chatType || 'unknown'}`,
    conversationType,
  };
}
