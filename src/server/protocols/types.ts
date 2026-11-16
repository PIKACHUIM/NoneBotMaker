import type { BotAccountRecord, ConversationType, JsonObject } from '../../shared/types';

/**
 * Platform-independent account context used by the chatbot runtime.
 * Protocol modules read their own values from `credentials`; the convenience
 * fields cover the common identifier/secret pair and keep older QQ code working.
 */
export interface ChatAccountContext {
  account: BotAccountRecord;
  /** Protocol id such as qq, feishu, dingtalk or wechat. */
  protocol: string;
  /** Decrypted credentials exactly as configured in the admin console. */
  credentials: JsonObject;
  /** Primary bot identifier: QQ AppID, Feishu App ID, DingTalk AppKey or WeChat AppID. */
  appId: string;
  appSecret?: string;
  botSecret?: string;
  clientSecret?: string;
  pluginEnabled: boolean;
  pluginConfig?: JsonObject;
}

/** @deprecated Use ChatAccountContext; kept as an alias for existing QQ modules. */
export type QQAccountContext = ChatAccountContext;

export interface ChatAttachment {
  url: string;
  contentType?: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
  type: 'image' | 'audio' | 'video' | 'file';
}

/** @deprecated Use ChatAttachment. */
export type QQAttachment = ChatAttachment;

/** Inbound platform message normalized into the shared conversation contract. */
export interface ChatPlatformMessage {
  id: string;
  accountId: string;
  botId: string;
  groupId: string;
  userId: string;
  userName?: string;
  text: string;
  mentionsBot: boolean;
  receivedAt: number;
  eventId?: string;
  eventType: string;
  conversationType?: ConversationType;
  attachments?: ChatAttachment[];
  batchMessages?: ChatPlatformMessage[];
  isWake?: boolean;
  wakeReason?: string;
  /** Short-lived reply handle supplied by the platform, e.g. DingTalk sessionWebhook. */
  replyToken?: string;
}

/** @deprecated Use ChatPlatformMessage; kept as an alias for existing QQ modules. */
export type QQGroupMessage = ChatPlatformMessage;
