import { CHATBOT_PLUGIN_TYPE } from '../../../shared/types';
import type {
  ChatMessage,
  D1DatabaseLike,
  LibraryRecord,
  ModelPriceRecord,
  GroupRecord,
  JsonObject,
  KVNamespaceLike,
  ProviderRecord,
  RuntimeBindings,
} from '../../../shared/types';
import { readBoolean } from '../../env';
import type { QQAccountContext, QQGroupMessage } from '../../protocols/qq/types';
import { findModelPrice } from '../../../shared/model-pricing';
import { createD1MatcherSessionStore, PluginRuntime } from '../dispatcher';
import { createConversationLogRepository, type ConversationLogRepository } from '../../storage/conversation-log-repository';
import type { EdgeOneBlobStoreLike } from '../../storage/edgeone-blob-repository';
import { createRepository } from '../../storage/repository';
import { decryptSecrets } from '../../storage/secrets';
import { createChatbotHandler, type ChatbotHandlerDependencies } from './handler';
import { completeRecentTurns } from './tools';

export interface GroupConversationStore {
  getRecent(groupId: string, limit: number): Promise<ChatMessage[]>;
  append(groupId: string, entries: ChatMessage[]): Promise<void>;
  replace?(groupId: string, entries: ChatMessage[]): Promise<void>;
  clear?(groupId: string): Promise<void>;
  getState?(groupId: string): Promise<JsonObject>;
  setState?(groupId: string, state: JsonObject): Promise<void>;
  claimApproval?(scopeKey: string, approvalId: string): Promise<boolean>;
}

export type ChatbotStateConsistency = 'atomic-upsert' | 'eventual' | 'provider-defined' | 'durable-object';

export function chatbotCostConsistency(bindings: RuntimeBindings): string {
  if (bindings.API_METHOD === 'websocket' && bindings.PLATFORM === 'cloudflare') {
    return 'durable-object; check-and-charge-are-separate; concurrent-overage-possible';
  }
  if (bindings.DB) return 'd1-atomic-upsert; check-and-charge-are-separate; concurrent-overage-possible';
  if (bindings.PLATFORM === 'edgeone' && bindings.EDGEONE_BLOB) {
    return 'blob-provider-defined; concurrent-overage-possible';
  }
  if ((bindings.PLATFORM === 'edgeone' && bindings.EDGEONE_KV) ||
      (bindings.PLATFORM === 'esa' && (bindings.ESA_KV ?? bindings.KV)) ||
      bindings.KV) {
    return 'kv-eventual; concurrent-overage-possible';
  }
  return 'unavailable';
}

export interface GroupCostStore {
  readonly consistency: ChatbotStateConsistency;
  isWithinLimits(group: GroupRecord, at: number): Promise<boolean>;
  add(group: GroupRecord, amount: number, at: number): Promise<void>;
}

