import { CHATBOT_PLUGIN_TYPE, type ChatProtocolDefinition, type GroupRecord, type JsonObject, type Language, type LocalizedText, type PluginDefinition, type PluginFieldDefinition, type PolicyRecord, type PolicyScope, type PolicyType, type ReasoningEffort } from './types';

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
const mediaGroup = group('生图与视频', 'Image & Video');

/** Built-in functions that can be exposed by an identity's tool grants. */
export const BUILTIN_CHAT_TOOL_NAMES = [
  'chat_status', 'chat_time', 'chat_current_datetime', 'chat_timezone_info', 'chat_history',
  'chat_send', 'chat_wait', 'WebFetch', 'WebSearch', 'MemoryRead', 'MemorySearch',
  'MemoryWrite', 'MemoryForget', 'ProjectMemorySearch', 'ProjectMemoryRead',
  'ProjectMemoryWrite', 'ProjectMemoryForget', 'chat_save_meme', 'chat_list_memes',
  'chat_send_meme', 'chat_delete_meme', 'chat_list_voices', 'chat_send_voice',
  'chat_save_voice', 'chat_delete_voice', 'chat_send_media', 'chat_tts', 'chat_wake',
  'chat_generate_image', 'chat_generate_video', 'chat_calculate', 'chat_random',
  'chat_uuid', 'chat_base64', 'chat_hash', 'chat_text_stats',
] as const;

/** Safe, local-only helpers granted to the seeded default identity. */
export const DEFAULT_IDENTITY_TOOL_NAMES = [
  'chat_status', 'chat_time', 'chat_current_datetime', 'chat_timezone_info', 'chat_history',
  'WebFetch', 'WebSearch', 'chat_calculate', 'chat_random', 'chat_uuid', 'chat_base64',
  'chat_hash', 'chat_text_stats', 'chat_generate_image', 'chat_generate_video',
] as const;

/** Human-readable catalog names for built-in tools. */
export const BUILTIN_TOOL_LABELS: Record<string, LocalizedText> = {
  WebSearch: { zh: '联网搜索', en: 'Web search' },
  WebFetch: { zh: '网页读取', en: 'Web fetch' },
  chat_generate_image: { zh: '图片生成', en: 'Image generation' },
  chat_generate_video: { zh: '视频生成', en: 'Video generation' },
  chat_calculate: { zh: '计算器', en: 'Calculator' },
  chat_random: { zh: '随机数', en: 'Random' },
  chat_uuid: { zh: 'UUID 生成', en: 'UUID' },
  chat_base64: { zh: 'Base64 编解码', en: 'Base64' },
  chat_hash: { zh: '文本哈希', en: 'Hash' },
  chat_text_stats: { zh: '文本统计', en: 'Text statistics' },
};

const qqCredentialFields: PluginFieldDefinition[] = [
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
];

const feishuCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'appId',
    type: 'text',
    required: true,
    label: { zh: 'App ID', en: 'App ID' },
    description: {
      zh: '飞书开放平台「凭证与基础信息」中的 App ID（cli_ 开头），事件回调用它定位账号。',
      en: 'The App ID (starting with cli_) from Feishu Open Platform credentials; event callbacks use it to find the account.',
    },
    placeholder: { zh: '例如：cli_a1b2c3d4e5f6', en: 'For example: cli_a1b2c3d4e5f6' },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'App Secret', en: 'App Secret' },
    description: {
      zh: '飞书应用的 App Secret，用于获取 tenant_access_token 和校验请求签名；保存时留空保留已有密钥。',
      en: 'Feishu app secret used for tenant access tokens and request signatures. Leave empty when saving to preserve the existing secret.',
    },
  },
  {
    key: 'verificationToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Verification Token', en: 'Verification Token' },
    description: {
      zh: '飞书事件订阅的 Verification Token，用于校验未加密回调；保存时留空保留已有值。',
      en: 'Verification Token from Feishu event subscriptions, used to verify unencrypted callbacks. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'encryptKey',
    type: 'text',
    secret: true,
    label: { zh: 'Encrypt Key（可选）', en: 'Encrypt Key (optional)' },
    description: {
      zh: '配置后同时校验签名并解密加密事件；必须与飞书后台填写的一致，留空表示只接收明文事件。',
      en: 'When set, signatures are checked and encrypted events are decrypted. It must match Feishu exactly; empty accepts plaintext events only.',
    },
  },
];

const dingtalkCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'appKey',
    type: 'text',
    required: true,
    label: { zh: 'AppKey / Client ID', en: 'AppKey / Client ID' },
    description: {
      zh: '钉钉开放平台应用的 AppKey（Client ID），用于请求签名匹配与主动发送。',
      en: 'DingTalk AppKey (Client ID), used to match callback signatures and send messages proactively.',
    },
    placeholder: { zh: '例如：dingabc123', en: 'For example: dingabc123' },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'AppSecret / Client Secret', en: 'AppSecret / Client Secret' },
    description: {
      zh: '钉钉应用的 AppSecret，用于校验机器人回调签名与获取 accessToken；保存时留空保留已有密钥。',
      en: 'DingTalk AppSecret for callback signatures and access tokens. Leave empty when saving to preserve the existing secret.',
    },
  },
  {
    key: 'robotCode',
    type: 'text',
    label: { zh: 'RobotCode（可选）', en: 'RobotCode (optional)' },
    description: {
      zh: '机器人 RobotCode，用于定时任务等主动消息；留空时只回复收到的消息。',
      en: 'Robot code used for proactive messages such as schedules. Empty means replies only.',
    },
  },
];

const wechatCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'appId',
    type: 'text',
    required: true,
    label: { zh: 'AppID', en: 'AppID' },
    description: {
      zh: '微信公众号后台「开发 → 基本配置」中的 AppID（wx 开头）。',
      en: 'The AppID (starting with wx) from the WeChat Official Account basic configuration.',
    },
    placeholder: { zh: '例如：wx1234567890abcdef', en: 'For example: wx1234567890abcdef' },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'AppSecret', en: 'AppSecret' },
    description: {
      zh: '公众号 AppSecret，用于获取 access_token 与发送客服消息；公众号后台需把服务出口 IP 加入 IP 白名单。保存时留空保留已有密钥。',
      en: 'Official Account AppSecret used for access tokens and customer-service messages. Add the service egress IP to the Official Account IP allowlist. Leave empty to preserve the stored secret.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Token', en: 'Token' },
    description: {
      zh: '公众号后台「服务器配置」中的 Token，用于校验回调签名；保存时留空保留已有值。',
      en: 'The Token from the Official Account server configuration, used to verify callback signatures. Leave empty to keep the stored value.',
    },
  },
];

const onebotCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'selfId',
    type: 'text',
    required: true,
    label: { zh: '机器人 ID（self_id）', en: 'Bot ID (self_id)' },
    description: {
      zh: 'OneBot 上报中的 self_id，通常是机器人 QQ 号，用于定位账号与会话标识。',
      en: 'The self_id reported by OneBot, usually the bot QQ number, used to resolve the account and conversation identity.',
    },
    placeholder: { zh: '例如：100012345', en: 'For example: 100012345' },
  },
  {
    key: 'apiBaseUrl',
    type: 'text',
    required: true,
    label: { zh: 'OneBot HTTP API 地址', en: 'OneBot HTTP API base URL' },
    description: {
      zh: 'OneBot 实现的 HTTP API 地址，例如 http://127.0.0.1:3000；服务会调用 send_group_msg / send_private_msg。',
      en: 'HTTP API base URL of the OneBot implementation, for example http://127.0.0.1:3000. The service calls send_group_msg / send_private_msg.',
    },
    placeholder: { zh: 'http://127.0.0.1:3000', en: 'http://127.0.0.1:3000' },
  },
  {
    key: 'accessToken',
    type: 'text',
    secret: true,
    label: { zh: 'Access Token（可选）', en: 'Access Token (optional)' },
    description: {
      zh: '与 OneBot 实现配置的 access_token 一致，通过 Authorization 请求头发送；留空表示不鉴权。',
      en: 'Must match the OneBot access_token and is sent in the Authorization header; empty disables API authentication.',
    },
  },
  {
    key: 'secret',
    type: 'text',
    secret: true,
    label: { zh: '上报签名密钥（可选）', en: 'Report signing secret (optional)' },
    description: {
      zh: '配置后校验 HTTP 上报的 X-Signature（HMAC-SHA1）；留空表示不校验签名。推荐公网部署时设置。',
      en: 'When set, verifies the X-Signature HMAC-SHA1 header on HTTP reports. Empty skips signature checks; setting one is recommended for public deployments.',
    },
  },
];

const telegramCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'botToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Token', en: 'Bot Token' },
    description: {
      zh: 'BotFather 提供的完整 Bot Token（数字:字母）；用于调用 Telegram Bot API，保存时留空保留已有值。',
      en: 'The full Bot Token from BotFather (digits:letters), used for the Telegram Bot API. Leave empty to keep the stored value.',
    },
    placeholder: { zh: '123456789:AA...', en: '123456789:AA...' },
  },
  {
    key: 'botId',
    type: 'text',
    label: { zh: 'Bot 数字 ID', en: 'Bot numeric ID' },
    description: {
      zh: 'Bot Token 冒号前的数字，用于账号标识；留空会自动从 Bot Token 提取。',
      en: 'The digits before the colon in the Bot Token, used as the account identifier. Leave empty to derive it from the token.',
    },
    placeholder: { zh: '例如：123456789', en: 'For example: 123456789' },
  },
  {
    key: 'secretToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Webhook Secret Token', en: 'Webhook Secret Token' },
    description: {
      zh: '调用 setWebhook 时设置的 secret_token，用于校验回调并定位账号；保存时留空保留已有值。',
      en: 'The secret_token supplied to setWebhook, used to verify callbacks and resolve the account. Leave empty to keep the stored value.',
    },
  },
];

const slackCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'appId',
    type: 'text',
    required: true,
    label: { zh: 'Slack App ID', en: 'Slack App ID' },
    description: {
      zh: 'Slack App 基本信息里的 App ID（A 开头），用于账号标识与回调校验。',
      en: 'The Slack App ID (starting with A) from the app credentials, used as the account identifier and for callback checks.',
    },
    placeholder: { zh: '例如：A0123456789', en: 'For example: A0123456789' },
  },
  {
    key: 'botToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot User OAuth Token', en: 'Bot User OAuth Token' },
    description: {
      zh: '应用 OAuth & Permissions 中的 Bot Token（xoxb- 开头），需要 chat:write 权限；保存时留空保留已有值。',
      en: 'The Bot Token (xoxb-) from OAuth & Permissions with chat:write scope. Leave empty to keep the stored value.',
    },
    placeholder: { zh: 'xoxb-...', en: 'xoxb-...' },
  },
  {
    key: 'signingSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Signing Secret', en: 'Signing Secret' },
    description: {
      zh: 'Slack App 基本信息里的 Signing Secret，用于校验 X-Slack-Signature；保存时留空保留已有值。',
      en: 'The Signing Secret from the Slack app credentials, used to verify X-Slack-Signature. Leave empty to keep the stored value.',
    },
  },
];

const lineCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'channelId',
    type: 'text',
    required: true,
    label: { zh: 'Channel ID', en: 'Channel ID' },
    description: {
      zh: 'LINE Developers 控制台的 Channel ID（数字），用于账号标识与重复检测。',
      en: 'The numeric Channel ID from the LINE Developers console, used as the account identifier.',
    },
    placeholder: { zh: '例如：2000123456', en: 'For example: 2000123456' },
  },
  {
    key: 'channelSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Channel Secret', en: 'Channel Secret' },
    description: {
      zh: 'Messaging API 频道的 Channel Secret，用于校验 X-Line-Signature；保存时留空保留已有值。',
      en: 'The Channel Secret of the Messaging API channel, used to verify X-Line-Signature. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'channelAccessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Channel Access Token', en: 'Channel Access Token' },
    description: {
      zh: '长期 Channel Access Token，用于调用 push API；保存时留空保留已有值。',
      en: 'The long-lived Channel Access Token used for the push API. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'botUserId',
    type: 'text',
    label: { zh: 'Bot User ID（可选）', en: 'Bot user ID (optional)' },
    description: {
      zh: 'Bot 的 User ID（U 开头），可选，用于群聊 @ 检测与回调归属校验。',
      en: 'The bot user ID (starting with U), optional, used for group mention detection and callback checks.',
    },
    placeholder: { zh: '例如：U4af...', en: 'For example: U4af...' },
  },
];

const whatsappCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'phoneNumberId',
    type: 'text',
    required: true,
    label: { zh: 'Phone Number ID', en: 'Phone Number ID' },
    description: {
      zh: 'WhatsApp Business 后台号码的 Phone Number ID（数字），用于账号标识与回调归属校验。',
      en: 'The numeric Phone Number ID from WhatsApp Manager, used as the account identifier and for callback checks.',
    },
    placeholder: { zh: '例如：1029384756', en: 'For example: 1029384756' },
  },
  {
    key: 'accessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Graph API Access Token', en: 'Graph API access token' },
    description: {
      zh: 'Meta 系统用户或临时 Graph API Token，需要 whatsapp_business_messaging 权限；保存时留空保留已有值。',
      en: 'A Meta system-user or temporary Graph API token with whatsapp_business_messaging. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'App Secret', en: 'App Secret' },
    description: {
      zh: 'Meta 应用的 App Secret，用于校验 X-Hub-Signature-256；保存时留空保留已有值。',
      en: 'The Meta app secret used to verify X-Hub-Signature-256. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'verifyToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Webhook Verify Token', en: 'Webhook verify token' },
    description: {
      zh: '后台订阅 Webhook 时填写的验证令牌，服务用 GET 校验回调；保存时留空保留已有值。',
      en: 'The verify token configured in the webhook subscription, checked by GET callbacks. Leave empty to keep the stored value.',
    },
  },
];

const mattermostCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'baseUrl',
    type: 'text',
    required: true,
    label: { zh: 'Mattermost 服务器地址', en: 'Mattermost server URL' },
    description: {
      zh: '服务器根地址，例如 https://mattermost.example.com，不需要结尾斜杠。',
      en: 'Server root URL such as https://mattermost.example.com, without a trailing slash.',
    },
    placeholder: { zh: 'https://mattermost.example.com', en: 'https://mattermost.example.com' },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Outgoing Webhook Token', en: 'Outgoing webhook token' },
    description: {
      zh: '集成 → 传出 Webhook 里生成的 Token，用于校验回调并定位账号；保存时留空保留已有值。',
      en: 'The token generated for the outgoing webhook, used to verify callbacks and resolve the account. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'accessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Access Token', en: 'Bot access token' },
    description: {
      zh: '机器人账号或个人访问令牌，需要创建帖子的权限；保存时留空保留已有值。',
      en: 'A bot or personal access token allowed to create posts. Leave empty to keep the stored value.',
    },
  },
];

const discordCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'botId',
    type: 'text',
    required: true,
    label: { zh: 'Application ID / Bot User ID', en: 'Application ID / Bot user ID' },
    description: {
      zh: 'Discord Developer Portal 的 Application ID，也是机器人用户 ID，用于账号标识与 @ 检测。',
      en: 'The Application ID from the Discord Developer Portal, which is also the bot user ID, used for account identity and mention checks.',
    },
    placeholder: { zh: '例如：123456789012345678', en: 'For example: 123456789012345678' },
  },
  {
    key: 'botToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Token', en: 'Bot Token' },
    description: {
      zh: 'Developer Portal → Bot 中的 Token；需要在 Bot 页面开启 Message Content Intent。保存时留空保留已有值。',
      en: 'The bot token from Developer Portal → Bot. Enable the Message Content Intent on the Bot page. Leave empty to keep the stored value.',
    },
    placeholder: { zh: 'MTIz...', en: 'MTIz...' },
  },
];

const satoriCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'endpoint',
    type: 'text',
    required: true,
    label: { zh: 'Satori 服务地址', en: 'Satori server URL' },
    description: {
      zh: 'Satori SDK 的 HTTP 地址，例如 http://127.0.0.1:5140；服务会连接 /v1/events 并调用 /v1/message.create。',
      en: 'The Satori SDK HTTP base URL, for example http://127.0.0.1:5140. The service connects to /v1/events and calls /v1/message.create.',
    },
    placeholder: { zh: 'http://127.0.0.1:5140', en: 'http://127.0.0.1:5140' },
  },
  {
    key: 'platform',
    type: 'text',
    required: true,
    label: { zh: '平台标识（platform）', en: 'Platform name' },
    description: {
      zh: 'Satori READY 中的 platform，例如 onebot、discord、telegram，用于发送时选择登录实例。',
      en: 'The platform name from Satori READY, such as onebot, discord, or telegram, used to select the login when sending.',
    },
    placeholder: { zh: '例如：onebot', en: 'For example: onebot' },
  },
  {
    key: 'selfId',
    type: 'text',
    required: true,
    label: { zh: '机器人 ID（self_id）', en: 'Bot ID (self_id)' },
    description: {
      zh: '机器人在该平台上的 ID，用于账号标识与 @ 检测。',
      en: 'The bot ID on that platform, used for account identity and mention checks.',
    },
    placeholder: { zh: '例如：100012345', en: 'For example: 100012345' },
  },
  {
    key: 'token',
    type: 'text',
    secret: true,
    label: { zh: '访问令牌（可选）', en: 'Access token (optional)' },
    description: {
      zh: 'Satori SDK 配置的鉴权令牌；SDK 未启用鉴权时留空。保存时留空保留已有值。',
      en: 'The token configured in the Satori SDK; leave empty when the SDK has no auth. Leave empty to keep the stored value.',
    },
  },
];

const kookCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'botId',
    type: 'text',
    required: true,
    label: { zh: '机器人 ID', en: 'Bot ID' },
    description: {
      zh: 'KOOK 开发者中心机器人页面的 Bot ID，用于账号标识与 @ 检测。',
      en: 'The Bot ID shown on the KOOK developer portal, used as the account identifier and for mention checks.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Token', en: 'Bot Token' },
    description: {
      zh: 'KOOK 机器人 Token，用于 Gateway 与 REST API；保存时留空保留已有值。',
      en: 'The KOOK bot token for the gateway and REST API. Leave empty to keep the stored value.',
    },
  },
];

const wecomCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'corpId',
    type: 'text',
    required: true,
    label: { zh: 'CorpID', en: 'CorpID' },
    description: {
      zh: '企业微信「我的企业 → 企业信息」中的 CorpID，用于账号标识与回调解密校验。',
      en: 'The CorpID from WeCom enterprise settings, used as the account identifier and to validate decrypted callbacks.',
    },
    placeholder: { zh: '例如：ww1234567890abcdef', en: 'For example: ww1234567890abcdef' },
  },
  {
    key: 'agentId',
    type: 'text',
    required: true,
    label: { zh: 'AgentID', en: 'AgentID' },
    description: {
      zh: '自建应用的 AgentID（数字），用于发送应用消息。',
      en: 'The numeric AgentID of the self-built app, used when sending app messages.',
    },
  },
  {
    key: 'secret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '应用 Secret', en: 'App Secret' },
    description: {
      zh: '自建应用的 Secret，用于获取 access_token；保存时留空保留已有值。',
      en: 'The app secret used for access tokens. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '回调 Token', en: 'Callback Token' },
    description: {
      zh: '「接收消息服务器配置」中的 Token，用于校验回调签名；保存时留空保留已有值。',
      en: 'The Token from the receive-message server configuration, used to verify callback signatures. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'encodingAESKey',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'EncodingAESKey', en: 'EncodingAESKey' },
    description: {
      zh: '「接收消息服务器配置」中的 43 位 EncodingAESKey，用于解密回调与校验 CorpID；保存时留空保留已有值。',
      en: 'The 43-character EncodingAESKey from the receive-message configuration, used to decrypt callbacks and check the CorpID. Leave empty to keep the stored value.',
    },
  },
];

const messengerCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'pageId',
    type: 'text',
    required: true,
    label: { zh: 'Facebook 主页 ID', en: 'Facebook Page ID' },
    description: {
      zh: '接收消息的 Facebook 主页 ID，用于匹配回调中的 entry.id。',
      en: 'The Facebook Page ID that receives messages, matched against entry.id in callbacks.',
    },
  },
  {
    key: 'pageAccessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '主页访问令牌', en: 'Page access token' },
    description: {
      zh: 'Messenger Platform 主页访问令牌，用于调用 Send API；保存时留空保留已有值。',
      en: 'The Messenger Platform page access token used by the Send API. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'App Secret', en: 'App Secret' },
    description: {
      zh: 'Meta 应用的 App Secret，用于校验 X-Hub-Signature-256；保存时留空保留已有值。',
      en: 'The Meta app secret used to verify X-Hub-Signature-256. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'verifyToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Verify Token', en: 'Verify token' },
    description: {
      zh: 'Webhook 订阅时填写的 Verify Token，用于 GET 验证；保存时留空保留已有值。',
      en: 'The verify token entered in the webhook subscription and used for the GET challenge. Leave empty to keep the stored value.',
    },
  },
];

const vkCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'groupId',
    type: 'text',
    required: true,
    label: { zh: '群组 ID', en: 'Group ID' },
    description: {
      zh: 'VK 社区（群组）的数字 ID，用于匹配回调中的 group_id。',
      en: 'The numeric VK community (group) ID matched against group_id in callbacks.',
    },
  },
  {
    key: 'accessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '社区访问令牌', en: 'Community access token' },
    description: {
      zh: '具有 messages 权限的社区访问令牌，用于 messages.send；保存时留空保留已有值。',
      en: 'A community access token with the messages scope, used by messages.send. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'secret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Callback Secret', en: 'Callback secret' },
    description: {
      zh: 'Callback API 中填写的 secret，服务会逐条校验回调来源；保存时留空保留已有值。',
      en: 'The secret configured in the Callback API and checked on every callback. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'confirmationToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Confirmation Token', en: 'Confirmation token' },
    description: {
      zh: 'Callback API 的确认字符串，用于回应 VK 的 confirmation 请求；保存时留空保留已有值。',
      en: 'The confirmation string returned for VK confirmation requests. Leave empty to keep the stored value.',
    },
  },
];

const zulipCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'siteUrl',
    type: 'text',
    required: true,
    label: { zh: 'Zulip 站点地址', en: 'Zulip site URL' },
    description: {
      zh: '团队 Zulip 的根地址，例如 https://chat.example.com。',
      en: 'The root URL of the Zulip organization, for example https://chat.example.com.',
    },
    placeholder: { zh: 'https://chat.example.com', en: 'https://chat.example.com' },
  },
  {
    key: 'botEmail',
    type: 'text',
    required: true,
    label: { zh: '机器人邮箱', en: 'Bot email' },
    description: {
      zh: '传出 Webhook 机器人的邮箱，用于识别账号与 API 基本认证。',
      en: 'The outgoing webhook bot email, used as the account identifier and for API basic auth.',
    },
  },
  {
    key: 'apiKey',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '机器人 API Key', en: 'Bot API key' },
    description: {
      zh: '机器人的 API Key，用于发送消息；保存时留空保留已有值。',
      en: 'The bot API key used to send messages. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Webhook Token', en: 'Webhook token' },
    description: {
      zh: '传出 Webhook 机器人配置中的 Token，用于校验回调；保存时留空保留已有值。',
      en: 'The token from the outgoing webhook bot configuration, used to verify callbacks. Leave empty to keep the stored value.',
    },
  },
];

const rocketChatCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'serverUrl',
    type: 'text',
    required: true,
    label: { zh: '服务器地址', en: 'Server URL' },
    description: {
      zh: 'Rocket.Chat 服务器根地址，例如 https://chat.example.com。',
      en: 'The Rocket.Chat server root URL, for example https://chat.example.com.',
    },
    placeholder: { zh: 'https://chat.example.com', en: 'https://chat.example.com' },
  },
  {
    key: 'userId',
    type: 'text',
    required: true,
    label: { zh: '机器人用户 ID', en: 'Bot user ID' },
    description: {
      zh: '发送消息所用账号的 User ID，作为 X-User-Id 请求头与账号标识。',
      en: 'The user ID used for X-User-Id and as the account identifier.',
    },
  },
  {
    key: 'authToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Auth Token', en: 'Auth token' },
    description: {
      zh: '个人访问令牌，作为 X-Auth-Token 发送消息；保存时留空保留已有值。',
      en: 'The personal access token sent as X-Auth-Token. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Webhook Token', en: 'Webhook token' },
    description: {
      zh: '传出 Webhook 集成中的 Token，用于校验回调；保存时留空保留已有值。',
      en: 'The token from the outgoing webhook integration, used to verify callbacks. Leave empty to keep the stored value.',
    },
  },
];

const dodoCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'clientId',
    type: 'text',
    required: true,
    label: { zh: 'Client ID', en: 'Client ID' },
    description: {
      zh: 'DoDo 开放平台的机器人 Client ID，用于鉴权头 Bot {clientId}.{token}。',
      en: 'The DoDo open platform Client ID used in the Bot {clientId}.{token} authorization header.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Token', en: 'Bot token' },
    description: {
      zh: 'DoDo 机器人 Token，用于 WebSocket 与开放接口；保存时留空保留已有值。',
      en: 'The DoDo bot token used for the WebSocket and open API. Leave empty to keep the stored value.',
    },
  },
];

const matrixCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'homeserverUrl',
    type: 'text',
    required: true,
    label: { zh: 'Homeserver 地址', en: 'Homeserver URL' },
    description: {
      zh: 'Matrix homeserver 根地址，例如 https://matrix.org。',
      en: 'The Matrix homeserver root URL, for example https://matrix.org.',
    },
    placeholder: { zh: 'https://matrix.org', en: 'https://matrix.org' },
  },
  {
    key: 'userId',
    type: 'text',
    required: true,
    label: { zh: '机器人用户 ID', en: 'Bot user ID' },
    description: {
      zh: '机器人完整 MXID，例如 @bot:example.com，用于过滤自身消息。',
      en: 'The bot MXID, for example @bot:example.com, used to skip its own messages.',
    },
    placeholder: { zh: '@bot:example.com', en: '@bot:example.com' },
  },
  {
    key: 'accessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Access Token', en: 'Access token' },
    description: {
      zh: '机器人账号的访问令牌；仅支持未加密房间，E2EE 需要额外设备验证。保存时留空保留已有值。',
      en: 'The bot access token. Only unencrypted rooms are supported; E2EE needs device verification. Leave empty to keep the stored value.',
    },
  },
];

const revoltCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'botId',
    type: 'text',
    required: true,
    label: { zh: '机器人用户 ID', en: 'Bot user ID' },
    description: {
      zh: 'Revolt 机器人账号的用户 ID，用于 @ 检测与账号标识。',
      en: 'The Revolt bot user ID used for mention checks and as the account identifier.',
    },
  },
  {
    key: 'botToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Bot Token', en: 'Bot token' },
    description: {
      zh: 'Revolt 机器人 Token，用于 WebSocket 鉴权与 x-bot-token 请求头；保存时留空保留已有值。',
      en: 'The Revolt bot token for WebSocket authentication and the x-bot-token header. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'apiUrl',
    type: 'text',
    required: false,
    label: { zh: 'API 地址（可选）', en: 'API URL (optional)' },
    description: {
      zh: '自建实例的 REST 地址；留空使用 https://api.revolt.chat。',
      en: 'REST URL for self-hosted instances; leave empty to use https://api.revolt.chat.',
    },
    placeholder: { zh: 'https://api.revolt.chat', en: 'https://api.revolt.chat' },
  },
  {
    key: 'wsUrl',
    type: 'text',
    required: false,
    label: { zh: 'WebSocket 地址（可选）', en: 'WebSocket URL (optional)' },
    description: {
      zh: '自建实例的事件网关地址；留空使用 wss://ws.revolt.chat。',
      en: 'Event gateway URL for self-hosted instances; leave empty to use wss://ws.revolt.chat.',
    },
    placeholder: { zh: 'wss://ws.revolt.chat', en: 'wss://ws.revolt.chat' },
  },
];

const mastodonCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'instanceUrl',
    type: 'text',
    required: true,
    label: { zh: '实例地址', en: 'Instance URL' },
    description: {
      zh: 'Mastodon 实例根地址，例如 https://mastodon.social。',
      en: 'The Mastodon instance root URL, for example https://mastodon.social.',
    },
    placeholder: { zh: 'https://mastodon.social', en: 'https://mastodon.social' },
  },
  {
    key: 'accountId',
    type: 'text',
    required: true,
    label: { zh: '机器人账号 ID', en: 'Bot account ID' },
    description: {
      zh: '机器人账号的本地数字 ID，用于过滤自己发布的状态并作为账号标识。',
      en: 'The bot local numeric account ID, used to skip its own statuses and as the account identifier.',
    },
  },
  {
    key: 'accessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '访问令牌', en: 'Access token' },
    description: {
      zh: '具有 read:statuses 与 write:statuses 权限的访问令牌；保存时留空保留已有值。',
      en: 'An access token with read:statuses and write:statuses scopes. Leave empty to keep the stored value.',
    },
  },
];

const instagramCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'igUserId',
    type: 'text',
    required: true,
    label: { zh: 'Instagram 专业账号 ID', en: 'Instagram professional account ID' },
    description: {
      zh: '与主页绑定的 Instagram 专业账号 ID，用于匹配回调中的 entry.id 与发送消息。',
      en: 'The Instagram professional account ID linked to the Page, matched against entry.id and used for sending.',
    },
  },
  {
    key: 'pageAccessToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '主页访问令牌', en: 'Page access token' },
    description: {
      zh: '具有 instagram_manage_messages 权限的主页访问令牌；保存时留空保留已有值。',
      en: 'A Page access token with instagram_manage_messages. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'appSecret',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'App Secret', en: 'App Secret' },
    description: {
      zh: 'Meta 应用的 App Secret，用于校验 X-Hub-Signature-256；保存时留空保留已有值。',
      en: 'The Meta app secret used to verify X-Hub-Signature-256. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'verifyToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Verify Token', en: 'Verify token' },
    description: {
      zh: 'Webhook 订阅时填写的 Verify Token，用于 GET 验证；保存时留空保留已有值。',
      en: 'The verify token from the webhook subscription, used for the GET challenge. Leave empty to keep the stored value.',
    },
  },
];

const viberCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'authToken',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: 'Auth Token', en: 'Auth token' },
    description: {
      zh: 'Viber 管理后台的机器人 Auth Token，用于校验回调签名与发送消息；保存时留空保留已有值。',
      en: 'The Viber bot auth token used to verify callback signatures and send messages. Leave empty to keep the stored value.',
    },
  },
  {
    key: 'botName',
    type: 'text',
    required: true,
    label: { zh: '机器人名称', en: 'Bot name' },
    description: {
      zh: '发送消息时使用的机器人显示名称，需要与 Viber 后台的机器人名称一致。',
      en: 'The bot display name used when sending, which must match the name configured in the Viber console.',
    },
  },
];

const misskeyCredentialFields: PluginFieldDefinition[] = [
  {
    key: 'host',
    type: 'text',
    required: true,
    label: { zh: '实例地址', en: 'Instance URL' },
    description: {
      zh: 'Misskey 实例根地址，例如 https://misskey.io。',
      en: 'The Misskey instance root URL, for example https://misskey.io.',
    },
    placeholder: { zh: 'https://misskey.io', en: 'https://misskey.io' },
  },
  {
    key: 'userId',
    type: 'text',
    required: true,
    label: { zh: '机器人用户 ID', en: 'Bot user ID' },
    description: {
      zh: '机器人账号的 userId，用于过滤自己的帖子与 @ 检测。',
      en: 'The bot userId, used to skip its own notes and detect mentions.',
    },
  },
  {
    key: 'token',
    type: 'text',
    required: true,
    secret: true,
    label: { zh: '访问令牌', en: 'Access token' },
    description: {
      zh: '机器人账号的 API Token，同时用于流式连接与发帖；保存时留空保留已有值。',
      en: 'The bot API token used for streaming and posting. Leave empty to keep the stored value.',
    },
  },
];

