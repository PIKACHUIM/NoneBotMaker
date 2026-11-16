import { describe, expect, it } from 'vitest';
import type { PolicyRecord } from './types';
import { resolveGroupIdentity } from './plugin-catalog';

describe('conversation capability layers', () => {
  it('adds conversation-level Skills, MCP and Rules on top of the identity grants', () => {
    const identity = {
      type: 'identity', enabled: true, persona: 'persona', providerId: 'provider', model: 'model',
      systemPrompt: 'identity rules', reasoningEffort: 'default',
      skillIds: ['skill-shared', 'skill-identity'], mcpIds: ['mcp-identity'], ruleIds: ['rule-identity'],
    } as unknown as PolicyRecord;
    const group = {
      providerId: '', model: '', systemPrompt: 'group rules',
      skillIds: ['skill-shared', 'skill-group'], mcpIds: ['mcp-shared', 'mcp-group'], ruleIds: ['rule-group'],
    };
    const resolved = resolveGroupIdentity(group, identity);
    expect(resolved.skillIds).toEqual(['skill-shared', 'skill-identity', 'skill-group']);
    expect(resolved.mcpIds).toEqual(['mcp-identity', 'mcp-shared', 'mcp-group']);
    expect(resolved.ruleIds).toEqual(['rule-identity', 'rule-group']);
    expect(resolved.systemPrompt).toBe('identity rules\n\ngroup rules');
  });
});
