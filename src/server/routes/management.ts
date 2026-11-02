import { Hono, type Context } from 'hono';
import { CHATBOT_PLUGIN_TYPE, DEFAULT_NON_MENTION_REPLY_RATE } from '../../shared/types';
import type { JsonObject, RecordKind, RuntimeBindings } from '../../shared/types';
import { chatbotCostConsistency } from '../plugins/chatbot/runtime';
import { encryptSecrets, redactSecrets } from '../storage/secrets';
import { createRepository, type RecordRepository, type StoredRecord, StorageUnavailableError } from '../storage/repository';

const RECORD_KINDS: RecordKind[] = ['plugins', 'accounts', 'groups', 'providers', 'skills', 'mcps', 'rules'];

export class ApiError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 502 | 503, readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}

function isRecordKind(value: string): value is RecordKind {
  return RECORD_KINDS.includes(value as RecordKind);
}

function requiredObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'invalid_body');
  return value as JsonObject;
}

function stringField(source: JsonObject, key: string, fallback?: string): string {
  const value = source[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new ApiError(400, `invalid_${key}`);
  return value;
}

function booleanField(source: JsonObject, key: string, fallback: boolean): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ApiError(400, `invalid_${key}`);
  return value;
}

function objectField(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, `invalid_${key}`);
  return value as JsonObject;
}

function stringArrayField(source: JsonObject, key: string): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new ApiError(400, `invalid_${key}`);
  return value as string[];
}

function numberField(source: JsonObject, key: string, fallback: number, min?: number, max?: number): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new ApiError(400, `invalid_${key}`);
  }
  return value;
}

function normalizedRecord(kind: RecordKind, data: JsonObject, id: string, createdAt: string, updatedAt: string): StoredRecord {
  const common = { id, createdAt, updatedAt };
  switch (kind) {
    case 'plugins':
      return {
        ...common,
        type: stringField(data, 'type', CHATBOT_PLUGIN_TYPE),
        name: stringField(data, 'name'),
        description: stringField(data, 'description', ''),
        enabled: booleanField(data, 'enabled', true),
        config: objectField(data, 'config'),
      };
    case 'accounts':
      return {
        ...common,
        pluginId: stringField(data, 'pluginId'),
        protocol: stringField(data, 'protocol'),
        name: stringField(data, 'name'),
        enabled: booleanField(data, 'enabled', true),
        credentials: objectField(data, 'credentials'),
        config: objectField(data, 'config'),
      };
    case 'groups': {
      const reasoningEffort = stringField(data, 'reasoningEffort', 'medium');
      if (!['low', 'medium', 'high'].includes(reasoningEffort)) throw new ApiError(400, 'invalid_reasoningEffort');
      return {
        ...common,
        accountId: stringField(data, 'accountId'),
        externalId: stringField(data, 'externalId'),
        name: stringField(data, 'name'),
        enabled: booleanField(data, 'enabled', true),
        providerId: stringField(data, 'providerId'),
        model: stringField(data, 'model', ''),
        systemPrompt: stringField(data, 'systemPrompt', ''),
        reasoningEffort,
        nonMentionReplyRate: numberField(data, 'nonMentionReplyRate', DEFAULT_NON_MENTION_REPLY_RATE, 0, 1),
        whitelistEnabled: booleanField(data, 'whitelistEnabled', false),
        whitelistUserIds: stringArrayField(data, 'whitelistUserIds'),
        inputCostPerMillion: numberField(data, 'inputCostPerMillion', 0, 0),
        outputCostPerMillion: numberField(data, 'outputCostPerMillion', 0, 0),
        dailyCostLimit: numberField(data, 'dailyCostLimit', 0, 0),
        monthlyCostLimit: numberField(data, 'monthlyCostLimit', 0, 0),
        totalCostLimit: numberField(data, 'totalCostLimit', 0, 0),
        skillIds: stringArrayField(data, 'skillIds'),
        mcpIds: stringArrayField(data, 'mcpIds'),
        ruleIds: stringArrayField(data, 'ruleIds'),
      };
    }
    case 'providers':
      return {
        ...common,
        name: stringField(data, 'name'),
        baseUrl: stringField(data, 'baseUrl', ''),
        apiKey: stringField(data, 'apiKey', ''),
        enabled: booleanField(data, 'enabled', true),
        models: stringArrayField(data, 'models'),
      };
    case 'skills':
    case 'mcps':
    case 'rules':
      return {
        ...common,
        name: stringField(data, 'name'),
        description: stringField(data, 'description', ''),
        enabled: booleanField(data, 'enabled', true),
        config: objectField(data, 'config'),
      };
  }
}

