import { Hono, type Context } from 'hono';
import { CHATBOT_PLUGIN_TYPE, DEFAULT_NON_MENTION_REPLY_RATE } from '../../shared/types';
import type { BotAccountRecord, JsonObject, PolicyType, RecordKind, RoleCardSection, RuntimeBindings } from '../../shared/types';
import { missingRequiredField, normalizeFieldValues, pluginDefinition, policyFields, conversationIdList } from '../../shared/plugin-catalog';
import { MODEL_PRICE_CHECKED_AT, MODEL_PRICE_PRESETS } from '../../shared/model-pricing';
import { chatbotCostConsistency } from '../plugins/chatbot/runtime';
import { loadPolicyLayers, resolveGroupConfig } from '../plugins/chatbot/policies';
import { decryptSecrets, encryptSecrets, isEncryptedSecret, redactSecrets } from '../storage/secrets';
import { createRepository, type RecordRepository, type StoredRecord, StorageUnavailableError } from '../storage/repository';

const RECORD_KINDS: RecordKind[] = ['plugins', 'accounts', 'groups', 'providers', 'prices', 'skills', 'mcps', 'rules', 'role_cards', 'memories', 'policies'];
const ACCOUNT_SCOPED_KINDS = new Set<RecordKind>(['role_cards', 'memories']);
const MAX_ROLE_CARD_CONTENT_BYTES = 24 * 1024;
const MAX_CONVERSATION_IDS = 100;

