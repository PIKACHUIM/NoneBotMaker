export const CHATBOT_PLUGIN_TYPE = 'elysia-best/plugin-chatbot' as const;
export const DEFAULT_NON_MENTION_REPLY_RATE = 0.05;
export const LOG_RETENTION_DAYS = 30;

export type RecordKind = 'plugins' | 'accounts' | 'groups' | 'providers' | 'skills' | 'mcps' | 'rules';
export type JsonObject = Record<string, unknown>;

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

export interface GroupRecord {
  id: string;
  accountId: string;
  externalId: string;
  name: string;
  enabled: boolean;
  providerId: string;
  model: string;
  systemPrompt: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  nonMentionReplyRate: number;
  whitelistEnabled: boolean;
  whitelistUserIds: string[];
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  /** USD budget; 0 means unlimited. */
  dailyCostLimit: number;
  monthlyCostLimit: number;
  totalCostLimit: number;
  skillIds: string[];
  mcpIds: string[];
  ruleIds: string[];
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
export type ConversationDirection = 'in' | 'out';

export interface ConversationLog {
  id: string;
  accountId: string;
  groupId: string;
  groupExternalId: string;
  userId: string;
  direction: ConversationDirection;
  content: string;
  createdAt: number;
  expiresAt: number;
}

export interface NormalizedMessage {
  id: string;
  accountId: string;
  botId: string;
  groupId: string;
  userId: string;
  userName?: string;
  text: string;
  mentionsBot: boolean;
  receivedAt: number;
}

export interface ProviderChatRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
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
  DB_SECRET?: string;
  API_METHOD?: 'webhook' | 'websocket' | string;
  LOG_RECORD?: string;
  LOG_CLEANUP_SECRET?: string;
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
