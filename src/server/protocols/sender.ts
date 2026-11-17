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
import { sendDiscordMedia, sendDiscordProactiveText, sendDiscordText } from './discord/api';
import { sendSatoriMedia, sendSatoriProactiveText, sendSatoriText } from './satori/api';
import { sendKookMedia, sendKookProactiveText, sendKookText } from './kook/api';
import { sendWeComMedia, sendWeComProactiveText, sendWeComText } from './wecom/api';
import { sendMessengerMedia, sendMessengerProactiveText, sendMessengerText } from './messenger/api';
import { sendVkMedia, sendVkProactiveText, sendVkText } from './vk/api';
import { sendZulipMedia, sendZulipProactiveText, sendZulipText } from './zulip/api';
import { sendRocketChatMedia, sendRocketChatProactiveText, sendRocketChatText } from './rocketchat/api';
import { sendDodoMedia, sendDodoProactiveText, sendDodoText } from './dodo/api';
import { sendMatrixMedia, sendMatrixProactiveText, sendMatrixText } from './matrix/api';
import { sendRevoltMedia, sendRevoltProactiveText, sendRevoltText } from './revolt/api';
import { sendMastodonMedia, sendMastodonProactiveText, sendMastodonText } from './mastodon/api';
import { sendInstagramMedia, sendInstagramProactiveText, sendInstagramText } from './instagram/api';
import { sendViberMedia, sendViberProactiveText, sendViberText } from './viber/api';
import { sendMisskeyMedia, sendMisskeyProactiveText, sendMisskeyText } from './misskey/api';

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
    case 'discord':
      return sendDiscordText(account, targetId, messageId, content, options);
    case 'satori':
      return sendSatoriText(account, targetId, messageId, content, options);
    case 'kook':
      return sendKookText(account, targetId, messageId, content, options);
    case 'wecom':
      return sendWeComText(account, targetId, messageId, content, options);
    case 'messenger':
      return sendMessengerText(account, targetId, messageId, content, options);
    case 'vk':
      return sendVkText(account, targetId, messageId, content, options);
    case 'zulip':
      return sendZulipText(account, targetId, messageId, content, options);
    case 'rocketchat':
      return sendRocketChatText(account, targetId, messageId, content, options);
    case 'dodo':
      return sendDodoText(account, targetId, messageId, content, options);
    case 'matrix':
      return sendMatrixText(account, targetId, messageId, content, options);
    case 'revolt':
      return sendRevoltText(account, targetId, messageId, content, options);
    case 'mastodon':
      return sendMastodonText(account, targetId, messageId, content, options);
    case 'instagram':
      return sendInstagramText(account, targetId, messageId, content, options);
    case 'viber':
      return sendViberText(account, targetId, messageId, content, options);
    case 'misskey':
      return sendMisskeyText(account, targetId, messageId, content, options);
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
    case 'discord':
      return sendDiscordMedia(account, targetId, messageId, media, options);
    case 'satori':
      return sendSatoriMedia(account, targetId, messageId, media, options);
    case 'kook':
      return sendKookMedia(account, targetId, messageId, media, options);
    case 'wecom':
      return sendWeComMedia(account, targetId, messageId, media, options);
    case 'messenger':
      return sendMessengerMedia(account, targetId, messageId, media, options);
    case 'vk':
      return sendVkMedia(account, targetId, messageId, media, options);
    case 'zulip':
      return sendZulipMedia(account, targetId, messageId, media, options);
    case 'rocketchat':
      return sendRocketChatMedia(account, targetId, messageId, media, options);
    case 'dodo':
      return sendDodoMedia(account, targetId, messageId, media, options);
    case 'matrix':
      return sendMatrixMedia(account, targetId, messageId, media, options);
    case 'revolt':
      return sendRevoltMedia(account, targetId, messageId, media, options);
    case 'mastodon':
      return sendMastodonMedia(account, targetId, messageId, media, options);
    case 'instagram':
      return sendInstagramMedia(account, targetId, messageId, media, options);
    case 'viber':
      return sendViberMedia(account, targetId, messageId, media, options);
    case 'misskey':
      return sendMisskeyMedia(account, targetId, messageId, media, options);
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
    case 'discord':
      return sendDiscordProactiveText(account, targetId, content);
    case 'satori':
      return sendSatoriProactiveText(account, targetId, content);
    case 'kook':
      return sendKookProactiveText(account, targetId, content);
    case 'wecom':
      return sendWeComProactiveText(account, targetId, content);
    case 'messenger':
      return sendMessengerProactiveText(account, targetId, content);
    case 'vk':
      return sendVkProactiveText(account, targetId, content);
    case 'zulip':
      return sendZulipProactiveText(account, targetId, content);
    case 'rocketchat':
      return sendRocketChatProactiveText(account, targetId, content);
    case 'dodo':
      return sendDodoProactiveText(account, targetId, conversationType, content);
    case 'matrix':
      return sendMatrixProactiveText(account, targetId, content);
    case 'revolt':
      return sendRevoltProactiveText(account, targetId, content);
    case 'mastodon':
      return sendMastodonProactiveText(account, targetId, content);
    case 'instagram':
      return sendInstagramProactiveText(account, targetId, content);
    case 'viber':
      return sendViberProactiveText(account, targetId, content);
    case 'misskey':
      return sendMisskeyProactiveText(account, targetId, content);
    default:
      throw unsupportedProtocol(account.protocol);
  }
}
