import { CHATBOT_PLUGIN_TYPE, type JsonObject, type Language, type LocalizedText, type PluginDefinition, type PluginFieldDefinition } from './types';

const field = (
  key: string,
  type: PluginFieldDefinition['type'],
  label: [string, string],
  description: [string, string],
  extra: Partial<PluginFieldDefinition> = {},
): PluginFieldDefinition => ({
  key,
  type,
  label: { zh: label[0], en: label[1] },
  description: { zh: description[0], en: description[1] },
  ...extra,
});

const text = (
  key: string,
  label: [string, string],
  description: [string, string],
  extra: Partial<PluginFieldDefinition> = {},
) => field(key, 'text', label, description, extra);

const number = (
  key: string,
  label: [string, string],
  description: [string, string],
  extra: Partial<PluginFieldDefinition> = {},
) => field(key, 'number', label, description, extra);

const boolean = (
  key: string,
  label: [string, string],
  description: [string, string],
  extra: Partial<PluginFieldDefinition> = {},
) => field(key, 'boolean', label, description, extra);

const group = (zh: string, en: string): LocalizedText => ({ zh, en });

const agentGroup = group('模型调用', 'Model requests');
const bridgeGroup = group('消息与访问', 'Messages & Access');
const contextGroup = group('上下文与媒体', 'Context & Media');
const searchGroup = group('联网搜索', 'Web search');
const voiceGroup = group('AI 语音', 'AI speech');