export class ApiError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 502 | 503, readonly code: string) {
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

function nonEmptyStringField(source: JsonObject, key: string): string {
  const value = stringField(source, key);
  if (!value.trim()) throw new ApiError(400, `invalid_${key}`);
  return value;
}

function roleCardSectionsField(value: unknown): RoleCardSection[] {
  if (!Array.isArray(value) || value.some((section) =>
    typeof section !== 'object' || section === null || Array.isArray(section) ||
    typeof (section as JsonObject).heading !== 'string' || typeof (section as JsonObject).mode !== 'string')) {
    throw new ApiError(400, 'invalid_sections');
  }
  return value.map((section) => ({
    heading: (section as JsonObject).heading as string,
    mode: (section as JsonObject).mode as string,
  }));
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

function httpUrl(value: string, key: string): string {
  if (value === '') return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new ApiError(400, `invalid_${key}`);
  }
}

function normalizedMcpConfig(config: JsonObject): JsonObject {
  const result = { ...config };
  result.url = httpUrl(stringField(config, 'url', ''), 'mcp_url');
  const token = config.authToken ?? config.bearerToken ?? config.token;
  if (token !== undefined) {
    if (typeof token !== 'string') throw new ApiError(400, 'invalid_mcp_authToken');
    result.authToken = token.replace(/^Bearer\s+/i, '').trim();
  }
  const allowedTools = config.allowedTools ?? config.tools;
  if (allowedTools !== undefined) {
    if (!Array.isArray(allowedTools) || allowedTools.some((value) => typeof value !== 'string')) {
      throw new ApiError(400, 'invalid_mcp_allowedTools');
    }
    result.allowedTools = [...new Set(allowedTools.map((value) => value.trim()).filter(Boolean))];
  }
  delete result.bearerToken;
  delete result.token;
  delete result.tools;
  return result;
}

function normalizedRecord(kind: RecordKind, data: JsonObject, id: string, createdAt: string, updatedAt: string): StoredRecord {
  const common = { id, createdAt, updatedAt };
  switch (kind) {
    case 'plugins': {
      const type = stringField(data, 'type', CHATBOT_PLUGIN_TYPE);
      const definition = pluginDefinition(type);
      if (!definition) throw new ApiError(400, 'unsupported_plugin_type');
      const config = objectField(data, 'config');
      return {
        ...common,
        type,
        name: stringField(data, 'name'),
        description: stringField(data, 'description', ''),
        enabled: booleanField(data, 'enabled', true),
        config: {
          ...config,
          ...normalizeFieldValues(definition.configFields, config),
          ...normalizeFieldValues(definition.groupFields.filter((field) => config[field.key] !== undefined), config),
        },
      };
    }
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
      if (!['default', 'low', 'medium', 'high'].includes(reasoningEffort)) throw new ApiError(400, 'invalid_reasoningEffort');
      const conversationType = stringField(data, 'conversationType', 'group');
      if (!['group', 'private'].includes(conversationType)) throw new ApiError(400, 'invalid_conversationType');
      const systemPromptMode = stringField(data, 'systemPromptMode', 'inherit');
      if (!['inherit', 'append', 'override'].includes(systemPromptMode)) throw new ApiError(400, 'invalid_systemPromptMode');
      const externalIds = conversationIdList(stringField(data, 'externalId').trim());
      if (externalIds.length > MAX_CONVERSATION_IDS) throw new ApiError(400, 'invalid_externalId');
      return {
        ...common,
        accountId: stringField(data, 'accountId'),
        externalId: externalIds.join(','),
        conversationType,
        config: objectField(data, 'config'),
        name: stringField(data, 'name'),
        enabled: booleanField(data, 'enabled', true),
        dialogPolicyId: stringField(data, 'dialogPolicyId', ''),
        voicePolicyId: stringField(data, 'voicePolicyId', ''),
        identityPolicyId: stringField(data, 'identityPolicyId', ''),
        systemPromptMode,
        providerId: stringField(data, 'providerId', ''),
        model: stringField(data, 'model', ''),
        systemPrompt: stringField(data, 'systemPrompt', ''),
        reasoningEffort,
        nonMentionReplyRate: numberField(data, 'nonMentionReplyRate', DEFAULT_NON_MENTION_REPLY_RATE, 0, 1),
        whitelistEnabled: booleanField(data, 'whitelistEnabled', false),
        whitelistUserIds: stringArrayField(data, 'whitelistUserIds'),
        ...(data.inputCostPerMillion === undefined ? {} : { inputCostPerMillion: numberField(data, 'inputCostPerMillion', 0, 0) }),
        ...(data.outputCostPerMillion === undefined ? {} : { outputCostPerMillion: numberField(data, 'outputCostPerMillion', 0, 0) }),
        dailyCostLimit: numberField(data, 'dailyCostLimit', 0, 0),
        monthlyCostLimit: numberField(data, 'monthlyCostLimit', 0, 0),
        totalCostLimit: numberField(data, 'totalCostLimit', 0, 0),
        skillIds: stringArrayField(data, 'skillIds'),
        mcpIds: stringArrayField(data, 'mcpIds'),
        ruleIds: stringArrayField(data, 'ruleIds'),
      };
    }
    case 'providers': {
      const mediaCapabilities = data.mediaCapabilities === undefined ? ['image'] : stringArrayField(data, 'mediaCapabilities');
      if (mediaCapabilities.some((value) => !['image', 'audio', 'video', 'file', 'speech'].includes(value))) {
        throw new ApiError(400, 'invalid_mediaCapabilities');
      }
      return {
        ...common,
        name: stringField(data, 'name'),
        baseUrl: stringField(data, 'baseUrl', ''),
        apiKey: stringField(data, 'apiKey', ''),
        enabled: booleanField(data, 'enabled', true),
        models: stringArrayField(data, 'models'),
        priceMultiplier: numberField(data, 'priceMultiplier', 1, 0),
        mediaCapabilities: [...new Set(mediaCapabilities)],
      };
    }
    case 'prices': {
      const currency = stringField(data, 'currency', 'USD');
      if (currency !== 'USD') throw new ApiError(400, 'invalid_currency');
      const unit = stringField(data, 'unit', 'tokens');
      if (!['tokens', 'characters'].includes(unit)) throw new ApiError(400, 'invalid_unit');
      const model = stringField(data, 'model').trim();
      if (!model) throw new ApiError(400, 'invalid_model');
      return {
        ...common,
        name: stringField(data, 'name'),
        model,
        currency,
        unit,
        enabled: booleanField(data, 'enabled', true),
        inputCostPerMillion: numberField(data, 'inputCostPerMillion', 0, 0),
        outputCostPerMillion: numberField(data, 'outputCostPerMillion', 0, 0),
        ...(data.cacheInputCostPerMillion === undefined || data.cacheInputCostPerMillion === null ? {} : { cacheInputCostPerMillion: numberField(data, 'cacheInputCostPerMillion', 0, 0) }),
        ...(data.sourceUrl === undefined ? {} : { sourceUrl: httpUrl(stringField(data, 'sourceUrl'), 'sourceUrl') }),
      };
    }
    case 'role_cards': {
      const name = nonEmptyStringField(data, 'name');
      if ([...name].length > 64 || name !== name.trim() || !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(name)) {
        throw new ApiError(400, 'invalid_name');
      }
      const content = stringField(data, 'content');
      if (new TextEncoder().encode(content).byteLength > MAX_ROLE_CARD_CONTENT_BYTES) {
        throw new ApiError(400, 'invalid_content');
      }
      return {
        ...common,
        accountId: nonEmptyStringField(data, 'accountId'),
        name,
        ...(data.description === undefined ? {} : { description: stringField(data, 'description') }),
        content,
        ...(data.mode === undefined ? {} : { mode: stringField(data, 'mode') }),
        ...(data.sections === undefined ? {} : { sections: roleCardSectionsField(data.sections) }),
      };
    }
    case 'memories': {
      const type = stringField(data, 'type');
      if (!['user', 'feedback', 'project', 'reference'].includes(type)) throw new ApiError(400, 'invalid_type');
      return {
        ...common,
        accountId: nonEmptyStringField(data, 'accountId'),
        type,
        name: nonEmptyStringField(data, 'name'),
        title: nonEmptyStringField(data, 'title'),
        desc: stringField(data, 'desc'),
        content: nonEmptyStringField(data, 'content'),
        time: nonEmptyStringField(data, 'time'),
      };
    }
    case 'policies': {
      const type = stringField(data, 'type', 'dialog');
      if (!['dialog', 'voice', 'identity'].includes(type)) throw new ApiError(400, 'invalid_type');
      const policyType = type as PolicyType;
      const config = objectField(data, 'config');
      const base = {
        ...common,
        type: policyType,
        name: stringField(data, 'name'),
        description: stringField(data, 'description', ''),
        enabled: booleanField(data, 'enabled', true),
        config: { ...config, ...normalizeFieldValues(policyFields(policyType), config) },
      };
      if (policyType !== 'identity') return base;
      const reasoningEffort = stringField(data, 'reasoningEffort', 'default');
      if (!['default', 'low', 'medium', 'high'].includes(reasoningEffort)) throw new ApiError(400, 'invalid_reasoningEffort');
      return {
        ...base,
        providerId: stringField(data, 'providerId', ''),
        model: stringField(data, 'model', ''),
        systemPrompt: stringField(data, 'systemPrompt', ''),
        reasoningEffort,
        skillIds: stringArrayField(data, 'skillIds'),
        mcpIds: stringArrayField(data, 'mcpIds'),
        ruleIds: stringArrayField(data, 'ruleIds'),
      };
    }
    case 'skills':
    case 'mcps':
    case 'rules':
      return {
        ...common,
        name: stringField(data, 'name'),
        description: stringField(data, 'description', ''),
        enabled: booleanField(data, 'enabled', true),
        config: kind === 'mcps' ? normalizedMcpConfig(objectField(data, 'config')) : objectField(data, 'config'),
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

async function normalizeAccountCredentials(
  repository: RecordRepository,
  record: StoredRecord,
  previous: StoredRecord | undefined,
  bindings: RuntimeBindings,
): Promise<void> {
  const plugin = await repository.get('plugins', record.pluginId as string);
  const definition = pluginDefinition(typeof plugin?.type === 'string' ? plugin.type : undefined);
  if (!definition) return;

  const submitted = record.credentials as JsonObject;
  const oldAccount = previous ? await decryptSecrets(previous as JsonObject, bindings) as unknown as BotAccountRecord : undefined;
  const supplied = Object.fromEntries(Object.entries(submitted).filter(([, value]) =>
    value !== '' && value !== '********' && value !== undefined && value !== null));
  const credentials: JsonObject = { ...oldAccount?.credentials, ...supplied };
  if (definition.type === CHATBOT_PLUGIN_TYPE) {
    if (record.protocol !== 'qq') throw new ApiError(400, 'unsupported_protocol');
    const explicit = supplied.appSecret;
    const canonical = explicit ?? (credentials.appSecret || undefined);
    const botSecret = credentials.botSecret || undefined;
    const clientSecret = credentials.clientSecret || undefined;
    if (canonical === undefined && botSecret && clientSecret && botSecret !== clientSecret) {
      throw new ApiError(400, 'legacy_secret_conflict_reenter_appSecret');
    }
    credentials.appSecret = canonical ?? botSecret ?? clientSecret;
    if (typeof credentials.appId === 'string') credentials.appId = credentials.appId.trim();
    if (oldAccount && (oldAccount.pluginId !== record.pluginId || oldAccount.credentials.appId !== credentials.appId)) {
      if ((await repository.list('groups')).some((group) => group.accountId === record.id)) {
        throw new ApiError(409, 'account_binding_locked');
      }
    }
    for (const existing of await repository.list('accounts')) {
      if (existing.id === record.id || existing.protocol !== record.protocol) continue;
      const account = await decryptSecrets(existing, bindings) as unknown as BotAccountRecord;
      if (account.credentials?.appId === credentials.appId) throw new ApiError(409, 'duplicate_appId');
    }
  }

  const normalized = normalizeFieldValues(definition.credentialFields, credentials);
  const missing = missingRequiredField(definition.credentialFields, normalized);
  if (missing) throw new ApiError(400, `missing_${missing.key}`);
  record.credentials = normalized;
  record.config = {
    ...(record.config as JsonObject),
    ...normalizeFieldValues(definition.accountFields, record.config as JsonObject),
  };
}

async function readableConfig(config: JsonObject | undefined, bindings: RuntimeBindings): Promise<JsonObject> {
  const count = config?.agent_max_output_tokens;
  if (!isEncryptedSecret(count)) return config ?? {};
  const counts = await decryptSecrets({ agent_max_output_tokens: count }, bindings);
  return { ...config, ...counts };
}

async function normalizeGroupConfig(repository: RecordRepository, record: StoredRecord, bindings: RuntimeBindings, previous?: StoredRecord): Promise<void> {
  if (!record.externalId) throw new ApiError(400, 'invalid_externalId');
  // 会话 openid 列表可随时增减；账号与会话类型决定运行身份，创建后不可变更。
  if (previous && (record.accountId !== previous.accountId ||
    record.conversationType !== (previous.conversationType ?? 'group'))) {
    throw new ApiError(409, 'group_binding_locked');
  }
  const account = await repository.get('accounts', record.accountId as string);
  const plugin = account ? await repository.get('plugins', account.pluginId as string) : null;
  const definition = pluginDefinition(typeof plugin?.type === 'string' ? plugin.type : undefined);
  const config = await readableConfig(record.config as JsonObject, bindings);
  const pluginConfig = await readableConfig(plugin?.config as JsonObject | undefined, bindings);
  record.config = definition ? {
    ...config,
    ...normalizeFieldValues(definition.groupFields, { ...pluginConfig, ...config }),
  } : config;
  const ids = new Set(conversationIdList(record.externalId));
  const duplicate = (await repository.list('groups')).some((group) => group.id !== record.id &&
    group.accountId === record.accountId &&
    (group.conversationType ?? 'group') === record.conversationType &&
    conversationIdList(group.externalId).some((id) => ids.has(id)));
  if (duplicate) throw new ApiError(409, 'duplicate_conversation');
}

function accountScope(kind: RecordKind, getAccountId: (key: string) => string | undefined): string | undefined {
  if (!ACCOUNT_SCOPED_KINDS.has(kind)) return undefined;
  const accountId = getAccountId('accountId');
  if (!accountId?.trim()) throw new ApiError(400, 'missing_accountId');
  return accountId;
}

function assertAccountScope(record: StoredRecord, accountId: string | undefined): void {
  if (accountId !== undefined && record.accountId !== accountId) throw new ApiError(404, 'not_found');
}

const GROUP_POLICY_FIELDS: Array<['dialogPolicyId' | 'voicePolicyId' | 'identityPolicyId', PolicyType]> = [
  ['dialogPolicyId', 'dialog'],
  ['voicePolicyId', 'voice'],
  ['identityPolicyId', 'identity'],
];

async function assertReferences(repository: RecordRepository, kind: RecordKind, record: StoredRecord): Promise<void> {
  const requireRecord = async (relatedKind: RecordKind, id: string) => {
    if (!id || !(await repository.get(relatedKind, id))) throw new ApiError(400, `invalid_${relatedKind}_reference`);
  };
  if (kind === 'accounts') {
    await requireRecord('plugins', record.pluginId as string);
  } else if (ACCOUNT_SCOPED_KINDS.has(kind)) {
    await requireRecord('accounts', record.accountId as string);
  } else if (kind === 'groups') {
    await requireRecord('accounts', record.accountId as string);
    if (record.providerId) await requireRecord('providers', record.providerId as string);
    for (const id of record.skillIds as string[]) await requireRecord('skills', id);
    for (const id of record.mcpIds as string[]) await requireRecord('mcps', id);
    for (const id of record.ruleIds as string[]) await requireRecord('rules', id);
    for (const [field, expected] of GROUP_POLICY_FIELDS) {
      if (!record[field]) continue;
      const policy = await repository.get('policies', record[field] as string);
      if (!policy || policy.type !== expected) throw new ApiError(400, `invalid_${field}`);
    }
  } else if (kind === 'policies' && record.type === 'identity') {
    if (record.providerId) await requireRecord('providers', record.providerId as string);
    for (const id of record.skillIds as string[] ?? []) await requireRecord('skills', id);
    for (const id of record.mcpIds as string[] ?? []) await requireRecord('mcps', id);
    for (const id of record.ruleIds as string[] ?? []) await requireRecord('rules', id);
  }
}

async function assertNotReferenced(repository: RecordRepository, kind: RecordKind, id: string): Promise<void> {
  const checks: Array<[RecordKind, string, string]> = [];
  if (kind === 'plugins') checks.push(['accounts', 'pluginId', id]);
  if (kind === 'accounts') {
    checks.push(['groups', 'accountId', id], ['role_cards', 'accountId', id], ['memories', 'accountId', id]);
  }
  if (kind === 'providers') checks.push(['groups', 'providerId', id], ['policies', 'providerId', id]);
  if (kind === 'skills') checks.push(['groups', 'skillIds', id], ['policies', 'skillIds', id]);
  if (kind === 'mcps') checks.push(['groups', 'mcpIds', id], ['policies', 'mcpIds', id]);
  if (kind === 'rules') checks.push(['groups', 'ruleIds', id], ['policies', 'ruleIds', id]);
  if (kind === 'policies') checks.push(...GROUP_POLICY_FIELDS.map(([field]) => ['groups', field, id] as [RecordKind, string, string]));
  for (const [relatedKind, field, target] of checks) {
    const records = await repository.list(relatedKind);
    if (records.some((record) => Array.isArray(record[field])
      ? (record[field] as unknown[]).includes(target)
      : record[field] === target)) {
      throw new ApiError(409, 'record_in_use');
    }
  }
}

async function redacted(record: StoredRecord, kind?: RecordKind, bindings?: RuntimeBindings): Promise<StoredRecord> {
  const visible = await redactSecrets(record as JsonObject) as StoredRecord;
  if (kind === 'accounts' && bindings) {
    const account = await decryptSecrets(record, bindings) as unknown as BotAccountRecord;
    const credentials = account.credentials ?? {};
    visible.credentials = { appId: credentials.appId ?? '', appSecret: '********', configured: true, masked: true };
    if (!credentials.appSecret && credentials.botSecret && credentials.clientSecret && credentials.botSecret !== credentials.clientSecret) {
      visible.credentialStatus = 'legacy_secret_conflict_reenter_appSecret';
    }
  }
  return visible;
}

async function visibleRecord(repository: RecordRepository, kind: RecordKind, record: StoredRecord, bindings: RuntimeBindings): Promise<StoredRecord> {
  if (kind === 'groups') {
    const account = await repository.get('accounts', record.accountId as string);
    const plugin = account ? await repository.get('plugins', account.pluginId as string) : null;
    const config = await readableConfig(record.config as JsonObject | undefined, bindings);
    const pluginConfig = await readableConfig(plugin?.config as JsonObject | undefined, bindings);
    const policies = await loadPolicyLayers(repository, record);
    record = {
      ...groupCostDefaults(record),
      conversationType: record.conversationType ?? 'group',
      systemPromptMode: record.systemPromptMode ?? 'inherit',
      dialogPolicyId: record.dialogPolicyId ?? '',
      voicePolicyId: record.voicePolicyId ?? '',
      identityPolicyId: record.identityPolicyId ?? '',
      config: { ...config, ...resolveGroupConfig({ config }, policies, pluginConfig) },
    };
  } else if (kind === 'policies') {
    const config = record.config as JsonObject | undefined;
    const type = ['dialog', 'voice', 'identity'].includes(record.type as string) ? record.type as PolicyType : 'dialog';
    record = {
      ...record,
      enabled: record.enabled !== false,
      description: typeof record.description === 'string' ? record.description : '',
      config: { ...config, ...normalizeFieldValues(policyFields(type), config) },
      ...(type === 'identity' ? {
        providerId: typeof record.providerId === 'string' ? record.providerId : '',
        model: typeof record.model === 'string' ? record.model : '',
        systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
        reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : 'default',
        skillIds: Array.isArray(record.skillIds) ? record.skillIds : [],
        mcpIds: Array.isArray(record.mcpIds) ? record.mcpIds : [],
        ruleIds: Array.isArray(record.ruleIds) ? record.ruleIds : [],
      } : {}),
    };
  } else if (kind === 'plugins') {
    record = { ...record, config: await readableConfig(record.config as JsonObject | undefined, bindings) };
  } else if (kind === 'providers') {
    record = { ...record, priceMultiplier: record.priceMultiplier ?? 1, mediaCapabilities: record.mediaCapabilities ?? ['image'] };
  } else if (kind === 'prices') {
    record = { ...record, unit: record.unit ?? 'tokens' };
  } else if (kind === 'mcps') {
    record = { ...record, config: normalizedMcpConfig(objectField(await redactSecrets(record), 'config')) };
  }
  return redacted(record, kind, bindings);
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
  api.get('/prices/presets', (context) => context.json({
    data: MODEL_PRICE_PRESETS,
    checkedAt: MODEL_PRICE_CHECKED_AT,
    realtime: false,
  }));

  api.get('/:kind', async (context) => {
    const kind = context.req.param('kind');
    assertKind(kind);
    const scopedAccountId = accountScope(kind, (key) => context.req.query(key));
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const query = kind === 'memories' ? context.req.query('q')?.trim().toLowerCase() : undefined;
    const records = (await repository.list(kind)).filter((record) =>
      (scopedAccountId === undefined || record.accountId === scopedAccountId) &&
      (!query || ['type', 'name', 'title', 'desc', 'content', 'time'].some((key) =>
        typeof record[key] === 'string' && (record[key] as string).toLowerCase().includes(query))));
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await Promise.all(records.map((record) => visibleRecord(repository, kind, record, context.env))) });
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
    if (kind === 'accounts') await normalizeAccountCredentials(repository, record, undefined, context.env);
    if (kind === 'groups') await normalizeGroupConfig(repository, record, context.env);
    const encrypted = await encryptSecrets(record, undefined, context.env);
    await repository.put(kind, encrypted);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await visibleRecord(repository, kind, encrypted, context.env) }, 201);
  });

  api.get('/:kind/:id', async (context) => {
    const kind = context.req.param('kind');
    assertKind(kind);
    const scopedAccountId = accountScope(kind, (key) => context.req.query(key));
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const record = await repository.get(kind, context.req.param('id'));
    if (!record) throw new ApiError(404, 'not_found');
    assertAccountScope(record, scopedAccountId);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await visibleRecord(repository, kind, record, context.env) });
  });

  api.on(['PUT', 'PATCH'], '/:kind/:id', async (context) => {
    const { kind, id } = context.req.param();
    assertKind(kind);
    const scopedAccountId = accountScope(kind, (key) => context.req.query(key));
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const previous = await repository.get(kind, id);
    if (!previous) throw new ApiError(404, 'not_found');
    assertAccountScope(previous, scopedAccountId);
    const data = await requestBody(context);
    const now = new Date().toISOString();
    const visiblePrevious = await visibleRecord(repository, kind, previous, context.env);
    const merged = { ...visiblePrevious, ...data, id } as JsonObject;
    if (data.config !== undefined) merged.config = { ...objectField(visiblePrevious, 'config'), ...objectField(data, 'config') };
    if (kind === 'mcps') {
      const config = objectField(merged, 'config');
      const incoming = objectField(data, 'config');
      if (incoming.authToken === undefined && (incoming.bearerToken !== undefined || incoming.token !== undefined)) {
        config.authToken = incoming.bearerToken ?? incoming.token;
      }
      if (incoming.allowedTools === undefined && incoming.tools !== undefined) config.allowedTools = incoming.tools;
      const oldConfig = objectField(previous, 'config');
      if (oldConfig.authToken === undefined && (oldConfig.bearerToken !== undefined || oldConfig.token !== undefined) &&
        (!config.authToken || config.authToken === '********')) {
        const clearConfig = objectField(await decryptSecrets(previous, context.env), 'config');
        merged.config = { ...config, authToken: clearConfig.bearerToken ?? clearConfig.token };
      }
    }
    const record = normalizedRecord(kind, merged, id, previous.createdAt, now);
    assertAccountScope(record, scopedAccountId);
    await assertReferences(repository, kind, record);
    if (kind === 'accounts') await normalizeAccountCredentials(repository, record, previous, context.env);
    if (kind === 'groups') await normalizeGroupConfig(repository, record, context.env, previous);
    const encrypted = await encryptSecrets(record, previous, context.env);
    await repository.put(kind, encrypted);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ data: await visibleRecord(repository, kind, encrypted, context.env) });
  });

  api.delete('/:kind/:id', async (context) => {
    const { kind, id } = context.req.param();
    assertKind(kind);
    const scopedAccountId = accountScope(kind, (key) => context.req.query(key));
    setCostConsistencyHeader(context, kind);
    const repository = await recordRepository(context);
    const record = await repository.get(kind, id);
    if (!record) throw new ApiError(404, 'not_found');
    assertAccountScope(record, scopedAccountId);
    await assertNotReferenced(repository, kind, id);
    await repository.delete(kind, id);
    context.header('X-Storage-Consistency', repository.consistency);
    return context.json({ ok: true });
  });
}
