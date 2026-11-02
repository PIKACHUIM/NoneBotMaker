import { CHATBOT_PLUGIN_TYPE, type JsonObject, type Language, type LocalizedText, type PluginDefinition, type PluginFieldDefinition } from './types';

export const CONTEXT_MESSAGE_LIMIT_DEFAULT = 20;
export const CONTEXT_MESSAGE_LIMIT_MAX = 100;

const chatbotDefinition: PluginDefinition = {
  type: CHATBOT_PLUGIN_TYPE,
  name: { zh: '群聊助手', en: 'Group Chatbot' },
  description: {
    zh: '接收 QQ 群消息，按群聊策略调用模型并回复。',
    en: 'Receives QQ group messages and replies through the model configured for each group.',
  },
  configFields: [
    {
      key: 'contextMessageLimit',
      type: 'number',
      min: 0,
      max: CONTEXT_MESSAGE_LIMIT_MAX,
      step: 1,
      default: CONTEXT_MESSAGE_LIMIT_DEFAULT,
      label: { zh: '上下文消息条数', en: 'Context message limit' },
      description: {
        zh: '每次请求携带的最近对话条数。0 表示不携带历史上下文，最大 100 条。',
        en: 'Number of recent messages sent with each request. 0 disables history; the maximum is 100.',
      },
    },
    {
      key: 'includeHistory',
      type: 'boolean',
      default: true,
      label: { zh: '携带历史上下文', en: 'Include conversation history' },
      description: {
        zh: '关闭后每次只发送当前消息和系统提示词，不读取历史对话。',
        en: 'When disabled, only the current message and system prompt are sent; stored history is ignored.',
      },
    },
    {
      key: 'defaultSystemPrompt',
      type: 'text',
      multiline: true,
      default: '',
      label: { zh: '默认系统提示词', en: 'Default system prompt' },
      description: {
        zh: '当群聊没有单独配置系统提示词时使用。群聊级配置优先。',
        en: 'Used when a group has no system prompt of its own. Group-level settings take precedence.',
      },
      placeholder: {
        zh: '例如：你是群聊助手，回答简洁、友好。',
        en: 'For example: You are a helpful group assistant. Keep replies concise and friendly.',
      },
    },
  ],
  credentialFields: [
    {
      key: 'appId',
      type: 'text',
      required: true,
      label: { zh: '机器人 AppID', en: 'Bot App ID' },
      description: {
        zh: 'QQ 开放平台机器人资料中的 AppID，用于定位账号并校验回调。',
        en: 'The App ID from QQ Open Platform, used to identify the bot and verify callbacks.',
      },
      placeholder: { zh: '例如：102012345', en: 'For example: 102012345' },
    },
    {
      key: 'botSecret',
      type: 'text',
      required: true,
      secret: true,
      label: { zh: '机器人 Secret', en: 'Bot Secret' },
      description: {
        zh: 'QQ 开放平台机器人 Secret，用于验证 Webhook 签名。',
        en: 'The bot Secret from QQ Open Platform, used to verify Webhook signatures.',
      },
      placeholder: { zh: '输入机器人 Secret', en: 'Enter the bot Secret' },
    },
    {
      key: 'clientSecret',
      type: 'text',
      required: true,
      secret: true,
      label: { zh: '客户端 Secret', en: 'Client Secret' },
      description: {
        zh: '用于获取机器人访问令牌，不会以明文返回管理端。',
        en: 'Used to obtain bot access tokens. It is never returned to the admin console in plaintext.',
      },
      placeholder: { zh: '输入客户端 Secret', en: 'Enter the client Secret' },
    },
  ],
};

const definitions = new Map<string, PluginDefinition>([[chatbotDefinition.type, chatbotDefinition]]);

export function pluginDefinition(type: string | undefined): PluginDefinition | undefined {
  return type ? definitions.get(type) : undefined;
}

export function pluginDefinitions(): PluginDefinition[] {
  return [...definitions.values()];
}

export function localizedText(text: LocalizedText, language: Language): string {
  return text[language] || text.zh;
}

export function defaultFieldValues(fields: PluginFieldDefinition[]): JsonObject {
  return Object.fromEntries(fields.map((field) => [field.key, field.default ?? defaultForType(field.type)]));
}

function defaultForType(type: PluginFieldDefinition['type']): string | number | boolean {
  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  return '';
}

function clampNumber(value: number, field: PluginFieldDefinition): number {
  const minimum = field.min ?? Number.NEGATIVE_INFINITY;
  const maximum = field.max ?? Number.POSITIVE_INFINITY;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeFieldValues(fields: PluginFieldDefinition[], input: JsonObject | undefined): JsonObject {
  const source = input ?? {};
  const result: JsonObject = {};
  for (const field of fields) {
    const value = source[field.key];
    if (field.type === 'boolean') {
      if (typeof value === 'boolean') result[field.key] = value;
      else if (typeof value === 'string' && value.trim() !== '') {
        result[field.key] = ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
      } else result[field.key] = field.default === true;
    } else if (field.type === 'number') {
      const parsed = typeof value === 'number' ? value : Number(value);
      const fallback = typeof field.default === 'number' ? field.default : 0;
      result[field.key] = Number.isFinite(parsed) ? clampNumber(parsed, field) : fallback;
    } else {
      result[field.key] = typeof value === 'string' ? value : typeof field.default === 'string' ? field.default : '';
    }
  }
  return result;
}

export function missingRequiredField(fields: PluginFieldDefinition[], values: JsonObject): PluginFieldDefinition | undefined {
  return fields.find((field) => {
    if (!field.required) return false;
    const value = values[field.key];
    return typeof value !== 'string' || value.trim() === '';
  });
}
