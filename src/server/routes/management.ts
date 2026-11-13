import { Hono, type Context } from 'hono';
import { CHATBOT_PLUGIN_TYPE, DEFAULT_NON_MENTION_REPLY_RATE } from '../../shared/types';
import type { BotAccountRecord, GroupRecord, JsonObject, PolicyType, RecordKind, RuntimeBindings } from '../../shared/types';
import { BUILTIN_CHAT_TOOL_NAMES, missingRequiredField, normalizeFieldValues, pluginDefinition, policyFields, conversationFields, conversationIdList } from '../../shared/plugin-catalog';
import { MODEL_PRICE_CHECKED_AT, MODEL_PRICE_PRESETS } from '../../shared/model-pricing';
import { chatbotCostConsistency } from '../plugins/chatbot/runtime';
import { applyGroupPolicies, loadPolicyLayers } from '../plugins/chatbot/policies';
import { decryptSecrets, encryptSecrets, isEncryptedSecret, redactSecrets } from '../storage/secrets';
import { createRepository, type RecordRepository, type StoredRecord, StorageUnavailableError } from '../storage/repository';

const RECORD_KINDS: RecordKind[] = ['plugins', 'accounts', 'groups', 'providers', 'prices', 'skills', 'mcps', 'rules', 'tools', 'memories', 'policies'];
const ACCOUNT_SCOPED_KINDS = new Set<RecordKind>(['memories']);
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
        config: normalizeFieldValues(definition.configFields, config),
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
      const conversationType = stringField(data, 'conversationType', 'group');
      if (!['group', 'private'].includes(conversationType)) throw new ApiError(400, 'invalid_conversationType');
      const externalIds = conversationIdList(stringField(data, 'externalId').trim());
      if (!externalIds.length || externalIds.length > MAX_CONVERSATION_IDS) throw new ApiError(400, 'invalid_externalId');
      const providerId = stringField(data, 'providerId', '');
      const model = stringField(data, 'model', '');
      if (Boolean(providerId) !== Boolean(model)) throw new ApiError(400, 'provider_model_override_must_be_paired');
      const approvalMode = stringField(data, 'toolApprovalMode', 'per-tool');
      if (!['per-tool', 'all-approve', 'all-allow'].includes(approvalMode)) throw new ApiError(400, 'invalid_toolApprovalMode');
      const rules = objectField(data, 'toolApprovalRules');
      if (Object.entries(rules).some(([name, rule]) => !/^[a-zA-Z0-9_.-]{1,64}$/.test(name) || !['disabled', 'approve', 'allow'].includes(String(rule)))) throw new ApiError(400, 'invalid_toolApprovalRules');
      return {
        ...common,
        accountId: nonEmptyStringField(data, 'accountId'), externalId: externalIds.join(','), conversationType,
        config: objectField(data, 'config'), name: stringField(data, 'name', ''), enabled: booleanField(data, 'enabled', true),
        identityPolicyId: nonEmptyStringField(data, 'identityPolicyId'),
        dialogPolicyId: nonEmptyStringField(data, 'dialogPolicyId'),
        voicePolicyId: stringField(data, 'voicePolicyId', ''),
        memoryPolicyId: stringField(data, 'memoryPolicyId', ''),
        costPolicyId: stringField(data, 'costPolicyId', ''),
        providerId, model,
        systemPrompt: stringField(data, 'systemPrompt', ''),
        nonMentionReplyRate: numberField(data, 'nonMentionReplyRate', DEFAULT_NON_MENTION_REPLY_RATE, 0, 1),
        whitelistEnabled: booleanField(data, 'whitelistEnabled', false),
        whitelistUserIds: stringArrayField(data, 'whitelistUserIds'),
        toolApprovalMode: approvalMode,
        toolApprovalRules: rules,
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
        ...Object.fromEntries(['imageTextInputCostPerMillion', 'imageInputCostPerMillion', 'imageCachedInputCostPerMillion', 'imageOutputCostPerMillion']
          .filter((key) => data[key] !== undefined && data[key] !== null).map((key) => [key, numberField(data, key, 0, 0)])),
        ...(data.sourceUrl === undefined ? {} : { sourceUrl: httpUrl(stringField(data, 'sourceUrl'), 'sourceUrl') }),
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
      if (!['dialog', 'voice', 'identity', 'memory', 'cost'].includes(type)) throw new ApiError(400, 'invalid_type');
      const policyType = type as PolicyType;
      const config = objectField(data, 'config');
      const policyConfig = policyType === 'cost' ? {
        dailyCostLimit: numberField(config, 'dailyCostLimit', 0, 0),
        monthlyCostLimit: numberField(config, 'monthlyCostLimit', 0, 0),
        totalCostLimit: numberField(config, 'totalCostLimit', 0, 0),
      } : policyType === 'memory' ? {
        memoryMode: stringField(config, 'memoryMode', 'manual'),
        maxEntries: numberField(config, 'maxEntries', 100, 1, 1000),
        retentionDays: numberField(config, 'retentionDays', 7, 1, 365),
        memory_enabled: booleanField(config, 'memory_enabled', true),
      } : normalizeFieldValues(policyFields(policyType), config);
      if (policyType === 'memory' && !['manual', 'review', 'auto'].includes(policyConfig.memoryMode as string)) throw new ApiError(400, 'invalid_memoryMode');
      const base = {
        ...common, type: policyType, name: nonEmptyStringField(data, 'name'),
        description: stringField(data, 'description', ''), enabled: booleanField(data, 'enabled', true),
        config: policyConfig,
      };
      if (policyType !== 'identity') return base;
      const reasoningEffort = stringField(data, 'reasoningEffort', 'default');
      if (!['default', 'low', 'medium', 'high'].includes(reasoningEffort)) throw new ApiError(400, 'invalid_reasoningEffort');
      return {
        ...base,
        persona: stringField(data, 'persona', ''),
        providerId: stringField(data, 'providerId', ''),
        model: stringField(data, 'model', ''),
        systemPrompt: stringField(data, 'systemPrompt', ''),
        reasoningEffort,
        skillIds: stringArrayField(data, 'skillIds'),
        mcpIds: stringArrayField(data, 'mcpIds'),
        ruleIds: stringArrayField(data, 'ruleIds'),
        toolIds: stringArrayField(data, 'toolIds'),
      };
    }
    case 'tools': {
      const config = objectField(data, 'config');
      const toolKind = stringField(config, 'kind', 'https');
      if (!['builtin', 'https'].includes(toolKind)) throw new ApiError(400, 'invalid_tool_kind');
      if (toolKind === 'builtin' && !(BUILTIN_CHAT_TOOL_NAMES as readonly string[]).includes(stringField(config, 'name'))) throw new ApiError(400, 'invalid_builtin_tool');
      if (toolKind === 'https') {
        const url = httpUrl(nonEmptyStringField(config, 'url'), 'tool_url');
        if (!url.startsWith('https://')) throw new ApiError(400, 'invalid_tool_url');
      }
      const method = stringField(config, 'method', 'POST');
      if (!['GET', 'POST'].includes(method) || method === 'GET' && booleanField(config, 'readOnly', false) !== true ||
        method === 'POST' && booleanField(config, 'readOnly', false) === true) throw new ApiError(400, 'invalid_tool_method');
      const enabled = booleanField(data, 'enabled', false);
      if (toolKind === 'builtin' && config.name === 'chat_generate_image' && enabled &&
        (!stringField(config, 'providerId', '') || !stringField(config, 'model', '') || numberField(config, 'fallbackCostPerImage', 0, 0) <= 0)) throw new ApiError(400, 'image_tool_requires_provider_model_and_fallback_price');
      return {
        ...common, name: nonEmptyStringField(data, 'name'),
        description: stringField(data, 'description', ''), enabled,
        config: {
          kind: toolKind, name: stringField(config, 'name', ''),
          ...(toolKind === 'https' ? { url: httpUrl(nonEmptyStringField(config, 'url'), 'tool_url') } : {}),
          method, readOnly: booleanField(config, 'readOnly', false),
          ...(config.authToken === undefined ? {} : { authToken: stringField(config, 'authToken') }),
          parameterSchema: objectField(config, 'parameterSchema'),
          providerId: stringField(config, 'providerId', ''), model: stringField(config, 'model', ''),
          fallbackCostPerImage: numberField(config, 'fallbackCostPerImage', 0, 0),
          size: stringField(config, 'size', '1024x1024'), quality: stringField(config, 'quality', 'low'),
        },
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
  const ownFields = conversationFields(definition?.type);
  const presentFields = ownFields.filter((field) => Object.hasOwn(config, field.key));
  record.config = normalizeFieldValues(presentFields, config);
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

const GROUP_POLICY_FIELDS: Array<['identityPolicyId' | 'dialogPolicyId' | 'voicePolicyId' | 'memoryPolicyId' | 'costPolicyId', PolicyType]> = [
  ['identityPolicyId', 'identity'],
  ['dialogPolicyId', 'dialog'],
  ['voicePolicyId', 'voice'],
  ['memoryPolicyId', 'memory'],
  ['costPolicyId', 'cost'],
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
    for (const [field, expected] of GROUP_POLICY_FIELDS) {
      if (!record[field]) continue;
      const policy = await repository.get('policies', record[field] as string);
      if (!policy || policy.type !== expected || policy.enabled !== true) throw new ApiError(400, `invalid_${field}`);
    }
  } else if (kind === 'tools') {
    const config = record.config as JsonObject | undefined;
    if (config?.providerId) await requireRecord('providers', config.providerId as string);
  } else if (kind === 'policies' && record.type === 'identity') {
    if (record.providerId) await requireRecord('providers', record.providerId as string);
    for (const id of record.skillIds as string[] ?? []) await requireRecord('skills', id);
    for (const id of record.mcpIds as string[] ?? []) await requireRecord('mcps', id);
    for (const id of record.ruleIds as string[] ?? []) await requireRecord('rules', id);
    for (const id of record.toolIds as string[] ?? []) {
      if ((BUILTIN_CHAT_TOOL_NAMES as readonly string[]).includes(id)) continue;
      await requireRecord('tools', id);
    }
  }
}

async function assertNotReferenced(repository: RecordRepository, kind: RecordKind, id: string): Promise<void> {
  const checks: Array<[RecordKind, string, string]> = [];
  if (kind === 'plugins') checks.push(['accounts', 'pluginId', id]);
  if (kind === 'accounts') {
    checks.push(['groups', 'accountId', id], ['memories', 'accountId', id]);
  }
  if (kind === 'providers') checks.push(['groups', 'providerId', id], ['policies', 'providerId', id]);
  if (kind === 'skills') checks.push(['groups', 'skillIds', id], ['policies', 'skillIds', id]);
  if (kind === 'mcps') checks.push(['groups', 'mcpIds', id], ['policies', 'mcpIds', id]);
  if (kind === 'rules') checks.push(['groups', 'ruleIds', id], ['policies', 'ruleIds', id]);
  if (kind === 'tools') checks.push(['policies', 'toolIds', id]);
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
    const ownConfig = Object.fromEntries(conversationFields(typeof plugin?.type === 'string' ? plugin.type : undefined)
      .filter((field) => Object.hasOwn(config, field.key)).map((field) => [field.key, config[field.key]]));
    const { skillIds: _skills, mcpIds: _mcps, ruleIds: _rules, reasoningEffort: _effort,
      systemPromptMode: _promptMode, dailyCostLimit: _daily, monthlyCostLimit: _monthly,
      totalCostLimit: _total, inputCostPerMillion: _inputPrice, outputCostPerMillion: _outputPrice,
      ...storedGroup } = record;
    const policies = await loadPolicyLayers(repository, record);
    const migrationRequired: string[] = [];
    if (Number(record.inputCostPerMillion ?? 0) > 0 || Number(record.outputCostPerMillion ?? 0) > 0) migrationRequired.push('legacy_model_price');
    if (!policies.cost && [record.dailyCostLimit, record.monthlyCostLimit, record.totalCostLimit].some((value) => Number(value ?? 0) > 0)) migrationRequired.push('legacy_budget');
    const raw = { ...storedGroup, config: ownConfig } as unknown as GroupRecord;
    const resolved = !migrationRequired.length && policies.identity && policies.dialog
      ? applyGroupPolicies(raw, policies, await readableConfig(plugin?.config as JsonObject | undefined, bindings)) : null;
    record = {
      ...storedGroup, config: ownConfig, conversationType: record.conversationType ?? 'group',
      identityPolicyId: record.identityPolicyId ?? '', dialogPolicyId: record.dialogPolicyId ?? '',
      voicePolicyId: record.voicePolicyId ?? '', memoryPolicyId: record.memoryPolicyId ?? '', costPolicyId: record.costPolicyId ?? '',
      ...(migrationRequired.length ? { migrationRequired } : {}),
      ...(resolved ? { effective: { providerId: resolved.providerId, model: resolved.model, persona: resolved.persona ?? '',
        systemPrompt: resolved.systemPrompt, config: resolved.config, dailyCostLimit: resolved.dailyCostLimit,
        monthlyCostLimit: resolved.monthlyCostLimit, totalCostLimit: resolved.totalCostLimit } } : {}),
    };
  } else if (kind === 'policies') {
    const config = record.config as JsonObject | undefined;
    const type = ['dialog', 'voice', 'identity', 'memory', 'cost'].includes(record.type as string) ? record.type as PolicyType : 'dialog';
    record = {
      ...record,
      enabled: record.enabled !== false,
      description: typeof record.description === 'string' ? record.description : '',
      config: { ...config, ...normalizeFieldValues(policyFields(type), config) },
      ...(type === 'identity' ? {
        providerId: typeof record.providerId === 'string' ? record.providerId : '',
        model: typeof record.model === 'string' ? record.model : '',
        persona: typeof record.persona === 'string' ? record.persona : '',
        systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
        reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : 'default',
        skillIds: Array.isArray(record.skillIds) ? record.skillIds : [],
        mcpIds: Array.isArray(record.mcpIds) ? record.mcpIds : [],
        ruleIds: Array.isArray(record.ruleIds) ? record.ruleIds : [],
        toolIds: Array.isArray(record.toolIds) ? record.toolIds : [],
      } : {}),
    };
  } else if (kind === 'plugins') {
    const config = await readableConfig(record.config as JsonObject | undefined, bindings);
    const definition = pluginDefinition(typeof record.type === 'string' ? record.type : undefined);
    record = { ...record, config: Object.fromEntries((definition?.configFields ?? [])
      .filter((field) => Object.hasOwn(config, field.key)).map((field) => [field.key, config[field.key]])) };
  } else if (kind === 'providers') {
    record = { ...record, priceMultiplier: record.priceMultiplier ?? 1, mediaCapabilities: record.mediaCapabilities ?? ['image'] };
  } else if (kind === 'prices') {
    record = { ...record, unit: record.unit ?? 'tokens' };
  } else if (kind === 'mcps') {
    record = { ...record, config: normalizedMcpConfig(objectField(await redactSecrets(record), 'config')) };
  }
  return redacted(record, kind, bindings);
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
    if (kind === 'groups') {
      if (Number(previous.inputCostPerMillion ?? 0) > 0 || Number(previous.outputCostPerMillion ?? 0) > 0)
        throw new ApiError(409, 'legacy_model_price_requires_migration');
      if ([previous.dailyCostLimit, previous.monthlyCostLimit, previous.totalCostLimit].some((value) => Number(value ?? 0) > 0) && !merged.costPolicyId)
        throw new ApiError(409, 'legacy_budget_requires_cost_policy');
    }
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
