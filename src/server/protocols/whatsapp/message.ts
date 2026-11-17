import type { ChatAccountContext, ChatPlatformMessage } from '../types';

interface WhatsAppMessage {
  from?: unknown;
  id?: unknown;
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  image?: { caption?: unknown };
  video?: { caption?: unknown };
  document?: { caption?: unknown; filename?: unknown };
  button?: { text?: unknown };
  interactive?: { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } };
}

interface WhatsAppChangeValue {
  metadata?: { phone_number_id?: unknown };
  contacts?: Array<{ profile?: { name?: unknown }; wa_id?: unknown }>;
  messages?: WhatsAppMessage[];
}

export interface WhatsAppWebhookPayload {
  object?: unknown;
  entry?: Array<{ id?: unknown; changes?: Array<{ field?: unknown; value?: WhatsAppChangeValue }> }>;
}

const PLACEHOLDERS: Record<string, string> = {
  image: '[图片]',
  video: '[视频]',
  audio: '[音频]',
  document: '[文件]',
  sticker: '[表情]',
  location: '[位置]',
  contacts: '[联系人]',
  reaction: '[表情回应]',
};

function stringValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
}

export interface NormalizedWhatsAppBatch {
  phoneNumberId: string;
  messages: ChatPlatformMessage[];
}

/** Reads the receiving number without needing an account context first. */
export function whatsappPhoneNumberId(payload: WhatsAppWebhookPayload): string {
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const id = stringValue(change.value?.metadata?.phone_number_id, 32);
      if (id) return id;
    }
  }
  return '';
}

export function normalizeWhatsAppPayload(
  payload: WhatsAppWebhookPayload,
  account: ChatAccountContext,
  receivedAt: number,
): NormalizedWhatsAppBatch {
  let phoneNumberId = '';
  const messages: ChatPlatformMessage[] = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value || typeof value !== 'object') continue;
      const metadataId = stringValue(value.metadata?.phone_number_id, 32);
      if (metadataId) phoneNumberId = metadataId;
      const names = new Map<string, string>();
      for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
        const waId = stringValue(contact.wa_id, 32);
        const name = stringValue(contact.profile?.name, 128);
        if (waId && name) names.set(waId, name);
      }
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const from = stringValue(message.from, 32);
        const messageId = stringValue(message.id, 128);
        if (!from || !messageId) continue;
        const type = stringValue(message.type, 32) || 'text';
        const text = stringValue(message.text?.body, 16_384) ||
          stringValue(message.image?.caption, 16_384) ||
          stringValue(message.video?.caption, 16_384) ||
          stringValue(message.document?.caption, 16_384) ||
          stringValue(message.button?.text, 256) ||
          stringValue(message.interactive?.button_reply?.title, 256) ||
          stringValue(message.interactive?.list_reply?.title, 256) ||
          PLACEHOLDERS[type] || '[消息]';
        const name = names.get(from);
        messages.push({
          id: messageId,
          accountId: account.account.id,
          botId: account.appId,
          groupId: from,
          userId: from,
          ...(name ? { userName: name } : {}),
          text,
          mentionsBot: true,
          receivedAt: typeof message.timestamp === 'string' && /^\d{10,13}$/.test(message.timestamp)
            ? Number(message.timestamp) * (message.timestamp.length <= 10 ? 1000 : 1)
            : receivedAt,
          eventId: `whatsapp:${messageId}`,
          eventType: `whatsapp.${type}`,
          conversationType: 'private',
        });
      }
    }
  }
  return { phoneNumberId, messages };
}