async function requestBody(context: Context<{ Bindings: RuntimeBindings }>): Promise<JsonObject> {
  try {
    return requiredObject(await context.req.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json');
  }
}

async function recordRepository(context: Context<{ Bindings: RuntimeBindings }>): Promise<RecordRepository> {
  try {
    return createRepository(context.env);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw new ApiError(503, 'storage_unavailable');
    throw error;
  }
}

function assertKind(kind: string): asserts kind is RecordKind {
  if (!isRecordKind(kind)) throw new ApiError(404, 'not_found');
}

async function assertReferences(repository: RecordRepository, kind: RecordKind, record: StoredRecord): Promise<void> {
  const requireRecord = async (relatedKind: RecordKind, id: string) => {
    if (!id || !(await repository.get(relatedKind, id))) throw new ApiError(400, `invalid_${relatedKind}_reference`);
  };
  if (kind === 'accounts') {
    await requireRecord('plugins', record.pluginId as string);
  } else if (kind === 'groups') {
    await requireRecord('accounts', record.accountId as string);
    await requireRecord('providers', record.providerId as string);
    for (const id of record.skillIds as string[]) await requireRecord('skills', id);
    for (const id of record.mcpIds as string[]) await requireRecord('mcps', id);
    for (const id of record.ruleIds as string[]) await requireRecord('rules', id);
  }
}

async function assertNotReferenced(repository: RecordRepository, kind: RecordKind, id: string): Promise<void> {
  const checks: Array<[RecordKind, string, string]> = [];
  if (kind === 'plugins') checks.push(['accounts', 'pluginId', id]);
  if (kind === 'accounts') checks.push(['groups', 'accountId', id]);
  if (kind === 'providers') checks.push(['groups', 'providerId', id]);
  if (kind === 'skills') checks.push(['groups', 'skillIds', id]);
  if (kind === 'mcps') checks.push(['groups', 'mcpIds', id]);
  if (kind === 'rules') checks.push(['groups', 'ruleIds', id]);
  for (const [relatedKind, field, target] of checks) {
    const records = await repository.list(relatedKind);
    if (records.some((record) => Array.isArray(record[field])
      ? (record[field] as unknown[]).includes(target)
      : record[field] === target)) {
      throw new ApiError(409, 'record_in_use');
    }
  }
}

async function redacted(record: StoredRecord): Promise<StoredRecord> {
  return await redactSecrets(record as JsonObject) as StoredRecord;
}

function groupCostDefaults(record: StoredRecord): StoredRecord {
  const limit = (key: string) => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    ...record,
    dailyCostLimit: limit('dailyCostLimit'),
    monthlyCostLimit: limit('monthlyCostLimit'),
    totalCostLimit: limit('totalCostLimit'),
  };
}

function setCostConsistencyHeader(context: Context<{ Bindings: RuntimeBindings }>, kind: RecordKind): void {
  if (kind === 'groups') context.header('X-Chatbot-Cost-Consistency', chatbotCostConsistency(context.env));
}

export function registerManagementRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/:kind', async (context) => {
    const kind = context.req.param('kind');
    assertKind(kind);
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const records = await repository.list(kind);
    const visibleRecords = kind === 'groups' ? records.map(groupCostDefaults) : records;
    return context.json({ data: await Promise.all(visibleRecords.map(redacted)) });
  });

  api.post('/:kind', async (context) => {
    const kind = context.req.param('kind');
    assertKind(kind);
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const data = await requestBody(context);
    const now = new Date().toISOString();
    const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : crypto.randomUUID();
    if (await repository.get(kind, id)) throw new ApiError(409, 'record_exists');
    const record = normalizedRecord(kind, data, id, now, now);
    await assertReferences(repository, kind, record);
    const encrypted = await encryptSecrets(record, undefined, context.env);
    await repository.put(kind, encrypted);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await redacted(encrypted) }, 201);
  });

  api.get('/:kind/:id', async (context) => {
    const kind = context.req.param('kind');
    assertKind(kind);
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const record = await repository.get(kind, context.req.param('id'));
    if (!record) throw new ApiError(404, 'not_found');
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await redacted(kind === 'groups' ? groupCostDefaults(record) : record) });
  });

  api.on(['PUT', 'PATCH'], '/:kind/:id', async (context) => {
    const { kind, id } = context.req.param();
    assertKind(kind);
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const previous = await repository.get(kind, id);
    if (!previous) throw new ApiError(404, 'not_found');
    const data = await requestBody(context);
    const now = new Date().toISOString();
    const visiblePrevious = await redacted(previous);
    const merged = { ...visiblePrevious, ...data, id } as JsonObject;
    const record = normalizedRecord(kind, merged, id, previous.createdAt, now);
    await assertReferences(repository, kind, record);
    const encrypted = await encryptSecrets(record, previous, context.env);
    await repository.put(kind, encrypted);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await redacted(encrypted) });
  });

  api.delete('/:kind/:id', async (context) => {
    const { kind, id } = context.req.param();
    assertKind(kind);
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    if (!(await repository.get(kind, id))) throw new ApiError(404, 'not_found');
    await assertNotReferenced(repository, kind, id);
    await repository.delete(kind, id);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ ok: true });
  });
}
