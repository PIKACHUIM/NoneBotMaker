import type { ChatAccountContext } from './types';
import type { OutboundMedia, ReplyOptions } from '../plugins/chatbot/handler';
import { replyToQQGroup, replyToQQMessage, sendQQMedia } from './qq/api';
import { sendFeishuMedia, sendFeishuText } from './feishu/api';
import { sendDingTalkMedia, sendDingTalkProactiveText, sendDingTalkText } from './dingtalk/api';
import { sendWeChatMedia, sendWeChatText } from './wechat/api';
import { sendOneBotMedia, sendOneBotProactiveText, sendOneBotText } from './onebot/api';
import { sendTelegramMedia, sendTelegramProactiveText, sendTelegramText } from './telegram/api';

export function unsupportedProtocol(protocol: string): Error {
  return new Error(`Unsupported chat protocol: ${protocol}`);
}

/** Replies through the protocol that delivered the message. */
export async function sendChatText(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  content: string,
  options: ReplyOptions,
): Promise<void> {
  switch (account.protocol) {
    case 'qq':
      return replyToQQMessage(account, targetId, messageId, content, options);
    case 'feishu':
      return sendFeishuText(account, targetId, content, options);
    case 'dingtalk':
      return sendDingTalkText(account, targetId, messageId, content, options);
    case 'wechat':
      return sendWeChatText(account, targetId, content, options);
    case 'onebot':
      return sendOneBotText(account, targetId, messageId, content, options);
    case 'telegram':
      return sendTelegramText(account, targetId, messageId, content, options);
    default:
      throw unsupportedProtocol(account.protocol);
  }
}

export async function sendChatMedia(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
): Promise<void> {
  switch (account.protocol) {
    case 'qq':
      return sendQQMedia(account, targetId, messageId, media, options);
    case 'feishu':
      return sendFeishuMedia(account, targetId, messageId, media, options);
    case 'dingtalk':
      return sendDingTalkMedia(account, targetId, messageId, media, options);
    case 'wechat':
      return sendWeChatMedia(account, targetId, messageId, media, options);
    case 'onebot':
      return sendOneBotMedia(account, targetId, messageId, media, options);
    case 'telegram':
      return sendTelegramMedia(account, targetId, messageId, media, options);
    default:
      throw unsupportedProtocol(account.protocol);
  }
}

/** Sends text without an inbound message, used by schedules and extensions. */
export async function sendProactiveChatText(
  account: ChatAccountContext,
  targetId: string,
  conversationType: 'group' | 'private',
  content: string,
  seq = 1,
): Promise<void> {
  switch (account.protocol) {
    case 'qq':
      return replyToQQGroup(account, targetId, '', content, fetch, seq, conversationType, true);
    case 'feishu':
      return sendFeishuText(account, targetId, content, { seq: 1, conversationType });
    case 'dingtalk':
      return sendDingTalkProactiveText(account, targetId, conversationType, content);
    case 'wechat':
      return sendWeChatText(account, targetId, content, { seq: 1, conversationType });
    case 'onebot':
      return sendOneBotProactiveText(account, targetId, conversationType, content);
    case 'telegram':
      return sendTelegramProactiveText(account, targetId, content);
    default:
      throw unsupportedProtocol(account.protocol);
  }
}