const builtinChatProtocols: ChatProtocolDefinition[] = [
  {
    id: 'qq',
    name: { zh: 'QQ 官方机器人', en: 'QQ official bot' },
    description: {
      zh: 'QQ 开放平台 Webhook 或 Cloudflare Durable Objects WebSocket 网关。',
      en: 'QQ Open Platform Webhooks, or the Cloudflare Durable Objects WebSocket gateway.',
    },
    identifierField: 'appId',
    webhookPath: '/webhook/qq',
    credentialFields: qqCredentialFields,
    proactive: true,
  },
  {
    id: 'feishu',
    name: { zh: '飞书 / Lark', en: 'Feishu / Lark' },
    description: {
      zh: '飞书开放平台事件订阅（im.message.receive_v1），支持群聊、私聊与主动发送。',
      en: 'Feishu Open Platform event subscriptions (im.message.receive_v1) for groups, direct messages and proactive sends.',
    },
    identifierField: 'appId',
    webhookPath: '/webhook/feishu',
    credentialFields: feishuCredentialFields,
    proactive: true,
  },
  {
    id: 'dingtalk',
    name: { zh: '钉钉机器人', en: 'DingTalk robot' },
    description: {
      zh: '钉钉企业内部机器人回调，使用 sessionWebhook 回复，并可主动发送群聊或工作通知。',
      en: 'DingTalk internal robot callbacks replied through sessionWebhook, with proactive group or direct sends.',
    },
    identifierField: 'appKey',
    webhookPath: '/webhook/dingtalk',
    credentialFields: dingtalkCredentialFields,
    proactive: true,
  },
  {
    id: 'wechat',
    name: { zh: '微信公众号', en: 'WeChat Official Account' },
    description: {
      zh: '微信公众号服务器配置（明文模式），通过客服消息接口回复文本与媒体。',
      en: 'WeChat Official Account server configuration (plaintext mode) replying through the customer-service message API.',
    },
    identifierField: 'appId',
    webhookPath: '/webhook/wechat',
    credentialFields: wechatCredentialFields,
    proactive: true,
  },
  {
    id: 'onebot',
    name: { zh: 'OneBot v11', en: 'OneBot v11' },
    description: {
      zh: 'OneBot v11 HTTP 上报与 API，可接 NapCat、go-cqhttp、Koishi、Red 以及带 OneBot 插件的 Mirai。',
      en: 'OneBot v11 HTTP reports and API for NapCat, go-cqhttp, Koishi, Red, and Mirai with an OneBot plugin.',
    },
    identifierField: 'selfId',
    secretField: 'secret',
    requiresSecret: false,
    webhookPath: '/webhook/onebot',
    credentialFields: onebotCredentialFields,
    proactive: true,
  },
  {
    id: 'telegram',
    name: { zh: 'Telegram', en: 'Telegram' },
    description: {
      zh: 'Telegram Bot API Webhook，支持私聊、群组、文本与媒体发送。',
      en: 'Telegram Bot API Webhook for private chats, groups, text, and media.',
    },
    identifierField: 'botId',
    verificationField: 'secretToken',
    secretField: 'botToken',
    webhookPath: '/webhook/telegram',
    credentialFields: telegramCredentialFields,
    proactive: true,
  },
  {
    id: 'slack',
    name: { zh: 'Slack', en: 'Slack' },
    description: {
      zh: 'Slack Events API 回调，支持频道/私聊消息、文本与文件发送。',
      en: 'Slack Events API callbacks for channel and direct messages, text and file uploads.',
    },
    identifierField: 'appId',
    verificationField: 'signingSecret',
    secretField: 'signingSecret',
    webhookPath: '/webhook/slack',
    credentialFields: slackCredentialFields,
    proactive: true,
  },
  {
    id: 'line',
    name: { zh: 'LINE', en: 'LINE' },
    description: {
      zh: 'LINE Messaging API Webhook，支持私聊与群聊文本回复；媒体需要公网 HTTPS 地址。',
      en: 'LINE Messaging API Webhook for direct and group text replies; media requires public HTTPS URLs.',
    },
    identifierField: 'channelId',
    verificationField: 'channelSecret',
    secretField: 'channelSecret',
    webhookPath: '/webhook/line',
    credentialFields: lineCredentialFields,
    proactive: true,
  },
  {
    id: 'whatsapp',
    name: { zh: 'WhatsApp Cloud API', en: 'WhatsApp Cloud API' },
    description: {
      zh: 'Meta WhatsApp Cloud API Webhook，支持一对一文本、图片、音频、视频与文件。',
      en: 'Meta WhatsApp Cloud API Webhook for one-to-one text, image, audio, video and document messages.',
    },
    identifierField: 'phoneNumberId',
    verificationField: 'verifyToken',
    webhookPath: '/webhook/whatsapp',
    credentialFields: whatsappCredentialFields,
    proactive: true,
  },
  {
    id: 'mattermost',
    name: { zh: 'Mattermost', en: 'Mattermost' },
    description: {
      zh: 'Mattermost 传出 Webhook 回调，通过 REST API 回复频道消息，支持文件上传。',
      en: 'Mattermost outgoing webhook callbacks replying through the REST API, with file uploads.',
    },
    identifierField: 'baseUrl',
    verificationField: 'token',
    secretField: 'token',
    webhookPath: '/webhook/mattermost',
    credentialFields: mattermostCredentialFields,
    proactive: true,
  },
  {
    id: 'discord',
    name: { zh: 'Discord', en: 'Discord' },
    description: {
      zh: 'Discord Bot Gateway（Cloudflare Durable Object WebSocket），支持频道与私聊文本、媒体。',
      en: 'Discord Bot Gateway over a Cloudflare Durable Object WebSocket, supporting channel and direct text and media messages.',
    },
    identifierField: 'botId',
    secretField: 'botToken',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: discordCredentialFields,
    proactive: true,
  },
  {
    id: 'satori',
    name: { zh: 'Satori', en: 'Satori' },
    description: {
      zh: 'Satori 协议 WebSocket（Cloudflare Durable Object），可通过 Koishi 等 Satori SDK 接入多个平台。',
      en: 'Satori protocol WebSocket through a Cloudflare Durable Object, connecting to multiple platforms via Koishi and other Satori SDKs.',
    },
    identifierField: 'selfId',
    secretField: 'token',
    requiresSecret: false,
    transport: 'websocket',
    webhookPath: '',
    credentialFields: satoriCredentialFields,
    proactive: true,
  },
  {
    id: 'kook',
    name: { zh: 'KOOK', en: 'KOOK' },
    description: {
      zh: 'KOOK（开黑啦）Gateway WebSocket，支持频道与私聊文本、图片与文件；需要 Cloudflare Durable Object。',
      en: 'KOOK gateway WebSocket for channel and direct text, image, and file messages; requires a Cloudflare Durable Object.',
    },
    identifierField: 'botId',
    secretField: 'token',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: kookCredentialFields,
    proactive: true,
  },
  {
    id: 'wecom',
    name: { zh: '企业微信', en: 'WeCom' },
    description: {
      zh: '企业微信自建应用回调（加密模式），通过应用消息接口回复文本、图片、语音、视频与文件；仅一对一。',
      en: 'WeCom self-built app callbacks in encrypted mode, replying with app messages for text, image, voice, video and files; direct messages only.',
    },
    identifierField: 'corpId',
    secretField: 'secret',
    webhookPath: '/webhook/wecom',
    credentialFields: wecomCredentialFields,
    proactive: true,
  },
  {
    id: 'messenger',
    name: { zh: 'Facebook Messenger', en: 'Facebook Messenger' },
    description: {
      zh: 'Meta Messenger Platform Webhook，支持主页一对一文本与附件回复。',
      en: 'Meta Messenger Platform Webhooks for one-to-one text and attachment replies.',
    },
    identifierField: 'pageId',
    verificationField: 'verifyToken',
    secretField: 'appSecret',
    webhookPath: '/webhook/messenger',
    credentialFields: messengerCredentialFields,
    proactive: true,
  },
  {
    id: 'vk',
    name: { zh: 'VK', en: 'VK' },
    description: {
      zh: 'VK Callback API，支持社区私聊与群聊文本回复。',
      en: 'VK Callback API for community private and group text replies.',
    },
    identifierField: 'groupId',
    verificationField: 'secret',
    secretField: 'secret',
    webhookPath: '/webhook/vk',
    credentialFields: vkCredentialFields,
    proactive: true,
  },
  {
    id: 'zulip',
    name: { zh: 'Zulip', en: 'Zulip' },
    description: {
      zh: 'Zulip 传出 Webhook 机器人，按频道主题回复，并支持私聊。',
      en: 'Zulip outgoing webhook bots replying into stream topics and direct messages.',
    },
    identifierField: 'botEmail',
    verificationField: 'token',
    secretField: 'token',
    webhookPath: '/webhook/zulip',
    credentialFields: zulipCredentialFields,
    proactive: true,
  },
  {
    id: 'rocketchat',
    name: { zh: 'Rocket.Chat', en: 'Rocket.Chat' },
    description: {
      zh: 'Rocket.Chat 传出 Webhook 集成，通过 REST API 回复频道与私聊消息。',
      en: 'Rocket.Chat outgoing webhook integrations replying through the REST API.',
    },
    identifierField: 'userId',
    verificationField: 'token',
    secretField: 'token',
    webhookPath: '/webhook/rocketchat',
    credentialFields: rocketChatCredentialFields,
    proactive: true,
  },
  {
    id: 'dodo',
    name: { zh: 'DoDo', en: 'DoDo' },
    description: {
      zh: 'DoDo 语音频道社区 WebSocket，支持频道与私聊文本、图片；需要 Cloudflare Durable Object。',
      en: 'DoDo community WebSocket for channel and direct text and images; requires a Cloudflare Durable Object.',
    },
    identifierField: 'clientId',
    secretField: 'token',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: dodoCredentialFields,
    proactive: true,
  },
  {
    id: 'matrix',
    name: { zh: 'Matrix', en: 'Matrix' },
    description: {
      zh: 'Matrix Client-Server API 长轮询同步，支持未加密房间的文本与媒体；需要 Cloudflare Durable Object。',
      en: 'Matrix Client-Server API sync loop for unencrypted rooms with text and media; requires a Cloudflare Durable Object.',
    },
    identifierField: 'userId',
    secretField: 'accessToken',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: matrixCredentialFields,
    proactive: true,
  },
  {
    id: 'revolt',
    name: { zh: 'Revolt', en: 'Revolt' },
    description: {
      zh: 'Revolt Bonfire WebSocket，支持服务器频道与私聊文本；需要 Cloudflare Durable Object。',
      en: 'Revolt Bonfire WebSocket for server channels and direct text; requires a Cloudflare Durable Object.',
    },
    identifierField: 'botId',
    secretField: 'botToken',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: revoltCredentialFields,
    proactive: true,
  },
  {
    id: 'mastodon',
    name: { zh: 'Mastodon', en: 'Mastodon' },
    description: {
      zh: 'Mastodon 用户流 WebSocket，回复 @ 提及与私信；需要 Cloudflare Durable Object。',
      en: 'Mastodon user streaming WebSocket replying to mentions and direct messages; requires a Cloudflare Durable Object.',
    },
    identifierField: 'accountId',
    secretField: 'accessToken',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: mastodonCredentialFields,
    proactive: true,
  },
  {
    id: 'instagram',
    name: { zh: 'Instagram Messaging', en: 'Instagram Messaging' },
    description: {
      zh: 'Instagram 专业账号消息 Webhook，支持一对一文本回复。',
      en: 'Instagram professional account messaging Webhooks for one-to-one text replies.',
    },
    identifierField: 'igUserId',
    verificationField: 'verifyToken',
    secretField: 'appSecret',
    webhookPath: '/webhook/instagram',
    credentialFields: instagramCredentialFields,
    proactive: true,
  },
  {
    id: 'viber',
    name: { zh: 'Viber', en: 'Viber' },
    description: {
      zh: 'Viber 机器人 Webhook，支持一对一文本回复。',
      en: 'Viber bot Webhooks for one-to-one text replies.',
    },
    identifierField: 'authToken',
    verificationField: 'authToken',
    secretField: 'authToken',
    webhookPath: '/webhook/viber',
    credentialFields: viberCredentialFields,
    proactive: true,
  },
  {
    id: 'misskey',
    name: { zh: 'Misskey', en: 'Misskey' },
    description: {
      zh: 'Misskey 流式 API WebSocket，回复 @ 提及与私信；需要 Cloudflare Durable Object。',
      en: 'Misskey streaming API WebSocket replying to mentions and direct messages; requires a Cloudflare Durable Object.',
    },
    identifierField: 'userId',
    secretField: 'token',
    transport: 'websocket',
    webhookPath: '',
    credentialFields: misskeyCredentialFields,
    proactive: true,
  },
];

