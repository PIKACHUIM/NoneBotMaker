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

const agentGroup = group('模型与 Agent', 'Model & Agent');
const bridgeGroup = group('消息与访问', 'Messages & Access');
const contextGroup = group('上下文与媒体', 'Context & Media');
const consoleGroup = group('控制台与 MCP', 'Console & MCP');
const voiceGroup = group('语音', 'Voice');
const slangGroup = group('群黑话', 'Group slang');
const costGroup = group('成本估算', 'Cost estimates');
const storageGroup = group('本地路径', 'Local paths');
const searchGroup = group('联网搜索', 'Web search');

const chatbotDefinition: PluginDefinition = {
  type: CHATBOT_PLUGIN_TYPE,
  name: { zh: '群聊助手', en: 'Group Chatbot' },
  description: {
    zh: '接收 QQ 群消息，按群聊策略调用模型并回复。',
    en: 'Receives QQ group messages and replies through the model configured for each group.',
  },
  configFields: [
    text('agent_model', ['模型', 'Model'], [
      '群聊没有单独配置模型时使用，对应 AGENT_MODEL。',
      'Used when a group has no model of its own. Maps to AGENT_MODEL.',
    ], { group: agentGroup, default: '' }),
    text('agent_base_url', ['模型 Base URL', 'Model base URL'], [
      '对应 AGENT_BASE_URL。当前 Worker 仍优先使用群聊绑定的供应商地址。',
      'Maps to AGENT_BASE_URL. The Worker still prefers the provider bound to the group.',
    ], { group: agentGroup, default: '', placeholder: { zh: 'https://api.example.com/v1', en: 'https://api.example.com/v1' } }),
    text('agent_api_key', ['模型 API Key', 'Model API key'], [
      '对应 AGENT_API_KEY。当前 Worker 仍优先使用群聊绑定的供应商密钥。',
      'Maps to AGENT_API_KEY. The Worker still prefers the provider key bound to the group.',
    ], { group: agentGroup, default: '', secret: true }),
    text('agent_reasoning_effort', ['思考强度', 'Reasoning effort'], [
      '对应 AGENT_REASONING_EFFORT；群聊未设置时作为回退。',
      'Maps to AGENT_REASONING_EFFORT and is used as a fallback when a group has no value.',
    ], {
      group: agentGroup,
      default: '',
      options: [
        { value: '', label: { zh: '默认', en: 'Default' } },
        { value: 'low', label: { zh: '低', en: 'Low' } },
        { value: 'medium', label: { zh: '中', en: 'Medium' } },
        { value: 'high', label: { zh: '高', en: 'High' } },
      ],
    }),
    text('bridge_owner_ids', ['管理员 ID', 'Owner IDs'], [
      '对应 BRIDGE_OWNER_IDS，逗号分隔。管理员即使不在群白名单中也会被允许。',
      'Maps to BRIDGE_OWNER_IDS, comma-separated. Owners bypass the group allowlist.',
    ], { group: bridgeGroup, default: '', multiline: false }),
    text('bridge_allowed_groups', ['允许的群', 'Allowed groups'], [
      '对应 BRIDGE_ALLOWED_GROUPS，逗号分隔的群 openid。留空表示不额外限制。',
      'Maps to BRIDGE_ALLOWED_GROUPS, comma-separated group openids. Empty means no extra restriction.',
    ], { group: bridgeGroup, default: '' }),
    text('bridge_allowed_private', ['允许的私聊', 'Allowed private chats'], [
      '对应 BRIDGE_ALLOWED_PRIVATE。当前 Worker 只处理群消息，保留该字段用于配置对齐。',
      'Maps to BRIDGE_ALLOWED_PRIVATE. The Worker only handles group messages; kept for config parity.',
    ], { group: bridgeGroup, default: '' }),
    text('bridge_mode', ['运行模式', 'Bridge mode'], [
      'chat 正常回复；reserved 抑制 [SILENT]；reserved2 与 closed-agent 在当前 Worker 中不自动回复。',
      'chat replies normally; reserved suppresses [SILENT]; reserved2 and closed-agent do not auto-reply in this Worker.',
    ], {
      group: bridgeGroup,
      default: 'chat',
      options: [
        { value: 'chat', label: { zh: 'chat / 正常回复', en: 'chat / normal' } },
        { value: 'reserved', label: { zh: 'reserved / 抑制静默', en: 'reserved / suppress silent' } },
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
      '对应 BRIDGE_GROUP_BATCH_SECONDS，0–10。当前 Worker 暂不合并连续群消息。',
      'Maps to BRIDGE_GROUP_BATCH_SECONDS, 0–10. The Worker does not merge consecutive messages yet.',
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
      '对应 BRIDGE_MAX_MEDIA_BYTES，1024–33554432。当前 Worker 只处理文本。',
      'Maps to BRIDGE_MAX_MEDIA_BYTES, 1024–33554432. The Worker currently handles text only.',
    ], { group: contextGroup, default: 8 * 1024 * 1024, min: 1024, max: 32 * 1024 * 1024, step: 1024 }),

    text('bridge_console_token', ['控制台令牌', 'Console token'], [
      '对应 BRIDGE_CONSOLE_TOKEN。当前管理台使用 SYS_PASSWD，保留该字段用于配置对齐。',
      'Maps to BRIDGE_CONSOLE_TOKEN. This admin console uses SYS_PASSWD; kept for config parity.',
    ], { group: consoleGroup, default: '', secret: true }),
    text('bridge_mcp_server_url', ['MCP 服务地址', 'MCP server URL'], [
      '对应 BRIDGE_MCP_SERVER_URL。当前 Worker 暂未连接 MCP。',
      'Maps to BRIDGE_MCP_SERVER_URL. The Worker does not connect to MCP yet.',
    ], { group: consoleGroup, default: '', placeholder: { zh: 'https://mcp.example.com', en: 'https://mcp.example.com' } }),

    text('bridge_voice_dir', ['语音库目录', 'Voice library directory'], [
      '对应 BRIDGE_VOICE_DIR。当前 Worker 没有持久文件系统，仅保存该值。',
      'Maps to BRIDGE_VOICE_DIR. The Worker has no persistent filesystem and only stores this value.',
    ], { group: voiceGroup, default: '', placeholder: { zh: '/data/bridge/voices', en: '/data/bridge/voices' } }),
    number('bridge_voice_max_bytes', ['语音大小上限', 'Max voice bytes'], [
      '对应 BRIDGE_VOICE_MAX_BYTES，默认 20 MB。当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_MAX_BYTES, default 20 MB. TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: 20 * 1024 * 1024, min: 1024, max: 100 * 1024 * 1024, step: 1024 }),
    number('bridge_voice_max_text_chars', ['语音文本上限', 'Max voice text chars'], [
      '对应 BRIDGE_VOICE_MAX_TEXT_CHARS，1–2000。当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_MAX_TEXT_CHARS, 1–2000. TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: 500, min: 1, max: 2000, step: 1 }),
    number('bridge_voice_rate', ['语音语速', 'Voice rate'], [
      '对应 BRIDGE_VOICE_RATE，80–300，默认 175。当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_RATE, 80–300, default 175. TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: 175, min: 80, max: 300, step: 1 }),
    number('bridge_voice_volume', ['语音音量', 'Voice volume'], [
      '对应 BRIDGE_VOICE_VOLUME，0–1，默认 1。当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_VOLUME, 0–1, default 1. TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: 1, min: 0, max: 1, step: 0.1 }),
    text('bridge_voice_id', ['语音音色', 'Voice ID'], [
      '对应 BRIDGE_VOICE_ID。留空使用默认音色；当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_ID. Empty uses the default voice; TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: '' }),
    number('bridge_voice_sends_per_hour', ['每小时语音条数', 'Voice sends per hour'], [
      '对应 BRIDGE_VOICE_SENDS_PER_HOUR，1–500，默认 20。当前 Worker 未启用 TTS。',
      'Maps to BRIDGE_VOICE_SENDS_PER_HOUR, 1–500, default 20. TTS is disabled in this Worker.',
    ], { group: voiceGroup, default: 20, min: 1, max: 500, step: 1 }),

    boolean('bridge_slang_enabled', ['启用群黑话', 'Enable group slang'], [
      '对应 BRIDGE_SLANG_ENABLED。当前 Worker 暂未启用黑话抽取。',
      'Maps to BRIDGE_SLANG_ENABLED. Slang extraction is disabled in this Worker.',
    ], { group: slangGroup, default: true }),
    number('bridge_slang_min_messages', ['黑话最少消息数', 'Slang minimum messages'], [
      '对应 BRIDGE_SLANG_MIN_MESSAGES，3–100。当前 Worker 暂未启用黑话抽取。',
      'Maps to BRIDGE_SLANG_MIN_MESSAGES, 3–100. Slang extraction is disabled in this Worker.',
    ], { group: slangGroup, default: 10, min: 3, max: 100, step: 1 }),
    number('bridge_slang_cooldown_seconds', ['黑话冷却时间', 'Slang cooldown'], [
      '对应 BRIDGE_SLANG_COOLDOWN_SECONDS，30–86400 秒。当前 Worker 暂未启用黑话抽取。',
      'Maps to BRIDGE_SLANG_COOLDOWN_SECONDS, 30–86400 seconds. Slang extraction is disabled in this Worker.',
    ], { group: slangGroup, default: 300, min: 30, max: 86400, step: 1 }),

    number('bridge_input_cost_per_million', ['输入成本 / 百万 token', 'Input cost / 1M tokens'], [
      '对应 BRIDGE_INPUT_COST_PER_MILLION；群聊未配置输入成本时作为回退。',
      'Maps to BRIDGE_INPUT_COST_PER_MILLION; used when a group has no input cost.',
    ], { group: costGroup, default: 0, min: 0, step: 0.0001 }),
    number('bridge_output_cost_per_million', ['输出成本 / 百万 token', 'Output cost / 1M tokens'], [
      '对应 BRIDGE_OUTPUT_COST_PER_MILLION；群聊未配置输出成本时作为回退。',
      'Maps to BRIDGE_OUTPUT_COST_PER_MILLION; used when a group has no output cost.',
    ], { group: costGroup, default: 0, min: 0, step: 0.0001 }),

    text('agent_workspace', ['Agent 工作区', 'Agent workspace'], [
      '对应 AGENT_WORKSPACE。当前 Worker 没有持久文件系统，仅保存该值。',
      'Maps to AGENT_WORKSPACE. The Worker has no persistent filesystem and only stores this value.',
    ], { group: storageGroup, default: '', placeholder: { zh: '/data/workspace', en: '/data/workspace' } }),
    text('bridge_state_dir', ['Bridge 状态目录', 'Bridge state directory'], [
      '对应 BRIDGE_STATE_DIR。当前 Worker 使用 D1 或 KV 保存状态。',
      'Maps to BRIDGE_STATE_DIR. The Worker stores state in D1 or KV.',
    ], { group: storageGroup, default: '', placeholder: { zh: '/data/bridge', en: '/data/bridge' } }),

    text('brave_api_key', ['Brave Search API Key', 'Brave Search API key'], [
      '对应 BRAVE_API_KEY，用于插件的 WebSearch。当前 Worker 暂未启用联网搜索工具。',
      'Maps to BRAVE_API_KEY for the plugin WebSearch tool. Web search is disabled in this Worker.',
    ], { group: searchGroup, default: '', secret: true }),
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

export function configString(config: JsonObject | undefined, key: string, fallback = ''): string {
  const value = config?.[key];
  return typeof value === 'string' ? value : fallback;
}

export function configNumber(config: JsonObject | undefined, key: string, fallback: number, min?: number, max?: number): number {
  const value = Number(config?.[key]);
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
