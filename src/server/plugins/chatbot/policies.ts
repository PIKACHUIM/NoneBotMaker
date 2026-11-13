import type { PolicyRecord, PolicyType, GroupRecord, JsonObject } from '../../../shared/types';
import { effectivePolicyConfig, resolveGroupIdentity, type GroupPolicyLayers } from '../../../shared/plugin-catalog';
import type { RecordRepository } from '../../storage/repository';

const POLICY_FIELDS: Array<[PolicyType, 'identityPolicyId' | 'dialogPolicyId' | 'voicePolicyId' | 'memoryPolicyId' | 'costPolicyId']> = [
  ['identity', 'identityPolicyId'],
  ['dialog', 'dialogPolicyId'],
  ['voice', 'voicePolicyId'],
  ['memory', 'memoryPolicyId'],
  ['cost', 'costPolicyId'],
];

/** Policy ids as read from a stored conversation record. */
export type PolicySelection = Record<string, unknown>;

/** Loads the enabled capability policies referenced by one conversation. */
export async function loadPolicyLayers(records: RecordRepository, group: PolicySelection): Promise<GroupPolicyLayers> {
  const loaded = await Promise.all(POLICY_FIELDS.map(async ([type, key]) => {
    const id = typeof group[key] === 'string' ? group[key] : '';
    if (!id) return null;
    const record = await records.get('policies', id);
    if (!record || record.type !== type || record.enabled === false) return null;
    return record as unknown as PolicyRecord;
  }));
  const layers: GroupPolicyLayers = {};
  POLICY_FIELDS.forEach(([type], index) => {
    const policy = loaded[index];
    if (policy) layers[type] = policy;
  });
  return layers;
}

export function hasPolicySelection(group: PolicySelection): boolean {
  return POLICY_FIELDS.some(([, key]) => typeof group[key] === 'string' && (group[key] as string) !== '');
}

/** Merges plugin defaults, the selected policies and the per-conversation settings. */
export function resolveGroupConfig(
  group: Pick<GroupRecord, 'config'>,
  layers: GroupPolicyLayers,
  pluginConfig: JsonObject | undefined,
): JsonObject {
  return effectivePolicyConfig(pluginConfig, layers, group.config);
}

/** Rewrites a conversation record so the chatbot runtime reads resolved policy values directly. */
export function applyGroupPolicies(group: GroupRecord, layers: GroupPolicyLayers, pluginConfig: JsonObject | undefined): GroupRecord {
  if (!layers.identity?.enabled || !layers.dialog?.enabled) throw new Error('required_policy_unavailable');
  if ((group.inputCostPerMillion ?? 0) > 0 || (group.outputCostPerMillion ?? 0) > 0) throw new Error('legacy_model_price_requires_migration');
  if (!layers.cost && ((group.dailyCostLimit ?? 0) > 0 || (group.monthlyCostLimit ?? 0) > 0 || (group.totalCostLimit ?? 0) > 0))
    throw new Error('legacy_budget_requires_cost_policy');
  const cost = layers.cost?.config;
  return {
    ...group,
    ...resolveGroupIdentity(group, layers.identity),
    toolIds: [...new Set(layers.identity.toolIds ?? [])],
    memoryPolicy: layers.memory?.enabled ? {
      memoryMode: ['manual', 'review', 'auto'].includes(String(layers.memory.config?.memoryMode))
        ? layers.memory.config.memoryMode as 'manual' | 'review' | 'auto' : 'manual',
      maxEntries: typeof layers.memory.config?.maxEntries === 'number' ? layers.memory.config.maxEntries : 100,
      retentionDays: typeof layers.memory.config?.retentionDays === 'number' ? layers.memory.config.retentionDays : 7,
    } : undefined,
    dailyCostLimit: typeof cost?.dailyCostLimit === 'number' ? cost.dailyCostLimit : 0,
    monthlyCostLimit: typeof cost?.monthlyCostLimit === 'number' ? cost.monthlyCostLimit : 0,
    totalCostLimit: typeof cost?.totalCostLimit === 'number' ? cost.totalCostLimit : 0,
    config: resolveGroupConfig(group, layers, pluginConfig),
  };
}
