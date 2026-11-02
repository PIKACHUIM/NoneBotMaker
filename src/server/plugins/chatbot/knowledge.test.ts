import { describe, expect, it, vi } from 'vitest';
import type { GroupRecord, JsonObject } from '../../../shared/types';
import type { QQAccountContext, QQGroupMessage } from '../../protocols/qq/types';
import { createChatbotHandler } from './handler';
import { createKnowledgeTools, handleKnowledgeCommand, knowledgePrompt, KNOWLEDGE_LIMITS, type KnowledgeContext } from './knowledge';
import { executeTool } from './tools';

function store(initial: JsonObject = {}) {
  let state = structuredClone(initial);
  const getState = vi.fn(async () => structuredClone(state));
  const setState = vi.fn(async (next: JsonObject) => { state = structuredClone(next); });
  const context: KnowledgeContext = { owner: true, memoryEnabled: true, mode: 'chat', getState, setState };
  return { context, getState, setState, state: () => structuredClone(state) };
}

const entry = (name = 'preferences', content = '中文偏好 English TypeScript') => ({ name, title: '偏好 Preferences', description: '项目编码习惯', type: 'user', content });
async function invoke(context: KnowledgeContext, name: string, args: JsonObject = {}) {
  const tools = new Map(createKnowledgeTools(context).map((item) => [item.definition.function.name, item]));
  return executeTool(name, JSON.stringify(args), tools, []);
}

async function command(context: KnowledgeContext, action: 'role' | 'memory', value: string) {
  return handleKnowledgeCommand(action, value, context);
}