const chatbotDefinition: PluginDefinition = {
  type: CHATBOT_PLUGIN_TYPE,
  protocols: builtinChatProtocols.map((protocol) => protocol.id),
  name: { zh: '群聊助手', en: 'Group Chatbot' },
  description: {
    zh: '接收 QQ、OneBot、Telegram、Slack、LINE、WhatsApp、Discord、Satori、KOOK、企业微信、Messenger、Instagram、Viber、VK、Zulip、Rocket.Chat、DoDo、Matrix、Revolt、Mastodon、Misskey、飞书、钉钉、Mattermost 和微信公众号消息，按各会话的策略调用模型与工具并回复。',
    en: 'Receives QQ, OneBot, Telegram, Slack, LINE, WhatsApp, Discord, Satori, KOOK, WeCom, Messenger, Instagram, Viber, VK, Zulip, Rocket.Chat, DoDo, Matrix, Revolt, Mastodon, Misskey, Feishu, DingTalk, Mattermost and WeChat Official Account messages, applying each conversation’s model and tool policies.',
  },
  configFields: [
    text('web_search_engine', ['搜索方式', 'Search engine'], [
      '免费选项无需密钥：auto 依次尝试 DuckDuckGo、百度、Bing；brave 需要填写 Brave Search API Key。',
      'Free options need no key: auto tries DuckDuckGo, Baidu, then Bing; brave requires a Brave Search API key.',
    ], {
      group: searchGroup,
      default: 'auto',
      hidden: true,
      options: [
        { value: 'auto', label: { zh: 'auto / 自动（DuckDuckGo → 百度 → Bing）', en: 'auto / DuckDuckGo, Baidu, Bing' } },
        { value: 'duckduckgo', label: { zh: 'DuckDuckGo（免费）', en: 'DuckDuckGo (free)' } },
        { value: 'baidu', label: { zh: '百度（免费）', en: 'Baidu (free)' } },
        { value: 'bing', label: { zh: 'Bing（免费）', en: 'Bing (free)' } },
        { value: 'brave', label: { zh: 'Brave（需要密钥）', en: 'Brave (API key)' } },
      ],
    }),
    number('web_search_results', ['搜索结果数量', 'Search results'], [
      '每次搜索返回的结果条数，1–10。',
      'Number of results returned per search, from 1 to 10.',
    ], { group: searchGroup, default: 5, min: 1, max: 10, step: 1, hidden: true }),
    text('brave_api_key', ['Brave Search API Key', 'Brave Search API key'], [
      '仅在搜索方式为 brave 或作为自动兜底时使用；留空则只使用免费搜索。',
      'Used when the search engine is brave or as an automatic fallback; leave empty to use free search only.',
    ], { group: searchGroup, default: '', secret: true, hidden: true }),
  ],
  accountFields: [],
  groupFields: [
    boolean('agent_stream', ['流式模型响应', 'Streaming model response'], [
      '按流式协议读取模型文本、工具调用和用量。须由所选 AI API 支持；聊天平台仍按完整分段发送。',
      'Reads model text, tool calls and usage through streaming. Requires API support; the chat platform still receives complete message parts.',
    ], { group: agentGroup, default: false, scope: 'dialog' }),
    number('agent_max_rounds', ['工具调用轮数上限', 'Maximum tool rounds'], [
      '每次回复最多进行的模型与工具调用轮数，1–25。',
      'Maximum model and tool rounds for each reply, from 1 to 25.',
    ], { group: agentGroup, default: 5, min: 1, max: 25, step: 1, scope: 'dialog' }),
    number('agent_max_output_tokens', ['单次输出 token 上限', 'Maximum output tokens'], [
      '每次模型请求允许的最大输出 token 数。',
      'Maximum output tokens allowed for each model request.',
    ], { group: agentGroup, default: 4096, min: 1, max: 131072, step: 1, scope: 'dialog' }),
    number('agent_temperature', ['回复随机性', 'Temperature'], [
      '控制回复的随机性，0–2；是否支持取决于所选模型。',
      'Controls randomness from 0 to 2; support depends on the selected model.',
    ], { group: agentGroup, default: 0.7, min: 0, max: 2, step: 0.1, scope: 'dialog' }),
    boolean('agent_show_reasoning', ['输出思考内容', 'Show reasoning'], [
      '开启后，模型返回的思考内容会以「思考过程」单独发送到当前会话；部分模型不返回思考内容，开启后也可能没有额外内容。',
      'When enabled, any reasoning text returned by the model is sent to this conversation as a separate “reasoning” message. Some models do not return reasoning.',
    ], { group: agentGroup, default: false }),
    text('bridge_owner_ids', ['管理员 ID', 'Owner IDs'], [
      '管理员即使不在白名单中也会被允许；多个 ID 用逗号分隔。',
      'Owners are allowed even when not on the allowlist; separate multiple IDs with commas.',
    ], { group: bridgeGroup, default: '', multiline: false, placement: 'basic' }),
    boolean('bridge_commands_enabled', ['启用自定义命令', 'Enable custom commands'], [
      '启用后在「命令管理」中配置的自定义命令会在本会话生效；内置 /help、/status 等命令不受影响。',
      'When enabled, custom commands configured in Command management work in this conversation; built-in commands such as /help and /status are unaffected.',
    ], { group: bridgeGroup, default: true, placement: 'basic' }),
    text('bridge_allowed_private', ['允许的私聊', 'Allowed private chats'], [
      '仅对私聊生效：允许的用户 openid，逗号分隔；留空表示不额外限制。群聊以「允许的群 ID」列表为准。',
      'Private chats only: allowed user openids, comma-separated. Empty means no extra restriction. Group chats are scoped by the allowed group ID list instead.',
    ], { group: bridgeGroup, default: '', placement: 'advanced' }),
    text('bridge_mode', ['运行模式', 'Bridge mode'], [
      'chat 正常回复；reserved 可按模板运行；reserved2 仅通过工具发送；closed-agent 仅响应管理员私聊。',
      'chat replies normally; reserved can use a simulation prompt; reserved2 sends only through tools; closed-agent responds only to owner DMs.',
    ], {
      group: bridgeGroup,
      default: 'chat',
      placement: 'basic',
      options: [
        { value: 'chat', label: { zh: 'chat / 正常回复', en: 'chat / normal' } },
        { value: 'reserved', label: { zh: 'reserved / 预留模式', en: 'reserved / simulated mode' } },
        { value: 'reserved2', label: { zh: 'reserved2 / 仅工具发送', en: 'reserved2 / tool send only' } },
        { value: 'closed-agent', label: { zh: 'closed-agent / 仅 owner 私聊', en: 'closed-agent / owner DMs only' } },
      ],
    }),
    text('bridge_reserved_prompt', ['reserved 模拟提示', 'Reserved simulation prompt'], [
      '仅在当前会话为 reserved 模式时追加到系统指令。',
      'Added to system instructions only while this conversation uses reserved mode.',
    ], { group: bridgeGroup, default: '', multiline: true, placement: 'advanced' }),
    text('bridge_reserved2_prompt', ['reserved2 模拟提示', 'Reserved2 simulation prompt'], [
      '仅在当前会话为 reserved2 模式时追加到系统指令。',
      'Added to system instructions only while this conversation uses reserved2 mode.',
    ], { group: bridgeGroup, default: '', multiline: true, placement: 'advanced' }),
    number('bridge_max_message_chars', ['单条消息字符上限', 'Max message chars'], [
      '对应 BRIDGE_MAX_MESSAGE_CHARS，100–4000。超长回复会分段发送。',
      'Maps to BRIDGE_MAX_MESSAGE_CHARS, 100–4000. Long replies are split into parts.',
    ], { group: bridgeGroup, default: 500, min: 100, max: 4000, step: 1, scope: 'identity' }),
    number('bridge_max_messages_per_minute', ['每分钟最多消息数', 'Messages per minute'], [
      '对应 BRIDGE_MAX_MESSAGES_PER_MINUTE，1–60。当前 Worker 按实例内存近似限流。',
      'Maps to BRIDGE_MAX_MESSAGES_PER_MINUTE, 1–60. The Worker applies an in-isolate memory-based limit.',
    ], { group: bridgeGroup, default: 6, min: 1, max: 60, step: 1, scope: 'identity' }),
    number('bridge_group_batch_seconds', ['群消息合并窗口', 'Group batch window'], [
      '合并窗口内的连续会话消息，0–10 秒；0 表示关闭合并。',
      'Combines consecutive conversation messages within 0–10 seconds; 0 disables batching.',
    ], { group: bridgeGroup, default: 1, min: 0, max: 10, step: 0.1, scope: 'identity' }),
    boolean('bridge_slang_enabled', ['学习群聊用语', 'Learn group slang'], [
      '达到消息阈值后抽取候选并使用公共搜索研究；所有候选须由 owner 确认后才会进入模型上下文。',
      'Extracts and researches candidate slang after the message threshold; an owner must confirm candidates before they enter model context.',
    ], { group: contextGroup, default: true, scope: 'identity' }),
    number('bridge_slang_min_messages', ['用语提取消息阈值', 'Slang extraction message threshold'], [
      '累计多少条群消息后启动候选抽取，范围 3–100。',
      'Number of group messages required before extracting candidates, from 3 to 100.',
    ], { group: contextGroup, default: 10, min: 3, max: 100, step: 1, scope: 'identity' }),
    number('bridge_slang_cooldown_seconds', ['用语研究冷却秒数', 'Slang research cooldown'], [
      '两次候选抽取之间的冷却时间，范围 30–86400 秒。',
      'Cooldown between candidate extraction batches, from 30 to 86400 seconds.',
    ], { group: contextGroup, default: 300, min: 30, max: 86400, step: 30, scope: 'identity' }),

    number('max_context', ['上下文 token 预算', 'Context token budget'], [
      '对应 MAX_CONTEXT，4096–2000000。当前 Worker 按约 4 字符/token 近似裁剪历史。',
      'Maps to MAX_CONTEXT, 4096–2000000. The Worker trims history using roughly 4 chars per token.',
    ], { group: contextGroup, default: 262144, min: 4096, max: 2_000_000, step: 1, scope: 'identity' }),
    number('compact_rate', ['上下文压缩比例', 'Context compact rate'], [
      '对应 COMPACT_RATE，0.1–0.99。当前 Worker 使用 max_context × compact_rate 作为近似预算。',
      'Maps to COMPACT_RATE, 0.1–0.99. The Worker uses max_context × compact_rate as an approximate budget.',
    ], { group: contextGroup, default: 0.8, min: 0.1, max: 0.99, step: 0.01, scope: 'identity' }),
    number('bridge_max_media_bytes', ['媒体大小上限', 'Max media bytes'], [
      '单个图片、音频、视频或文件附件的大小上限，1024–33554432 字节。',
      'Maximum bytes for each image, audio, video, or file attachment, from 1024 to 33554432.',
    ], { group: contextGroup, default: 8 * 1024 * 1024, min: 1024, max: 32 * 1024 * 1024, step: 1024, scope: 'identity' }),

    text('timezone', ['会话时区', 'Conversation time zone'], [
      '输入 IANA 时区名称，例如 Asia/Shanghai、America/New_York；留空使用 UTC。',
      'Enter an IANA time-zone name such as Asia/Shanghai or America/New_York; empty uses UTC.',
    ], { group: contextGroup, default: 'UTC', placement: 'advanced' }),
    number('context_history_limit', ['历史消息条数', 'History message limit'], [
      '每次模型请求保留的历史消息条数；0 表示不使用历史。',
      'Number of historical messages retained for each request; 0 disables history.',
    ], { group: contextGroup, default: 50, min: 0, max: 500, step: 1, scope: 'identity' }),
    boolean('memory_enabled', ['启用会话记忆', 'Enable conversation memory'], [
      '为当前群聊或私聊保存可选的长期记忆。不同会话之间不共享。',
      'Stores optional long-term memory for this conversation without sharing across conversations.',
    ], { group: contextGroup, default: false, scope: 'memory' }),
    text('voice_model', ['语音合成模型', 'Speech model'], [
      '使用本会话供应商的语音合成接口；留空不开放 chat_tts。支持 OpenAI /audio/speech、Gemini TTS 与 MiniMax t2a_v2。',
      'Uses this conversation’s provider speech endpoint. Empty disables chat_tts. Supports OpenAI /audio/speech, Gemini TTS and MiniMax t2a_v2.',
    ], { group: voiceGroup, default: '', scope: 'voice' }),
    text('voice_protocol', ['语音接口协议', 'Speech protocol'], [
      'auto 根据模型名识别；也可强制指定 openai、gemini 或 minimax。',
      'auto detects from the model name; you can also force openai, gemini or minimax.',
    ], {
      group: voiceGroup, default: 'auto', scope: 'voice',
      options: [
        { value: 'auto', label: { zh: '自动识别', en: 'Auto detect' } },
        { value: 'openai', label: { zh: 'OpenAI /audio/speech', en: 'OpenAI /audio/speech' } },
        { value: 'gemini', label: { zh: 'Gemini TTS', en: 'Gemini TTS' } },
        { value: 'minimax', label: { zh: 'MiniMax t2a_v2', en: 'MiniMax t2a_v2' } },
      ],
    }),
    text('voice_id', ['语音音色', 'Voice'], [
      '供应商支持的音色 ID；留空使用协议默认音色（OpenAI alloy、Gemini Kore、MiniMax male-qn-qingse）。',
      'Provider-supported voice ID. Empty uses the protocol default (OpenAI alloy, Gemini Kore, MiniMax male-qn-qingse).',
    ], { group: voiceGroup, default: '', scope: 'voice' }),
    number('voice_speed', ['语音语速', 'Speech speed'], [
      '语音合成速度，0.25–4；实际支持范围以供应商接口为准。',
      'Speech speed from 0.25 to 4; actual support depends on the provider.',
    ], { group: voiceGroup, default: 1, min: 0.25, max: 4, step: 0.05, scope: 'voice' }),
    number('voice_max_text_chars', ['语音文本上限', 'Speech text limit'], [
      '单次语音合成的最大字符数，1–4096。',
      'Maximum characters per speech request, from 1 to 4096.',
    ], { group: voiceGroup, default: 500, min: 1, max: 4096, step: 1, scope: 'voice' }),
    number('voice_max_bytes', ['语音大小上限', 'Speech size limit'], [
      '生成语音的大小上限，最多 5 MiB，符合 QQ 富媒体发送限制。',
      'Maximum generated speech size, up to 5 MiB to fit the QQ rich-media limit.',
    ], { group: voiceGroup, default: 5 * 1024 * 1024, min: 1024, max: 5 * 1024 * 1024, step: 1024, scope: 'voice' }),
    number('voice_sends_per_hour', ['每小时语音发送上限', 'Voice sends per hour'], [
      '包含语音素材和语音合成的每会话小时上限，1–100，用于控制刷屏。',
      'Per-conversation hourly limit for both saved voice assets and synthesis, from 1 to 100.',
    ], { group: voiceGroup, default: 20, min: 1, max: 100, step: 1, scope: 'voice' }),
    boolean('media_image_enabled', ['允许本会话生图', 'Allow image generation'], [
      '需先在「调用工具」中配置并启用生图工具，并在身份策略授权；这里只放行本会话且费用受所选费用策略约束。',
      'Requires the image tool to be configured and granted by the identity policy; this switch only enables the conversation and spending stays bounded by its cost policy.',
    ], { group: mediaGroup, default: false }),
    text('media_image_size', ['生图尺寸档位', 'Image size tier'], [
      '1K / 2K / 4K 档位决定每张计费单价；实际接口若拒绝该分辨率会直接报错，不会静默降级。',
      'The 1K / 2K / 4K tier selects the per-image price. A provider rejection is reported instead of silently downgrading.',
    ], {
      group: mediaGroup,
      default: '1K',
      options: [
        { value: '1K', label: { zh: '1K / 1024 像素', en: '1K / 1024 px' } },
        { value: '2K', label: { zh: '2K / 2048 像素', en: '2K / 2048 px' } },
        { value: '4K', label: { zh: '4K / 4096 像素', en: '4K / 4096 px' } },
      ],
    }),
    text('media_image_quality', ['生图质量', 'Image quality'], [
      '供应商支持的质量档；只影响接口参数，费用按所选尺寸档位的单张价计算。',
      'Provider quality hint; it only changes the request, while billing uses the selected size tier price.',
    ], {
      group: mediaGroup,
      default: 'low',
      options: [
        { value: 'low', label: { zh: 'low / 快速', en: 'low / fast' } },
        { value: 'medium', label: { zh: 'medium / 均衡', en: 'medium / balanced' } },
        { value: 'high', label: { zh: 'high / 精细', en: 'high / detailed' } },
      ],
    }),
    boolean('media_video_enabled', ['允许本会话生视频', 'Allow video generation'], [
      '需先在「调用工具」中配置并启用视频工具，并在身份策略授权；视频耗时较长且按秒计费。',
      'Requires the video tool to be configured and granted by the identity policy; generation is slow and billed per second.',
    ], { group: mediaGroup, default: false }),
    text('media_video_resolution', ['视频分辨率', 'Video resolution'], [
      '768P 使用基础每秒单价，1080P/2K 使用高清每秒单价；不支持的组合由供应商拒绝。',
      '768P uses the base per-second price; 1080P/2K uses the HD price. Unsupported combinations are rejected by the provider.',
    ], {
      group: mediaGroup,
      default: '768P',
      options: [
        { value: '768P', label: { zh: '768P / 标准', en: '768P / standard' } },
        { value: '1080P', label: { zh: '1080P / 高清', en: '1080P / HD' } },
      ],
    }),
    number('media_video_duration', ['视频时长（秒）', 'Video seconds'], [
      '请求的视频时长，4–15 秒；供应商可能只接受 6 或 10 秒，具体以接口返回为准。',
      'Requested video duration, 4–15 seconds. Some providers accept only 6 or 10 seconds and their error is surfaced.',
    ], { group: mediaGroup, default: 6, min: 4, max: 15, step: 1 }),
    text('media_understanding_provider_id', ['媒体理解供应商', 'Understanding provider'], [
      '当对话模型不能读取图片、音频或视频时，用这个供应商的多模态模型先转写为文字。',
      'When the chat model cannot read images, audio or video, this provider’s multimodal model transcribes it to text first.',
    ], { group: mediaGroup, default: '', hidden: true }),
    text('media_understanding_model', ['媒体理解模型', 'Understanding model'], [
      '支持图片、音频与视频输入的多模态模型；Gemini 模型会自动使用原生接口。',
      'A multimodal model that accepts image, audio and video input; Gemini models use the native API automatically.',
    ], { group: mediaGroup, default: '', hidden: true }),
    text('media_understanding_mode', ['媒体理解模式', 'Understanding mode'], [
      'fallback 只在对话模型不支持该附件时转写；always 始终先转写；off 关闭。',
      'fallback transcribes only unsupported attachments; always transcribes every attachment; off disables it.',
    ], {
      group: mediaGroup, default: 'fallback', hidden: true,
      options: [
        { value: 'fallback', label: { zh: '仅模型不支持时', en: 'Only when unsupported' } },
        { value: 'always', label: { zh: '始终先转写', en: 'Always transcribe' } },
        { value: 'off', label: { zh: '关闭', en: 'Off' } },
      ],
    }),
    text('media_understanding_protocol', ['媒体理解协议', 'Understanding protocol'], [
      'auto 根据模型名识别；gemini 使用原生 generateContent；openai 使用 chat/completions。',
      'auto detects from the model name; gemini uses native generateContent; openai uses chat/completions.',
    ], {
      group: mediaGroup, default: 'auto', hidden: true,
      options: [
        { value: 'auto', label: { zh: '自动识别', en: 'Auto detect' } },
        { value: 'gemini', label: { zh: 'Gemini 原生', en: 'Gemini native' } },
        { value: 'openai', label: { zh: 'OpenAI 兼容', en: 'OpenAI compatible' } },
      ],
    }),
  ],
  credentialFields: qqCredentialFields,
  protocolDefinitions: builtinChatProtocols,
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

/** Chat protocols declared by a plugin type. */
export function chatProtocols(type: string = CHATBOT_PLUGIN_TYPE): ChatProtocolDefinition[] {
  return pluginDefinition(type)?.protocolDefinitions ?? [];
}

export function chatProtocolDefinition(protocol: string | undefined, type: string = CHATBOT_PLUGIN_TYPE): ChatProtocolDefinition | undefined {
  return protocol ? chatProtocols(type).find((entry) => entry.id === protocol) : undefined;
}

/** Credentials are scoped per protocol so unrelated secrets never appear in an account form. */
export function chatProtocolCredentialFields(protocol: string | undefined, type: string = CHATBOT_PLUGIN_TYPE): PluginFieldDefinition[] {
  return chatProtocolDefinition(protocol, type)?.credentialFields ?? pluginDefinition(type)?.credentialFields ?? [];
}

export function chatProtocolLabel(protocol: string | undefined, language: Language, type: string = CHATBOT_PLUGIN_TYPE): string {
  const definition = chatProtocolDefinition(protocol, type);
  if (!definition) return protocol ?? '';
  return localizedText(definition.name, language);
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
  return effectivePolicyConfig(pluginConfig, {}, groupConfig, type);
}

/** Policies referenced by a single conversation; missing entries mean "not selected". */
export interface GroupPolicyLayers {
  identity?: PolicyRecord;
  dialog?: PolicyRecord;
  voice?: PolicyRecord;
  memory?: PolicyRecord;
  cost?: PolicyRecord;
}

/**
 * Fields owned by one capability policy scope. Fields without a scope belong to the
 * conversation record itself (allowlists, reserved prompts, time zone).
 */
export function scopedGroupFields(scope: PolicyScope, type: string = CHATBOT_PLUGIN_TYPE): PluginFieldDefinition[] {
  const fields = pluginDefinition(type)?.groupFields ?? [];
  return fields.filter((field) => (field.scope ?? 'conversation') === scope);
}

export function conversationFields(type: string = CHATBOT_PLUGIN_TYPE): PluginFieldDefinition[] {
  return scopedGroupFields('conversation', type);
}

export function policyFields(policyType: PolicyType, type: string = CHATBOT_PLUGIN_TYPE): PluginFieldDefinition[] {
  return scopedGroupFields(policyType, type);
}

/** Policy-owned fields are never overridden by stored conversation config. */
export function effectivePolicyConfig(
  _pluginConfig: JsonObject | undefined,
  policies: GroupPolicyLayers,
  groupConfig: JsonObject | undefined,
  type: string = CHATBOT_PLUGIN_TYPE,
): JsonObject {
  const fields = pluginDefinition(type)?.groupFields ?? [];
  const merged: JsonObject = {};
  // Plugin-wide search settings are merged by the handler; policy-owned settings never inherit hidden legacy plugin fields.
  for (const [scope, policy] of [['identity', policies.identity], ['dialog', policies.dialog], ['voice', policies.voice], ['memory', policies.memory]] as const) {
    if (!policy?.config) continue;
    for (const field of fields) {
      if (field.scope !== scope) continue;
      const value = policy.config[field.key];
      if (value !== undefined) merged[field.key] = value;
    }
  }
  for (const field of fields) {
    const value = groupConfig?.[field.key];
    if (value === undefined) continue;
    if (!field.scope) merged[field.key] = value;
  }
  merged.memory_enabled = policies.memory?.config?.memory_enabled === true;
  return normalizeFieldValues(fields, merged);
}

export interface ResolvedGroupIdentity {
  persona: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  reasoningEffort: ReasoningEffort;
  skillIds: string[];
  mcpIds: string[];
  ruleIds: string[];
}

/** Identity owns persona, tool authorization and base rules; a group may append local rules. */
export function resolveGroupIdentity(
  group: Pick<GroupRecord, 'providerId' | 'model' | 'systemPrompt'> & Partial<Pick<GroupRecord, 'skillIds' | 'mcpIds' | 'ruleIds'>>,
  identity?: PolicyRecord,
): ResolvedGroupIdentity {
  if (!identity?.enabled) throw new Error('identity_policy_unavailable');
  const providerId = group.providerId && group.model ? group.providerId : identity.providerId ?? '';
  const model = group.providerId && group.model ? group.model : identity.model ?? '';
  return {
    persona: identity.persona ?? '',
    providerId,
    model,
    systemPrompt: [identity.systemPrompt, group.systemPrompt].filter((part) => typeof part === 'string' && part.trim()).join('\n\n'),
    reasoningEffort: identity.reasoningEffort ?? 'default',
    // Conversation-level capabilities are additive; identity grants remain in effect.
    skillIds: [...new Set([...(identity.skillIds ?? []), ...(group.skillIds ?? [])])],
    mcpIds: [...new Set([...(identity.mcpIds ?? []), ...(group.mcpIds ?? [])])],
    ruleIds: [...new Set([...(identity.ruleIds ?? []), ...(group.ruleIds ?? [])])],
  };
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

/** Splits a stored conversation openid list (comma, space or newline separated) into unique ids. */
export function conversationIdList(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean))];
}

/** Canonical stored form of a conversation openid list. */
export function conversationIdText(value: unknown): string {
  return conversationIdList(value).join(',');
}

export function matchesConversationId(value: unknown, id: string): boolean {
  return conversationIdList(value).includes(id);
}

/** First openid of a conversation record, used when a single id must be picked. */
export function primaryConversationId(value: unknown): string {
  return conversationIdList(value)[0] ?? '';
}
