import type { PolicyRecord, PolicyType, GroupRecord, JsonObject } from '../../../shared/types';
import { effectivePolicyConfig, resolveGroupIdentity, type GroupPolicyLayers } from '../../../shared/plugin-catalog';
import type { RecordRepository } from '../../storage/repository';

const POLICY_FIELDS: Array<[PolicyType, 'dialogPolicyId' | 'voicePolicyId' | 'identityPolicyId']> = [
  ['dialog', 'dialogPolicyId'],
  ['voice', 'voicePolicyId'],
  ['identity', 'identityPolicyId'],
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
  return {
    ...group,
    ...resolveGroupIdentity(group, layers.identity),
    config: resolveGroupConfig(group, layers, pluginConfig),
  };
}
