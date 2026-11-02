import type {
  D1DatabaseLike,
  GroupRecord,
  JsonObject,
  KVNamespaceLike,
  ProviderRecord,
  RuntimeBindings,
} from '../../../shared/types';
import { readBoolean } from '../../env';
import type { QQAccountContext } from '../../protocols/qq/types';
import { createConversationLogRepository, type ConversationLogRepository } from '../../storage/conversation-log-repository';
import type { EdgeOneBlobStoreLike } from '../../storage/edgeone-blob-repository';
import { createRepository } from '../../storage/repository';
import { decryptSecrets } from '../../storage/secrets';
import { createChatbotHandler, type ChatbotHandlerDependencies } from './handler';

export interface GroupConversationStore {
  getRecent(groupId: string, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  append(groupId: string, entries: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void>;
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
  sendReply(account: QQAccountContext, groupOpenId: string, messageId: string, content: string): Promise<void>;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

const CONTEXT_PREFIX = 'nonebotmaker:chatbot:context:';
const COST_PREFIX = 'nonebotmaker:chatbot:cost:';
const CHAT_STATE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MAX_CONTEXT_ENTRIES = 40;

type ContextEntry = { role: 'user' | 'assistant'; content: string };

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
        return stored ? (JSON.parse(stored) as ContextEntry[]).slice(-limit) : [];
      },
      append: async (groupId, entries) => {
        const key = `${CONTEXT_PREFIX}${encodeId(groupId)}`;
        const stored = await get(key);
        const current = stored ? JSON.parse(stored) as ContextEntry[] : [];
        await put(key, JSON.stringify([...current, ...entries].slice(-MAX_CONTEXT_ENTRIES)), CHAT_STATE_RETENTION_SECONDS);
      },
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
  const contextStore: GroupConversationStore = {
    getRecent: async (groupId, limit) => {
      const row = await db.prepare('SELECT value FROM chatbot_group_context WHERE group_id = ? LIMIT 1')
        .bind(groupId)
        .first<{ value: string }>();
      return row ? (JSON.parse(row.value) as ContextEntry[]).slice(-limit) : [];
    },
    append: async (groupId, entries) => {
      const existing = await db.prepare('SELECT value FROM chatbot_group_context WHERE group_id = ? LIMIT 1')
        .bind(groupId)
        .first<{ value: string }>();
      const current = existing ? JSON.parse(existing.value) as ContextEntry[] : [];
      await db.prepare(
        'INSERT INTO chatbot_group_context (group_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).bind(groupId, JSON.stringify([...current, ...entries].slice(-MAX_CONTEXT_ENTRIES)), Date.now()).run();
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
    findGroup: async (accountId, groupOpenId) => {
      const recordsForAccount = await records.list('groups');
      const group = recordsForAccount.find((record) => record.accountId === accountId && record.externalId === groupOpenId);
      return group ? group as unknown as GroupRecord : null;
    },
    findProvider: async (providerId) => {
      const provider = await records.get('providers', providerId);
      if (!provider) return null;
      return await decryptSecrets(provider as JsonObject, bindings) as unknown as ProviderRecord;
    },
    getRecentContext: (groupId, limit) => services.conversationStore.getRecent(groupId, limit),
    appendContext: (groupId, entries) => services.conversationStore.append(groupId, entries),
    isWithinCostLimits: (group, at) => services.costStore.isWithinLimits(group, at),
    recordGroupCost: (group, amount, at) => services.costStore.add(group, amount, at),
    ...(conversationLogs ? { conversationLogs } : {}),
    logRecord: bindings.LOG_RECORD,
    sendReply: services.sendReply,
    fetch: services.fetch,
    random: services.random,
    now: services.now,
  };
  return createChatbotHandler(dependencies);
}