const chatbotDefinition: PluginDefinition = {
  type: CHATBOT_PLUGIN_TYPE,
  protocols: ['qq'],
  name: { zh: '群聊助手', en: 'Group Chatbot' },
  description: {
    zh: '接收 QQ 群聊和私聊消息，按各会话的策略调用模型与工具并回复。',
    en: 'Receives QQ group and private messages, applying each conversation’s model and tool policies.',
  },
  configFields: [
    text('brave_api_key', ['Brave Search API Key', 'Brave Search API key'], [
      '用于联网搜索工具；留空时不启用 Brave Search。',
      'Used by the web search tool. Leave empty to disable Brave Search.',
    ], { group: searchGroup, default: '', secret: true }),
  ],
  accountFields: [],
  groupFields: [
    boolean('agent_stream', ['流式模型响应', 'Streaming model response'], [
      '按流式协议读取模型文本、工具调用和用量。须由所选 AI API 支持；聊天平台仍按完整分段发送。',
      'Reads model text, tool calls and usage through streaming. Requires API support; the chat platform still receives complete message parts.',
    ], { group: agentGroup, default: false }),
    number('agent_max_rounds', ['工具调用轮数上限', 'Maximum tool rounds'], [
      '每次回复最多进行的模型与工具调用轮数，1–25。',
      'Maximum model and tool rounds for each reply, from 1 to 25.',
    ], { group: agentGroup, default: 5, min: 1, max: 25, step: 1 }),
    number('agent_max_output_tokens', ['单次输出 token 上限', 'Maximum output tokens'], [
      '每次模型请求允许的最大输出 token 数。',
      'Maximum output tokens allowed for each model request.',
    ], { group: agentGroup, default: 4096, min: 1, max: 131072, step: 1 }),
    number('agent_temperature', ['回复随机性', 'Temperature'], [
      '控制回复的随机性，0–2；是否支持取决于所选模型。',
      'Controls randomness from 0 to 2; support depends on the selected model.',
    ], { group: agentGroup, default: 0.7, min: 0, max: 2, step: 0.1 }),
    text('bridge_owner_ids', ['管理员 ID', 'Owner IDs'], [
      '对应 BRIDGE_OWNER_IDS，逗号分隔。管理员即使不在群白名单中也会被允许。',
      'Maps to BRIDGE_OWNER_IDS, comma-separated. Owners bypass the group allowlist.',
    ], { group: bridgeGroup, default: '', multiline: false }),
    text('bridge_allowed_groups', ['允许的群', 'Allowed groups'], [
      '对应 BRIDGE_ALLOWED_GROUPS，逗号分隔的群 openid。留空表示不额外限制。',
      'Maps to BRIDGE_ALLOWED_GROUPS, comma-separated group openids. Empty means no extra restriction.',
    ], { group: bridgeGroup, default: '' }),
    text('bridge_allowed_private', ['允许的私聊', 'Allowed private chats'], [
      '允许的私聊用户 openid，逗号分隔；留空表示不额外限制。',
      'Allowed private-chat user openids, comma-separated. Empty means no extra restriction.',
    ], { group: bridgeGroup, default: '' }),
    text('bridge_mode', ['运行模式', 'Bridge mode'], [
      'chat 正常回复；reserved 允许静默；reserved2 仅通过工具发送；closed-agent 仅响应管理员。',
      'chat replies normally; reserved allows silence; reserved2 sends only through tools; closed-agent responds only to owners.',
    ], {
      group: bridgeGroup,
      default: 'chat',
      options: [
        { value: 'chat', label: { zh: 'chat / 正常回复', en: 'chat / normal' } },
        { value: 'reserved', label: { zh: 'reserved / 允许静默', en: 'reserved / allow silence' } },
        { value: 'reserved2', label: { zh: 'reserved2 / 仅工具发送', en: 'reserved2 / tool send only' } },
        { value: 'closed-agent', label: { zh: 'closed-agent / 仅 owner', en: 'closed-agent / owner only' } },
      ],
    }),
    number('bridge_max_message_chars', ['单条消息字符上限', 'Max message chars'], [
      '对应 BRIDGE_MAX_MESSAGE_CHARS，100–4000。超长回复会分段发送。',
      'Maps to BRIDGE_MAX_MESSAGE_CHARS, 100–4000. Long replies are split into parts.',
    ], { group: bridgeGroup, default: 500, min: 100, max: 4000, step: 1 }),
    number('bridge_max_messages_per_minute', ['每分钟最多消息数', 'Messages per minute'], [
      '对应 BRIDGE_MAX_MESSAGES_PER_MINUTE，1–60。当前 Worker 按实例内存近似限流。',
      'Maps to BRIDGE_MAX_MESSAGES_PER_MINUTE, 1–60. The Worker applies an in-isolate memory-based limit.',
    ], { group: bridgeGroup, default: 6, min: 1, max: 60, step: 1 }),
    number('bridge_group_batch_seconds', ['群消息合并窗口', 'Group batch window'], [
      '合并窗口内的连续会话消息，0–10 秒；0 表示关闭合并。',
      'Combines consecutive conversation messages within 0–10 seconds; 0 disables batching.',
    ], { group: bridgeGroup, default: 1, min: 0, max: 10, step: 0.1 }),

    number('max_context', ['上下文 token 预算', 'Context token budget'], [
      '对应 MAX_CONTEXT，4096–2000000。当前 Worker 按约 4 字符/token 近似裁剪历史。',
      'Maps to MAX_CONTEXT, 4096–2000000. The Worker trims history using roughly 4 chars per token.',
    ], { group: contextGroup, default: 262144, min: 4096, max: 2_000_000, step: 1 }),
    number('compact_rate', ['上下文压缩比例', 'Context compact rate'], [
      '对应 COMPACT_RATE，0.1–0.99。当前 Worker 使用 max_context × compact_rate 作为近似预算。',
      'Maps to COMPACT_RATE, 0.1–0.99. The Worker uses max_context × compact_rate as an approximate budget.',
    ], { group: contextGroup, default: 0.8, min: 0.1, max: 0.99, step: 0.01 }),
    number('bridge_max_media_bytes', ['媒体大小上限', 'Max media bytes'], [
      '单个图片、音频、视频或文件附件的大小上限，1024–33554432 字节。',
      'Maximum bytes for each image, audio, video, or file attachment, from 1024 to 33554432.',
    ], { group: contextGroup, default: 8 * 1024 * 1024, min: 1024, max: 32 * 1024 * 1024, step: 1024 }),

    number('context_history_limit', ['历史消息条数', 'History message limit'], [
      '每次模型请求保留的历史消息条数；0 表示不使用历史。',
      'Number of historical messages retained for each request; 0 disables history.',
    ], { group: contextGroup, default: 50, min: 0, max: 500, step: 1 }),
    boolean('memory_enabled', ['启用会话记忆', 'Enable conversation memory'], [
      '为当前群聊或私聊保存可选的长期记忆。不同会话之间不共享。',
      'Stores optional long-term memory for this conversation without sharing across conversations.',
    ], { group: contextGroup, default: false }),
    text('voice_model', ['语音合成模型', 'Speech model'], [
      '使用本会话供应商的语音合成接口；留空不开放 chat_tts。须配置对应供应商的语音能力与价格。',
      'Uses this conversation’s provider speech endpoint. Empty disables chat_tts; configure provider speech capability and pricing.',
    ], { group: voiceGroup, default: '' }),
    text('voice_id', ['语音音色', 'Voice'], [
      '供应商支持的音色 ID，默认 alloy；请确认所选模型支持该音色。',
      'Provider-supported voice ID, default alloy. Verify support for the selected model.',
    ], { group: voiceGroup, default: 'alloy' }),
    number('voice_speed', ['语音语速', 'Speech speed'], [
      '语音合成速度，0.25–4；实际支持范围以供应商接口为准。',
      'Speech speed from 0.25 to 4; actual support depends on the provider.',
    ], { group: voiceGroup, default: 1, min: 0.25, max: 4, step: 0.05 }),
    number('voice_max_text_chars', ['语音文本上限', 'Speech text limit'], [
      '单次语音合成的最大字符数，1–4096。',
      'Maximum characters per speech request, from 1 to 4096.',
    ], { group: voiceGroup, default: 500, min: 1, max: 4096, step: 1 }),
    number('voice_max_bytes', ['语音大小上限', 'Speech size limit'], [
      '生成语音的大小上限，最多 5 MiB，符合 QQ 富媒体发送限制。',
      'Maximum generated speech size, up to 5 MiB to fit the QQ rich-media limit.',
    ], { group: voiceGroup, default: 5 * 1024 * 1024, min: 1024, max: 5 * 1024 * 1024, step: 1024 }),
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
      key: 'appSecret',
      type: 'text',
      required: true,
      secret: true,
      label: { zh: '机器人 AppSecret', en: 'Bot App Secret' },
      description: {
        zh: 'QQ 开放平台的 AppSecret，用于签名验证与访问令牌；保存时留空保留已有密钥。',
        en: 'QQ App Secret for signatures and access tokens. Leave empty when saving to preserve the existing secret.',
      },
      placeholder: { zh: '输入 AppSecret', en: 'Enter App Secret' },
    },
  ],
  logFields: [
    { key: 'status', label: { zh: '状态', en: 'Status' } },
    { key: 'eventId', label: { zh: '事件 ID', en: 'Event ID' } },
    { key: 'model', label: { zh: '模型', en: 'Model' } },
    { key: 'toolCalls', label: { zh: '工具调用', en: 'Tool calls' } },
    { key: 'error', label: { zh: '错误', en: 'Error' } },
    { key: 'usage', label: { zh: '用量', en: 'Usage' } },
    { key: 'cost', label: { zh: '费用', en: 'Cost' } },
    { key: 'providerId', label: { zh: '供应商 ID', en: 'Provider ID' } },
    { key: 'durationMs', label: { zh: '耗时（毫秒）', en: 'Duration (ms)' } },
    { key: 'groupExternalId', label: { zh: '会话 OpenID', en: 'Conversation OpenID' } },
    { key: 'userId', label: { zh: '用户 OpenID', en: 'User OpenID' } },
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
      const parsed = value === undefined || value === null || value === '' ? NaN : typeof value === 'number' ? value : Number(value);
      const fallback = typeof field.default === 'number' ? field.default : 0;
      result[field.key] = Number.isFinite(parsed) ? clampNumber(parsed, field) : fallback;
    } else {
      result[field.key] = typeof value === 'string' ? value : typeof field.default === 'string' ? field.default : '';
    }
  }
  return result;
}

