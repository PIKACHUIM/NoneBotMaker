import type { BotAccountRecord, JsonObject } from '../../../shared/types';

export interface QQAccountContext {
  account: BotAccountRecord;
  appId: string;
  appSecret?: string;
  botSecret?: string;
  clientSecret?: string;
  pluginEnabled: boolean;
  pluginConfig?: JsonObject;
}

export interface QQGroupMessage {
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
  eventType: 'GROUP_AT_MESSAGE_CREATE' | 'GROUP_MESSAGE_CREATE' | 'C2C_MESSAGE_CREATE';
  conversationType?: 'group' | 'private';
  attachments?: QQAttachment[];
  batchMessages?: QQGroupMessage[];
  isWake?: boolean;
  wakeReason?: string;
}

export interface QQAttachment {
  url: string;
  contentType?: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
  type: 'image' | 'audio' | 'video' | 'file';
}
