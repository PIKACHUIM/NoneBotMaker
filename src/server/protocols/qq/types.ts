import type { BotAccountRecord, JsonObject } from '../../../shared/types';

export interface QQAccountContext {
  account: BotAccountRecord;
  appId: string;
  botSecret: string;
  clientSecret: string;
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
  eventType: 'GROUP_AT_MESSAGE_CREATE' | 'GROUP_MESSAGE_CREATE';
}