export function effectiveGroupConfig(pluginConfig: JsonObject | undefined, groupConfig: JsonObject | undefined, type: string = CHATBOT_PLUGIN_TYPE): JsonObject {
  const fields = pluginDefinition(type)?.groupFields ?? [];
  const inherited: JsonObject = {};
  for (const field of fields) {
    const value = groupConfig?.[field.key] ?? pluginConfig?.[field.key];
    if (value !== undefined) inherited[field.key] = value;
  }
  return normalizeFieldValues(fields, inherited);
}

export function missingRequiredField(fields: PluginFieldDefinition[], values: JsonObject): PluginFieldDefinition | undefined {
  return fields.find((field) => {
    if (!field.required) return false;
    const value = values[field.key];
    return typeof value !== 'string' || value.trim() === '';
  });
}

export function configString(config: JsonObject | undefined, key: string, fallback = ''): string {
  const value = config?.[key];
  return typeof value === 'string' ? value : fallback;
}

export function configNumber(config: JsonObject | undefined, key: string, fallback: number, min?: number, max?: number): number {
  const source = config?.[key];
  if (source === undefined || source === null || source === '') return fallback;
  const value = Number(source);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export function configBoolean(config: JsonObject | undefined, key: string, fallback: boolean): boolean {
  const value = config?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim() !== '') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return fallback;
}

export function configIdSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map((item) => String(item).trim()).filter(Boolean));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Set([String(value)]);
  if (typeof value !== 'string') return new Set();
  return new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean));
}
