export const CHATBOT_PLUGIN_TYPE = 'elysia-best/plugin-chatbot' as const;
export const DEFAULT_NON_MENTION_REPLY_RATE = 0.05;
export const LOG_RETENTION_DAYS = 30;

export type RecordKind = 'plugins' | 'accounts' | 'groups' | 'providers' | 'prices' | 'skills' | 'mcps' | 'rules' | 'tools' | 'memories' | 'policies';
export type JsonObject = Record<string, unknown>;

/** Reusable capability policies that conversations can reference instead of duplicating fields. */
export type PolicyType = 'dialog' | 'voice' | 'identity' | 'memory' | 'cost';
export type PolicyScope = PolicyType | 'conversation';
export type ToolApprovalMode = 'per-tool' | 'all-approve' | 'all-allow';
export type ToolApprovalRule = 'disabled' | 'approve' | 'allow';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high';
export type SystemPromptMode = 'inherit' | 'append' | 'override';

export type Language = 'zh' | 'en';
export interface LocalizedText {
  zh: string;
  en: string;
}

export type PluginFieldType = 'boolean' | 'text' | 'number';

export interface PluginFieldDefinition {
  key: string;
  type: PluginFieldType;
  label: LocalizedText;
  description: LocalizedText;
  placeholder?: LocalizedText;
  group?: LocalizedText;
  /** Which capability policy owns this field; omitted means the conversation record owns it. */
  scope?: PolicyType;
  /** Where a conversation-scoped field is rendered in the group policy form. */
  placement?: 'basic' | 'persona' | 'advanced';
  options?: Array<{ value: string; label: LocalizedText }>;
  required?: boolean;
  secret?: boolean;
  multiline?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface PluginLogFieldDefinition {
  key: string;
  label: LocalizedText;
}

export interface PluginDefinition {
  type: string;
  name: LocalizedText;
  description: LocalizedText;
  protocols?: string[];
  configFields: PluginFieldDefinition[];
  accountFields: PluginFieldDefinition[];
  groupFields: PluginFieldDefinition[];
  credentialFields: PluginFieldDefinition[];
  logFields?: PluginLogFieldDefinition[];
}

export interface PluginRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface BotAccountRecord {
  id: string;
  pluginId: string;
  protocol: string;
  name: string;
  enabled: boolean;
  credentials: JsonObject;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type ConversationType = 'group' | 'private';

export interface GroupRecord {
  id: string;
  accountId: string;
  externalId: string;
  conversationType?: ConversationType;
  config?: JsonObject;
  name: string;
  enabled: boolean;
  /** Required reusable identity and dialog policies; other policies are optional. */
  dialogPolicyId?: string;
  voicePolicyId?: string;
  identityPolicyId?: string;
  memoryPolicyId?: string;
  costPolicyId?: string;
  /** An approval rule cannot authorize tools absent from the identity policy. */
  toolApprovalMode?: ToolApprovalMode;
  toolApprovalRules?: Record<string, ToolApprovalRule>;
  /** Resolved at runtime from the identity policy, never stored in a conversation. */
  persona?: string;
  /** Resolved memory behavior; only confirmed entries are supplied to the model. */
  memoryPolicy?: { memoryMode: 'manual' | 'review' | 'auto'; maxEntries: number; retentionDays: number };
  /** Legacy values need an explicit migration instead of silently changing spend controls. */
  migrationRequired?: Array<'legacy_model_price' | 'legacy_budget'>;
  /** Read-only effective values; the raw record remains limited to its own fields. */
  effective?: { providerId: string; model: string; persona: string; systemPrompt: string; config: JsonObject; dailyCostLimit: number; monthlyCostLimit: number; totalCostLimit: number };
  /** How the conversation prompt combines with the identity policy prompt. */
  systemPromptMode?: SystemPromptMode;
  /** Empty means "inherit from the identity policy". */
  providerId: string;
  /** Empty means "inherit from the identity policy". */
  model: string;
  systemPrompt: string;
  reasoningEffort: ReasoningEffort;
  nonMentionReplyRate: number;
  whitelistEnabled: boolean;
  whitelistUserIds: string[];
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  /** USD budget; 0 means unlimited. */
  dailyCostLimit: number;
  monthlyCostLimit: number;
  totalCostLimit: number;
  /** Additional ids on top of the identity policy. */
  skillIds: string[];
  mcpIds: string[];
  ruleIds: string[];
  /** Runtime-resolved tool authorization from the identity policy. */
  toolIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRecord {
  id: string;
  type: PolicyType;
  name: string;
  description: string;
  enabled: boolean;
  /** Identity policies only: one default persona and the provider/model for attached conversations. */
  persona?: string;
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  reasoningEffort?: ReasoningEffort;
  skillIds?: string[];
  mcpIds?: string[];
  ruleIds?: string[];
  toolIds?: string[];
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: string[];
  priceMultiplier?: number;
  mediaCapabilities?: Array<'image' | 'audio' | 'video' | 'file' | 'speech'>;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPriceRecord {
  id: string;
  name: string;
  model: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheInputCostPerMillion?: number;
  /** Image generation may price text/image input and image output separately. */
  imageTextInputCostPerMillion?: number;
  imageInputCostPerMillion?: number;
  imageCachedInputCostPerMillion?: number;
  imageOutputCostPerMillion?: number;
  currency: 'USD';
  unit?: 'tokens' | 'characters';
  sourceUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export type LibraryKind = 'skills' | 'mcps' | 'rules';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface ProjectMemoryRecord {
  id: string;
  accountId: string;
  type: MemoryType;
  name: string;
  title: string;
  desc: string;
  content: string;
  time: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationDirection = 'in' | 'out';

export interface ConversationLog {
  id: string;
  pluginId?: string;
  pluginType?: string;
  eventId?: string;
  status?: string;
  details?: JsonObject;
  accountId: string;
  groupId: string;
  groupExternalId: string;
  userId: string;
  direction: ConversationDirection;
  content: string;
  createdAt: number;
  expiresAt: number;
}

export interface MessageAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url: string;
  contentType?: string;
  filename?: string;
  size?: number;
}

export interface NormalizedMessage {
  id: string;
  conversationType?: ConversationType;
  attachments?: MessageAttachment[];
  batchMessages?: NormalizedMessage[];
  accountId: string;
  botId: string;
  groupId: string;
  userId: string;
  userName?: string;
  text: string;
  mentionsBot: boolean;
  receivedAt: number;
}

export interface DatabaseSetupStatus {
  databaseConfigured: boolean;
  schemaReady: boolean;
  missing: string[];
  pendingMigrations: number;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'file'; file: { file_id?: string; file_data?: string; filename?: string } }
  | { type: 'video_url'; video_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description?: string; parameters: JsonObject; strict?: boolean };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ProviderChatRequest {
  stream?: boolean;
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  batch?(statements: D1StatementLike[]): Promise<unknown>;
}

export interface KVNamespaceLike {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

export interface RuntimeBindings {
  SYS_PASSWD?: string;
  SYS_SECRET?: string;
  API_METHOD?: 'webhook' | 'websocket' | string;
  LOG_RECORD?: string;
  LOG_CLEANUP_KV?: KVNamespaceLike;
  PLATFORM?: 'cloudflare' | 'edgeone' | 'esa' | string;
  QQ_BOTS?: string;
  DB?: D1DatabaseLike;
  KV?: KVNamespaceLike;
  EDGEONE_KV?: KVNamespaceLike;
  ESA_KV?: KVNamespaceLike;
  EDGEONE_BLOB?: unknown;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}