function routedCommands(initial: JsonObject, enforceSendBudget = false) {
  const saved = store(initial);
  const replies: string[] = [];
  const account: QQAccountContext = {
    appId: 'app', appSecret: 'known-credential', pluginEnabled: true,
    pluginConfig: { memory_enabled: true, bridge_owner_ids: 'owner', bridge_max_message_chars: enforceSendBudget ? 500 : 4000 },
    account: { id: 'account', pluginId: 'plugin', protocol: 'qq', name: 'bot', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
  const group: GroupRecord = {
    id: 'group', accountId: 'account', externalId: 'conversation', name: 'group', enabled: true, providerId: 'provider', model: 'model', systemPrompt: '', reasoningEffort: 'medium',
    nonMentionReplyRate: 0, whitelistEnabled: false, whitelistUserIds: [], inputCostPerMillion: 0, outputCostPerMillion: 0,
    dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0, skillIds: [], mcpIds: [], ruleIds: [], createdAt: '', updatedAt: '',
  };
  const handler = createChatbotHandler({
    findGroup: async () => group, findProvider: async () => null, getRecentContext: async () => [], isWithinCostLimits: async () => true, recordGroupCost: async () => undefined,
    getState: saved.getState, setState: async (_key, next) => saved.setState(next), reserveOutbound: async (_key, count) => !enforceSendBudget || count <= 6,
    sendReply: async (_account, _group, _message, content) => { replies.push(content); },
  });
  return { saved, replies, run: async (userId: string, text: string) => {
    const message: QQGroupMessage = { id: crypto.randomUUID(), accountId: 'account', botId: 'app', groupId: 'conversation', userId, text, mentionsBot: true, receivedAt: 1000, eventType: 'GROUP_AT_MESSAGE_CREATE' };
    await handler(account, message);
  } };
}

describe('persistent conversation role cards', () => {
  it('creates, lists, shows, updates, activates and deletes named cards after context reconstruction', async () => {
    const saved = store({ mode: 'reserved', unrelated: { keep: true } });
    expect(await command(saved.context, 'role', 'add 助手 # 通用\n友好')).toContain('保存');
    const rebuilt = { ...saved.context };
    expect(await command(rebuilt, 'role', 'list')).toContain('助手');
    expect(await command(rebuilt, 'role', 'show 助手')).toContain('友好');
    expect(await command(rebuilt, 'role', 'update 助手 # 通用\n准确')).toContain('保存');
    await command(rebuilt, 'role', 'use 助手');
    expect(knowledgePrompt(saved.state(), 'chat', true)).toContain('准确');
    expect(saved.state()).toMatchObject({ mode: 'reserved', unrelated: { keep: true } });
    expect(await command(rebuilt, 'role', 'delete 助手')).toContain('删除');
    expect(knowledgePrompt(saved.state(), 'chat', true)).not.toContain('准确');
  });

  it.each(['chat', 'reserved', 'reserved2', 'closed-agent'])('renders shared and only matching sections for %s', async (mode) => {
    const saved = store();
    await command(saved.context, 'role', 'add modes # 通用\n共同设定\n# [chat] 对话\n聊天段\n# 〔一代〕 主动\n一代段\n# (v2) 代理\n二代段\n# [closed-agent] 私聊\n封闭段\n# 尾部\n共享尾部');
    await command(saved.context, 'role', 'use modes');
    const prompt = knowledgePrompt(saved.state(), mode, false);
    expect(prompt).toContain('共同设定');
    expect(prompt).toContain('共享尾部');
    for (const [sectionMode, text] of [['chat', '聊天段'], ['reserved', '一代段'], ['reserved2', '二代段'], ['closed-agent', '封闭段']]) {
      expect(prompt.includes(text)).toBe(mode === sectionMode);
    }
    expect(prompt).not.toContain('[chat]');
  });

  it('supports legacy text and persisted fields while clear removes them and all cards', async () => {
    const saved = store({ role: '旧角色', memory: '旧记忆' });
    expect(knowledgePrompt(saved.state(), 'chat', true)).toContain('旧角色');
    expect(await command(saved.context, 'memory', 'show default')).toContain('旧记忆');
    await command(saved.context, 'role', '新角色');
    expect(knowledgePrompt(saved.state(), 'chat', true)).toContain('新角色');
    await command(saved.context, 'role', 'clear');
    expect(await command(saved.context, 'role', 'list')).not.toContain('default');
    expect(knowledgePrompt(saved.state(), 'chat', true)).not.toContain('新角色');
    expect(saved.state()).not.toHaveProperty('role');
  });

  it('rejects duplicates, missing updates, unsafe names, oversized content and excess cards without writing', async () => {
    const saved = store();
    await command(saved.context, 'role', 'add safe content');
    const before = saved.setState.mock.calls.length;
    for (const value of ['add safe duplicate', 'update missing text', 'use missing', 'add ../bad text', 'add constructor text', `add huge ${'x'.repeat(KNOWLEDGE_LIMITS.roleContent + 1)}`]) {
      expect(await command(saved.context, 'role', value)).toMatch(/错误/);
    }
    expect(saved.setState).toHaveBeenCalledTimes(before);
    for (let index = 1; index < KNOWLEDGE_LIMITS.roles; index += 1) await command(saved.context, 'role', `add role_${index} x`);
    expect(await command(saved.context, 'role', 'add overflow x')).toMatch(/错误/);
  });
});

describe('conversation memory tools and commands', () => {
  it('routes guest reads through the handler while keeping writes owner-only', async () => {
    const routed = routedCommands({ memory: '本会话可读记忆' });
    await routed.run('guest', '/memory show default');
    expect(routed.replies.join('')).toContain('本会话可读记忆');
    await routed.run('guest', '/memory add forbidden 内容');
    expect(routed.saved.setState).not.toHaveBeenCalled();
  });

  it('preserves all 200 memories through runtime state redaction', async () => {
    const memories = Array.from({ length: KNOWLEDGE_LIMITS.memories }, (_, index) => ({ ...entry(`m_${index}`, 'known-credential'), updatedAt: '2026-01-01T00:00:00.000Z' }));
    const routed = routedCommands({ knowledge: { roles: [], activeRole: '', memories } });
    await routed.run('owner', '/role add runtime 角色内容');
    expect(routed.replies.join('')).toContain('保存');
    expect(routed.saved.setState).toHaveBeenCalledTimes(1);
    const persisted = routed.saved.state().knowledge as { memories: Array<{ content: string }> };
    expect(persisted.memories).toHaveLength(KNOWLEDGE_LIMITS.memories);
    expect(persisted.memories.every((item) => item.content === '[redacted]')).toBe(true);
  });

  it.each(['user', 'feedback', 'project', 'reference'])('writes and reads %s metadata with update timestamp', async (type) => {
    const saved = store();
    const args = { ...entry(type), type };
    expect((await invoke(saved.context, 'MemoryWrite', args)).isError).toBe(false);
    const read = await invoke({ ...saved.context }, 'MemoryRead', { name: type });
    const parsed = JSON.parse(read.content);
    expect(parsed).toMatchObject({ untrusted: true, scope: 'current-conversation', entry: args });
    expect(parsed.entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await invoke(saved.context, 'MemoryRead')).content).toContain(type);
    expect(await command(saved.context, 'memory', `update ${type} 更新内容`)).toContain('保存');
    expect((await invoke(saved.context, 'MemoryRead', { name: type })).content).toContain('更新内容');
  });

  it('searches names, titles, descriptions and Chinese/English content case-insensitively', async () => {
    const saved = store();
    await invoke(saved.context, 'MemoryWrite', entry());
    for (const query of ['中文偏好', 'english typescript', 'PREFERENCES', '编码习惯', 'preferences 中文']) {
      const result = await invoke(saved.context, 'MemorySearch', { query });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content).entries).toHaveLength(1);
    }
    expect(JSON.parse((await invoke(saved.context, 'MemorySearch', { query: '不存在' })).content).entries).toHaveLength(0);
    expect(await command(saved.context, 'memory', 'search English')).toContain('preferences');
  });

  it('allows guests to read/search but hides write/forget and rejects direct mutation commands', async () => {
    const saved = store();
    await invoke(saved.context, 'MemoryWrite', entry());
    const guest = { ...saved.context, owner: false };
    expect(createKnowledgeTools(guest).map((item) => item.definition.function.name)).toEqual(['MemoryRead', 'MemorySearch']);
    expect((await invoke(guest, 'MemoryRead', { name: 'preferences' })).isError).toBe(false);
    expect((await invoke(guest, 'MemoryWrite', entry())).allowed).toBe(false);
    for (const action of ['memory', 'role'] as const) for (const value of ['add new text', 'update preferences text', 'delete preferences', 'use preferences', 'clear', 'legacy text']) {
      expect(await command(guest, action, value)).toContain('owner');
    }
    expect(await command(guest, 'memory', 'list')).toContain('preferences');
    expect(saved.setState).toHaveBeenCalledTimes(1);
  });

  it('returns no tools, no memory prompt and no command data when memory is disabled', async () => {
    const saved = store({ memory: '隐私记忆', role: '公开角色' });
    const disabled = { ...saved.context, memoryEnabled: false };
    expect(createKnowledgeTools(disabled)).toEqual([]);
    expect(knowledgePrompt(saved.state(), 'chat', false)).not.toContain('隐私记忆');
    expect(knowledgePrompt(saved.state(), 'chat', false)).toContain('公开角色');
    expect(await command(disabled, 'memory', 'list')).toContain('未启用');
    expect(saved.setState).not.toHaveBeenCalled();
  });

  it('uses only callbacks for this conversation and rejects arbitrary scope or path targeting', async () => {
    const current = store();
    const other = store();
    await invoke(current.context, 'MemoryWrite', entry());
    expect((await invoke(other.context, 'MemoryRead')).content).not.toContain('preferences');
    for (const name of ['../secret', '/tmp/file', 'a/b', 'a\\b', 'constructor', 'A', 'x'.repeat(65)]) {
      expect((await invoke(current.context, 'MemoryWrite', entry(name))).isError).toBe(true);
    }
    expect((await invoke(current.context, 'MemoryRead', { name: 'preferences', groupId: 'other' })).isError).toBe(true);
    expect((await invoke(current.context, 'MemoryWrite', { ...entry(), scope: 'global' })).isError).toBe(true);
    const write = createKnowledgeTools(current.context).find((item) => item.definition.function.name === 'MemoryWrite')!;
    await expect(write.execute({ ...entry(), key: 'other-account' })).rejects.toThrow();
    expect(current.setState).toHaveBeenCalledTimes(1);
  });

  it('validates exact content/metadata limits before sanitizing and never silently truncates writes', async () => {
    const saved = store();
    expect((await invoke(saved.context, 'MemoryWrite', entry('max', 'x'.repeat(KNOWLEDGE_LIMITS.memoryContent)))).isError).toBe(false);
    for (const args of [entry('large', 'x'.repeat(KNOWLEDGE_LIMITS.memoryContent + 1)), { ...entry(), title: 'x'.repeat(121) }, { ...entry(), description: 'x'.repeat(501) }, { ...entry(), title: 'a\nb' }, { ...entry(), title: `${'x'.repeat(110)}password=x` }, entry('redaction_large', `${'x'.repeat(19_990)}password=x`), { ...entry(), type: 'invalid' }, entry('empty', ' ')]) {
      expect((await invoke(saved.context, 'MemoryWrite', args)).isError).toBe(true);
    }
    expect(saved.setState).toHaveBeenCalledTimes(1);
    expect((await invoke(saved.context, 'MemoryWrite', entry('sanitized', 'password=abc Bearer xyz'))).isError).toBe(false);
    expect(JSON.stringify(saved.state())).not.toContain('abc');
    expect(JSON.stringify(saved.state())).not.toContain('xyz');
    await invoke(saved.context, 'MemoryWrite', entry('json_safe', 'password=abc'));
    const read = await invoke(saved.context, 'MemoryRead', { name: 'json_safe' });
    expect(() => JSON.parse(read.content)).not.toThrow();
  });

  it('bounds entry count, serialized bytes, index and paginated reads', async () => {
    const saved = store();
    for (let index = 0; index < KNOWLEDGE_LIMITS.memories; index += 1) {
      expect((await invoke(saved.context, 'MemoryWrite', { ...entry(`m_${index}`, 'x'), title: 't'.repeat(120), description: 'd'.repeat(500) })).isError).toBe(false);
    }
    expect((await invoke(saved.context, 'MemoryWrite', entry('overflow'))).isError).toBe(true);
    const page = JSON.parse((await invoke(saved.context, 'MemoryRead', { offset: 10, limit: 5 })).content);
    expect(page.entries).toHaveLength(5);
    expect(page.total).toBe(KNOWLEDGE_LIMITS.memories);
    expect(page.nextOffset).toBe(15);
    const largePage = await invoke(saved.context, 'MemoryRead', { limit: 100 });
    expect(largePage.content.length).toBeLessThan(32_768);
    expect(JSON.parse(largePage.content).nextOffset).toBeGreaterThan(0);
    expect(JSON.parse(largePage.content).nextOffset).toBeLessThan(100);
    const commandPage = await command(saved.context, 'memory', 'list 10 5');
    expect(commandPage.length).toBeLessThanOrEqual(2000);
    expect(JSON.parse(commandPage).nextOffset).toBeGreaterThan(10);
    expect(JSON.parse(commandPage).nextOffset).toBeLessThanOrEqual(15);
    expect((await invoke(saved.context, 'MemoryRead', { limit: 101 })).isError).toBe(true);
    expect(new TextEncoder().encode(knowledgePrompt(saved.state(), 'chat', true)).length).toBeLessThan(KNOWLEDGE_LIMITS.indexBytes + 1000);
    const bytes = store();
    let overflow = false;
    for (let index = 0; index < 30; index += 1) {
      if ((await invoke(bytes.context, 'MemoryWrite', entry(`big_${index}`, '中'.repeat(KNOWLEDGE_LIMITS.memoryContent)))).isError) { overflow = true; break; }
    }
    expect(overflow).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(bytes.state().knowledge)).length).toBeLessThanOrEqual(KNOWLEDGE_LIMITS.stateBytes);
  });

  it.each(['\\', '"', '\u0001'])('reads escaped large %s content through valid JSON chunks without data loss', async (character) => {
    const saved = store();
    const content = character.repeat(KNOWLEDGE_LIMITS.memoryContent);
    expect((await invoke(saved.context, 'MemoryWrite', entry('escaped', content))).isError).toBe(false);
    let offset: number | null = 0;
    let recovered = '';
    while (offset !== null) {
      const result = await invoke(saved.context, 'MemoryRead', { name: 'escaped', contentOffset: offset });
      expect(result.isError).toBe(false);
      expect(result.content.length).toBeLessThan(32_768);
      const parsed = JSON.parse(result.content);
      recovered += parsed.entry.content;
      expect(parsed.nextContentOffset === null || parsed.nextContentOffset > offset).toBe(true);
      offset = parsed.nextContentOffset;
    }
    expect(recovered).toBe(content);
    expect((await invoke(saved.context, 'MemoryRead', { name: 'escaped', contentOffset: 20_001 })).isError).toBe(true);
  });

  it.each(['role', 'memory'] as const)('paginates large %s command reads within the default QQ send budget', async (action) => {
    const content = action === 'role' ? '# [chat] \"heading\\\\\"\n'.repeat(1000).trim() : '\u0001'.repeat(KNOWLEDGE_LIMITS.memoryContent);
    const entryValue = action === 'role' ? { name: 'large', description: '', content, updatedAt: '2026-01-01T00:00:00.000Z' } : { ...entry('large', content), updatedAt: '2026-01-01T00:00:00.000Z' };
    const knowledge = { activeRole: '', roles: action === 'role' ? [entryValue] : [], memories: action === 'memory' ? [entryValue] : [] };
    const routed = routedCommands({ knowledge }, true);
    await routed.run('guest', `/${action} show large`);
    const first = JSON.parse(routed.replies.join(''));
    expect(first.nextContentOffset).toBeGreaterThan(0);
    expect(routed.replies.length).toBeLessThanOrEqual(6);
    let recovered = '';
    let offset: number | null = 0;
    while (offset !== null) {
      const result = await command(routed.saved.context, action, `read large ${offset} ${action === 'role' ? KNOWLEDGE_LIMITS.roleContent : KNOWLEDGE_LIMITS.memoryContent}`);
      expect(result.length).toBeLessThanOrEqual(2000);
      const parsed = JSON.parse(result);
      expect(parsed.nextContentOffset === null || parsed.nextContentOffset > offset).toBe(true);
      recovered += parsed.entry.content;
      offset = parsed.nextContentOffset;
    }
    expect(recovered).toBe(content);
    expect(await command(routed.saved.context, action, 'show large -1')).toContain('错误');
  });

  it('does not report successful writes when persistent storage rejects them', async () => {
    const saved = store();
    saved.setState.mockRejectedValue(new Error('Storage unavailable'));
    expect((await invoke(saved.context, 'MemoryWrite', entry())).isError).toBe(true);
    expect(await command(saved.context, 'role', 'add new text')).toContain('错误');
    expect(saved.state()).toEqual({});
  });

  it('rechecks owner authorization when an already-created write tool executes', async () => {
    const saved = store();
    const write = createKnowledgeTools(saved.context).find((item) => item.definition.function.name === 'MemoryWrite')!;
    saved.context.owner = false;
    await expect(write.execute(entry())).rejects.toThrow('owner');
    expect(saved.setState).not.toHaveBeenCalled();
  });

  it('supports named JSON commands, legacy text, delete and clear without removing roles or unrelated state', async () => {
    const saved = store({ mode: 'chat' });
    await command(saved.context, 'role', '保留角色');
    expect(await command(saved.context, 'memory', `add preferences ${JSON.stringify(entry())}`)).toContain('保存');
    expect(await command(saved.context, 'memory', `add preferences duplicate`)).toContain('错误');
    expect(await command(saved.context, 'memory', 'legacy text')).toContain('保存');
    expect(await command(saved.context, 'memory', 'show default')).toContain('legacy text');
    expect((await invoke(saved.context, 'MemoryForget', { name: 'preferences' })).isError).toBe(false);
    expect((await invoke(saved.context, 'MemoryRead', { name: 'preferences' })).isError).toBe(true);
    await command(saved.context, 'memory', 'clear');
    expect(JSON.parse((await invoke(saved.context, 'MemoryRead')).content).entries).toEqual([]);
    expect(knowledgePrompt(saved.state(), 'chat', true)).toContain('保留角色');
    expect(saved.state()).toMatchObject({ mode: 'chat' });
  });
});
