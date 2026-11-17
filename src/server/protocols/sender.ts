import type { ChatAccountContext } from './types';
import type { OutboundMedia, ReplyOptions } from '../plugins/chatbot/handler';
import { replyToQQGroup, replyToQQMessage, sendQQMedia } from './qq/api';
import { sendFeishuMedia, sendFeishuText } from './feishu/api';
import { sendDingTalkMedia, sendDingTalkProactiveText, sendDingTalkText } from './dingtalk/api';
import { sendWeChatMedia, sendWeChatText } from './wechat/api';
import { sendOneBotMedia, sendOneBotProactiveText, sendOneBotText } from './onebot/api';
import { sendTelegramMedia, sendTelegramProactiveText, sendTelegramText } from './telegram/api';
import { sendSlackMedia, sendSlackProactiveText, sendSlackText } from './slack/api';
import { sendLineMedia, sendLineProactiveText, sendLineText } from './line/api';
import { sendWhatsAppMedia, sendWhatsAppProactiveText, sendWhatsAppText } from './whatsapp/api';
import { sendMattermostMedia, sendMattermostProactiveText, sendMattermostText } from './mattermost/api';

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
    case 'slack':
      return sendSlackText(account, targetId, messageId, content, options);
    case 'line':
      return sendLineText(account, targetId, messageId, content, options);
    case 'whatsapp':
      return sendWhatsAppText(account, targetId, messageId, content, options);
    case 'mattermost':
      return sendMattermostText(account, targetId, messageId, content, options);
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
    case 'slack':
      return sendSlackMedia(account, targetId, messageId, media, options);
    case 'line':
      return sendLineMedia(account, targetId, messageId, media, options);
    case 'whatsapp':
      return sendWhatsAppMedia(account, targetId, messageId, media, options);
    case 'mattermost':
      return sendMattermostMedia(account, targetId, messageId, media, options);
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
    case 'slack':
      return sendSlackProactiveText(account, targetId, content);
    case 'line':
      return sendLineProactiveText(account, targetId, content);
    case 'whatsapp':
      return sendWhatsAppProactiveText(account, targetId, content);
    case 'mattermost':
      return sendMattermostProactiveText(account, targetId, content);
    default:
      throw unsupportedProtocol(account.protocol);
  }
}