export interface StoredChatbotDependencies {
  conversationStore: GroupConversationStore;
  costStore: GroupCostStore;
  sendReply: ChatbotHandlerDependencies['sendReply'];
  sendMedia?: ChatbotHandlerDependencies['sendMedia'];
  scheduleWake?: ChatbotHandlerDependencies['scheduleWake'];
  listWakes?: ChatbotHandlerDependencies['listWakes'];
  cancelWake?: ChatbotHandlerDependencies['cancelWake'];
  reserveOutbound?: ChatbotHandlerDependencies['reserveOutbound'];
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

const CONTEXT_PREFIX = 'nonebotmaker:chatbot:context:';
const COST_PREFIX = 'nonebotmaker:chatbot:cost:';
const CHAT_STATE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MAX_CONTEXT_ENTRIES = 1000;

function decodeContext(stored: string | null): ChatMessage[] {
  if (!stored) return [];
  const value = JSON.parse(stored) as ChatMessage[] | { entries: ChatMessage[]; expiresAt: number };
  if (Array.isArray(value)) return value;
  return value.expiresAt > Date.now() ? value.entries : [];
}

function encodeContext(entries: ChatMessage[]): string {
  return JSON.stringify({ entries: completeRecentTurns(entries, MAX_CONTEXT_ENTRIES), expiresAt: Date.now() + CHAT_STATE_RETENTION_SECONDS * 1000 });
}

interface CostState {
  dayKey: string;
  dailySpend: number;
  monthKey: string;
  monthlySpend: number;
  totalSpend: number;
}

interface CostRow {
  day_key: string;
  daily_spend: number;
  month_key: string;
  monthly_spend: number;
  total_spend: number;
}

function periods(at: number): { dayKey: string; monthKey: string } {
  const iso = new Date(at).toISOString();
  return { dayKey: iso.slice(0, 10), monthKey: iso.slice(0, 7) };
}

function storedCostState(value: string | null, at: number): CostState {
  const period = periods(at);
  if (!value) return { ...period, dailySpend: 0, monthlySpend: 0, totalSpend: 0 };
  const stored = JSON.parse(value) as Partial<CostState>;
  return {
    dayKey: period.dayKey,
    dailySpend: stored.dayKey === period.dayKey && Number.isFinite(stored.dailySpend) ? stored.dailySpend as number : 0,
    monthKey: period.monthKey,
    monthlySpend: stored.monthKey === period.monthKey && Number.isFinite(stored.monthlySpend) ? stored.monthlySpend as number : 0,
    totalSpend: Number.isFinite(stored.totalSpend) ? stored.totalSpend as number : 0,
  };
}

function currentCostState(row: CostRow | null, at: number): CostState {
  const period = periods(at);
  return {
    dayKey: period.dayKey,
    dailySpend: row?.day_key === period.dayKey ? row.daily_spend : 0,
    monthKey: period.monthKey,
    monthlySpend: row?.month_key === period.monthKey ? row.monthly_spend : 0,
    totalSpend: row?.total_spend ?? 0,
  };
}

function isWithinLimits(group: GroupRecord, spend: CostState): boolean {
  return !(
    (group.dailyCostLimit > 0 && spend.dailySpend >= group.dailyCostLimit) ||
    (group.monthlyCostLimit > 0 && spend.monthlySpend >= group.monthlyCostLimit) ||
    (group.totalCostLimit > 0 && spend.totalSpend >= group.totalCostLimit)
  );
}

function nextCostState(current: CostState, amount: number): CostState {
  return {
    ...current,
    dailySpend: current.dailySpend + amount,
    monthlySpend: current.monthlySpend + amount,
    totalSpend: current.totalSpend + amount,
  };
}

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

function createKeyValueStores(
  get: (key: string) => Promise<string | null>,
  put: (key: string, value: string, expirationTtl?: number) => Promise<void>,
  consistency: Exclude<ChatbotStateConsistency, 'atomic-upsert' | 'durable-object'>,
): Pick<StoredChatbotDependencies, 'conversationStore' | 'costStore'> {
  return {
    conversationStore: {
      getRecent: async (groupId, limit) => {
        const stored = await get(`${CONTEXT_PREFIX}${encodeId(groupId)}`);
        return completeRecentTurns(decodeContext(stored), limit);
      },
      append: async (groupId, entries) => {
        const key = `${CONTEXT_PREFIX}${encodeId(groupId)}`;
        await put(key, encodeContext([...decodeContext(await get(key)), ...entries]), CHAT_STATE_RETENTION_SECONDS);
      },
      replace: async (groupId, entries) => put(`${CONTEXT_PREFIX}${encodeId(groupId)}`, encodeContext(entries), CHAT_STATE_RETENTION_SECONDS),
      clear: async (groupId) => put(`${CONTEXT_PREFIX}${encodeId(groupId)}`, encodeContext([]), CHAT_STATE_RETENTION_SECONDS),
      getState: async (groupId) => {
        const stored = await get(`${CONTEXT_PREFIX}state:${encodeId(groupId)}`);
        return stored ? JSON.parse(stored) as JsonObject : {};
      },
      setState: async (groupId, state) => put(`${CONTEXT_PREFIX}state:${encodeId(groupId)}`, JSON.stringify(state)),

    },
    costStore: {
      consistency,
      isWithinLimits: async (group, at) => {
        const state = storedCostState(await get(`${COST_PREFIX}${encodeId(group.id)}`), at);
        return isWithinLimits(group, state);
      },
      add: async (group, amount, at) => {
        const key = `${COST_PREFIX}${encodeId(group.id)}`;
        const current = storedCostState(await get(key), at);
        await put(key, JSON.stringify(nextCostState(current, amount)));
      },
    },
  };
}

function createD1ChatbotStores(db: D1DatabaseLike): Pick<StoredChatbotDependencies, 'conversationStore' | 'costStore'> {
  async function getValue(groupId: string): Promise<string | null> {
    const row = await db.prepare('SELECT value, updated_at FROM chatbot_group_context WHERE group_id = ? LIMIT 1')
      .bind(groupId).first<{ value: string; updated_at: number }>();
    return row?.value ?? null;
  }
  async function putValue(groupId: string, value: string): Promise<void> {
    await db.prepare('INSERT INTO chatbot_group_context (group_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(groupId, value, Date.now()).run();
  }
  const contextStore: GroupConversationStore = {
    getRecent: async (groupId, limit) => completeRecentTurns(decodeContext(await getValue(groupId)), limit),
    append: async (groupId, entries) => putValue(groupId, encodeContext([...decodeContext(await getValue(groupId)), ...entries])),
    replace: async (groupId, entries) => putValue(groupId, encodeContext(entries)),
    clear: async (groupId) => putValue(groupId, encodeContext([])),
    getState: async (groupId) => { const value = await getValue(`state:${groupId}`); return value ? JSON.parse(value) as JsonObject : {}; },
    setState: async (groupId, state) => putValue(`state:${groupId}`, JSON.stringify(state)),
    claimApproval: async (scopeKey, approvalId) => {
      const id = JSON.stringify([scopeKey, approvalId]);
      const row = await db.prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO NOTHING RETURNING id')
        .bind('chatbot-approval-claims-v1', id, '{}', new Date().toISOString()).first<{ id: string }>();
      return Boolean(row);
    },
  };
  const costStore: GroupCostStore = {
    consistency: 'atomic-upsert',
    isWithinLimits: async (group, at) => {
      const row = await db.prepare(
        'SELECT day_key, daily_spend, month_key, monthly_spend, total_spend FROM chatbot_group_costs WHERE group_id = ? LIMIT 1',
      ).bind(group.id).first<CostRow>();
      return isWithinLimits(group, currentCostState(row, at));
    },
    add: async (group, amount, at) => {
      const period = periods(at);
      await db.prepare(
        'INSERT INTO chatbot_group_costs (group_id, day_key, daily_spend, month_key, monthly_spend, total_spend) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET daily_spend = CASE WHEN day_key = excluded.day_key THEN daily_spend + excluded.daily_spend ELSE excluded.daily_spend END, day_key = excluded.day_key, monthly_spend = CASE WHEN month_key = excluded.month_key THEN monthly_spend + excluded.monthly_spend ELSE excluded.monthly_spend END, month_key = excluded.month_key, total_spend = total_spend + excluded.total_spend',
      ).bind(group.id, period.dayKey, amount, period.monthKey, amount, amount).run();
    },
  };
  return { conversationStore: contextStore, costStore };
}

function createBlobChatbotStores(blob: EdgeOneBlobStoreLike): Pick<StoredChatbotDependencies, 'conversationStore' | 'costStore'> {
  const get = async (key: string) => {
    const value = await blob.get(key);
    return value === null ? null : typeof value === 'string' ? value : await value.text();
  };
  const put = async (key: string, value: string) => { await blob.put(key, value); };
  return createKeyValueStores(get, put, 'provider-defined');
}

export function createPersistentChatbotStores(
  bindings: RuntimeBindings,
): Pick<StoredChatbotDependencies, 'conversationStore' | 'costStore'> {
  if (bindings.DB) return createD1ChatbotStores(bindings.DB);

  if (bindings.PLATFORM === 'edgeone') {
    const blob = bindings.EDGEONE_BLOB as EdgeOneBlobStoreLike | undefined;
    if (blob) return createBlobChatbotStores(blob);
    const kv = bindings.EDGEONE_KV as KVNamespaceLike | undefined;
    if (kv) return createKeyValueStores(
      (key) => kv.get(key),
      (key, value, expirationTtl) => kv.put(key, value, expirationTtl ? { expirationTtl } : undefined),
      'eventual',
    );
  }

  if (bindings.PLATFORM === 'esa') {
    const kv = (bindings.ESA_KV ?? bindings.KV) as KVNamespaceLike | undefined;
    if (kv) return createKeyValueStores(
      (key) => kv.get(key),
      (key, value, expirationTtl) => kv.put(key, value, expirationTtl ? { expirationTtl } : undefined),
      'eventual',
    );
  }

  if (bindings.KV) return createKeyValueStores(
    (key) => bindings.KV!.get(key),
    (key, value, expirationTtl) => bindings.KV!.put(key, value, expirationTtl ? { expirationTtl } : undefined),
    'eventual',
  );

  throw new Error(`Persistent chatbot state storage is not configured for ${bindings.PLATFORM ?? 'this platform'}. Configure DB, EDGEONE_BLOB/EDGEONE_KV, ESA_KV, or KV.`);
}

export function createStoredChatbotHandler(
  bindings: RuntimeBindings,
  services: StoredChatbotDependencies,
) {
  const records = createRepository(bindings);
  const conversationLogs: Pick<ConversationLogRepository, 'append'> | undefined = readBoolean(bindings.LOG_RECORD)
    ? createConversationLogRepository(bindings)
    : undefined;
  const dependencies: ChatbotHandlerDependencies = {
    findGroup: async (accountId, groupOpenId, conversationType = 'group') => {
      const recordsForAccount = await records.list('groups');
      const group = recordsForAccount.find((record) => record.accountId === accountId && record.externalId === groupOpenId && (record.conversationType ?? 'group') === conversationType);
      return group ? await decryptSecrets(group as JsonObject, bindings) as unknown as GroupRecord : null;
    },
    findProvider: async (providerId) => {
      const provider = await records.get('providers', providerId);
      if (!provider) return null;
      return await decryptSecrets(provider as JsonObject, bindings) as unknown as ProviderRecord;
    },
    findPrice: async (model, unit = 'tokens') => {
      const prices = await records.list('prices') as unknown as ModelPriceRecord[];
      return findModelPrice(prices.filter((price) => (price.unit ?? 'tokens') === unit), model) ?? null;
    },
    findLibrary: async (kind, id) => {
      const library = await records.get(kind, id);
      return library ? await decryptSecrets(library as JsonObject, bindings) as unknown as LibraryRecord : null;
    },
    getRecentContext: (groupId, limit) => services.conversationStore.getRecent(groupId, limit),
    appendContext: (groupId, entries) => services.conversationStore.append(groupId, entries),
    replaceContext: services.conversationStore.replace?.bind(services.conversationStore),
    clearContext: services.conversationStore.clear?.bind(services.conversationStore),
    getState: services.conversationStore.getState?.bind(services.conversationStore),
    setState: services.conversationStore.setState?.bind(services.conversationStore),
    claimApproval: services.conversationStore.claimApproval?.bind(services.conversationStore),
    scheduleWake: services.scheduleWake,
    listWakes: services.listWakes,
    cancelWake: services.cancelWake,
    reserveOutbound: services.reserveOutbound,
    isWithinCostLimits: (group, at) => services.costStore.isWithinLimits(group, at),
    recordGroupCost: (group, amount, at) => services.costStore.add(group, amount, at),
    ...(conversationLogs ? { conversationLogs } : {}),
    logRecord: bindings.LOG_RECORD,
    sendReply: services.sendReply,
    sendMedia: services.sendMedia,
    fetch: services.fetch,
    random: services.random,
    now: services.now,
  };
  const handler = createChatbotHandler(dependencies);
  const runtime = new PluginRuntime({ sessions: bindings.DB ? createD1MatcherSessionStore(bindings) : undefined, now: services.now });
  runtime.register({ id: CHATBOT_PLUGIN_TYPE, matchers: [{ id: 'message', type: 'message', priority: 20, handlers: [async (context) => {
    const account = (context.event.payload as { account: QQAccountContext }).account;
    await handler(account, context.event.message as QQGroupMessage);
  }] }] });
  return async (account: QQAccountContext, message: QQGroupMessage): Promise<void> => {
    const result = await runtime.dispatch({ id: account.account.id, platform: 'qq', send: async (event, text) => services.sendReply(account, event.message!.groupId, event.message!.id, text, { seq: 1, conversationType: event.message?.conversationType ?? 'group' }) },
      { type: 'message', platform: 'qq', botId: account.account.id, sessionId: JSON.stringify([message.conversationType ?? 'group', message.groupId]), userId: message.userId, message, payload: { account } });
    if (result.errors.length) throw result.errors[0].error;
  };
}
