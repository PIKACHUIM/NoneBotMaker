import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotAccountRecord, ChatMessage, ConversationLog, GroupRecord, ProviderRecord } from '../../../shared/types';
import type { MemeMetadata, MemeStore, MemeStoreListEntry, MemeStoreValue } from './meme-library';
import type { QQAccountContext, QQGroupMessage } from '../../protocols/qq/types';
import { createChatbotHandler, resetOutboundRateLimits, type ChatbotHandlerDependencies } from './handler';

const account: QQAccountContext = {
  appId: 'app-id',
  botSecret: 'bot-secret',
  clientSecret: 'client-secret',
  pluginEnabled: true,
  account: {
    id: 'account-1',
    pluginId: 'plugin-1',
    protocol: 'qq',
    name: 'QQ Bot',
    enabled: true,
    credentials: {},
    config: {},
    createdAt: '',
    updatedAt: '',
  } satisfies BotAccountRecord,
};

const group: GroupRecord = {
  id: 'group-1',
  accountId: 'account-1',
  externalId: 'group-openid',
  name: 'Test group',
  enabled: true,
  providerId: 'provider-1',
  model: 'test-model',
  systemPrompt: 'Be helpful.',
  reasoningEffort: 'medium',
  nonMentionReplyRate: 0.05,
  whitelistEnabled: true,
  whitelistUserIds: ['allowed-user'],
  inputCostPerMillion: 1,
  outputCostPerMillion: 2,
  dailyCostLimit: 0,
  monthlyCostLimit: 0,
  totalCostLimit: 0,
  skillIds: [],
  mcpIds: [],
  ruleIds: [],
  createdAt: '',
  updatedAt: '',
};

const provider: ProviderRecord = {
  id: 'provider-1',
  name: 'Provider',
  baseUrl: 'https://provider.example/v1',
  apiKey: 'secret-test-key',
  enabled: true,
  models: ['test-model'],
  createdAt: '',
  updatedAt: '',
};

const message = (overrides: Partial<QQGroupMessage> = {}): QQGroupMessage => ({
  id: 'message-1',
  accountId: 'account-1',
  botId: 'app-id',
  groupId: 'group-openid',
  userId: 'allowed-user',
  text: 'hello',
  mentionsBot: true,
  receivedAt: 1_000,
  eventType: 'GROUP_AT_MESSAGE_CREATE',
  ...overrides,
});

function dependencies(overrides: Partial<ChatbotHandlerDependencies> = {}) {
  const sentReplies: string[] = [];
  const writtenLogs = vi.fn(async (_entries: ConversationLog[]) => undefined);
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'hello back' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  const deps: ChatbotHandlerDependencies = {
    findGroup: vi.fn(async () => group),
    findProvider: vi.fn(async () => provider),
    getRecentContext: vi.fn(async () => [{ role: 'assistant' as const, content: 'prior reply' }]),
    isWithinCostLimits: vi.fn(async () => true),
    recordGroupCost: vi.fn(async () => undefined),
    conversationLogs: { append: writtenLogs },
    sendReply: vi.fn(async (_account, _groupId, _messageId, content) => {
      sentReplies.push(content);
    }),
    fetch: fetch as unknown as typeof globalThis.fetch,
    random: () => 0,
    now: () => 1_000,
    ...overrides,
  };
  const applicationFetch = deps.fetch!;
  deps.fetch = (async (input, init) => String(input).includes('cloudflare-dns.com/dns-query')
    ? new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }), { headers: { 'content-type': 'application/json' } })
    : applicationFetch(input, init)) as typeof globalThis.fetch;
  return { deps, fetch, sentReplies, writtenLogs };
}

describe('createChatbotHandler', () => {
  beforeEach(() => resetOutboundRateLimits());

  it('handles whitelisted messages that mention the bot', async () => {
    const { deps, fetch, sentReplies } = dependencies();
    await createChatbotHandler(deps)(account, message());

    expect(sentReplies).toEqual(['hello back']);
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      reasoning_effort: string;
    };
    expect(request.model).toBe('test-model');
    expect(request.reasoning_effort).toBe('medium');
    expect(request.messages.map((entry) => entry.role)).toEqual(['system', 'assistant', 'user']);
    expect(deps.getRecentContext).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']), 50);
    expect(deps.recordGroupCost).toHaveBeenCalledWith(group, 0.00002, 1_000);
  });

  it('omits reasoning effort for models using the explicit model-default policy', async () => {
    const { deps, fetch } = dependencies({ findGroup: vi.fn(async () => ({ ...group, reasoningEffort: 'default' as const })) });
    await createChatbotHandler(deps)(account, message());
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.temperature).toBe(0.7);
  });

  it('persists owner tool disables and resets the session selection when the mode changes', async () => {
    let state: Record<string, unknown> = {};
    const { deps, fetch } = dependencies({ getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); } });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message({ userId: 'owner', text: '/tools disable chat_time' }));
    expect(state.disabledTools).toEqual(['chat_time']);
    await handler(configured, message());
    const first = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(first.tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_time')).toBe(false);
    await handler(configured, message({ userId: 'owner', text: '/mode reserved' }));
    expect(state.disabledTools).toBeUndefined();
    await handler(configured, message());
    const second = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(second.tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_time')).toBe(true);
  });

  it('only allows owners to list and cancel wakes in the current conversation', async () => {
    const listWakes = vi.fn(async () => [{ id: 'wake-one', dueAt: 10000, reason: 'reminder' }]);
    const cancelWake = vi.fn(async () => true);
    const { deps, fetch, sentReplies } = dependencies({ listWakes, cancelWake });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message({ text: '/wake list' }));
    expect(listWakes).not.toHaveBeenCalled();
    await handler(configured, message({ userId: 'owner', text: '/wake list' }));
    expect(sentReplies.at(-1)).toContain('wake-one');
    await handler(configured, message({ userId: 'owner', text: '/wake cancel wake-one' }));
    expect(cancelWake).toHaveBeenCalledWith(configured, expect.objectContaining({ groupId: 'group-openid' }), 'wake-one');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the sender and group openids through /openid without calling the model', async () => {
    const { deps, fetch, sentReplies } = dependencies();
    await createChatbotHandler(deps)(account, message({ userId: 'allowed-user', text: '/openid' }));
    expect(JSON.parse(sentReplies[0])).toEqual({ conversationType: 'group', userOpenid: 'allowed-user', groupOpenid: 'group-openid' });
    expect(fetch).not.toHaveBeenCalled();

    const privateRun = dependencies({ findGroup: vi.fn(async () => ({ ...group, conversationType: 'private' as const, whitelistEnabled: false })) });
    await createChatbotHandler(privateRun.deps)(account, message({ userId: 'private-user', groupId: 'private-user', conversationType: 'private', eventType: 'C2C_MESSAGE_CREATE', text: '/openid' }));
    expect(JSON.parse(privateRun.sentReplies[0])).toEqual({ conversationType: 'private', userOpenid: 'private-user', groupOpenid: null });
    expect(privateRun.fetch).not.toHaveBeenCalled();
  });

  it('answers /openid in unbound or whitelist-blocked conversations', async () => {
    const unbound = dependencies({ findGroup: vi.fn(async () => null) });
    await createChatbotHandler(unbound.deps)(account, message({ userId: 'stranger', text: '/openid' }));
    expect(JSON.parse(unbound.sentReplies[0])).toEqual({ conversationType: 'group', userOpenid: 'stranger', groupOpenid: 'group-openid' });
    expect(unbound.fetch).not.toHaveBeenCalled();

    const blocked = dependencies();
    await createChatbotHandler(blocked.deps)(account, message({ userId: 'forbidden', text: '/openid' }));
    expect(JSON.parse(blocked.sentReplies[0])).toEqual({ conversationType: 'group', userOpenid: 'forbidden', groupOpenid: 'group-openid' });

    const unboundPrivate = dependencies({ findGroup: vi.fn(async () => null) });
    await createChatbotHandler(unboundPrivate.deps)(account, message({ userId: 'private-user', groupId: 'private-user', conversationType: 'private', eventType: 'C2C_MESSAGE_CREATE', text: '/openid' }));
    expect(JSON.parse(unboundPrivate.sentReplies[0])).toEqual({ conversationType: 'private', userOpenid: 'private-user', groupOpenid: null });

    const wake = dependencies({ findGroup: vi.fn(async () => null) });
    await createChatbotHandler(wake.deps)(account, message({ text: '/openid', isWake: true }));
    expect(wake.sentReplies).toEqual([]);
  });

  it('lists member commands through /help and adds owner commands for owners', async () => {
    const { deps, fetch, sentReplies } = dependencies();
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message({ userId: 'allowed-user', text: '/help' }));
    const memberHelp = sentReplies.join('\n');
    expect(memberHelp).toContain('/openid');
    expect(memberHelp).toContain('/status');
    expect(memberHelp).toContain('/voice list');
    expect(memberHelp).not.toContain('/approvals');
    const memberReplyCount = sentReplies.length;

    await handler(configured, message({ userId: 'owner', text: '/help' }));
    const ownerHelp = sentReplies.slice(memberReplyCount).join('\n');
    expect(ownerHelp).toContain('/tools');
    expect(ownerHelp).toContain('/approvals');
    expect(ownerHelp).toContain('/voice delete');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets any conversation member reset only the current chat and gates silent/active to owners', async () => {
    let state: Record<string, unknown> = {};
    const clearContext = vi.fn(async () => undefined);
    const { deps, fetch, sentReplies } = dependencies({ getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); }, clearContext });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message({ userId: 'allowed-user', text: '/reset' }));
    expect(clearContext).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']));
    await handler(configured, message({ text: '/silent' }));
    expect(state.silent).toBeUndefined();
    await handler(configured, message({ userId: 'owner', text: '/silent' }));
    expect(state.silent).toBe(true);
    await handler(configured, message());
    expect(fetch).not.toHaveBeenCalled();
    await handler(configured, message({ userId: 'owner', text: '/active' }));
    expect(state.silent).toBe(false);
    await handler(configured, message());
    expect(fetch).toHaveBeenCalledOnce();
    expect(sentReplies).toContain('已进入静默模式。使用 /active 恢复响应。');
    expect(sentReplies).toContain('已恢复响应。');
  });

  it('uses an admin-set one-time prompt once and appends mode-specific reserved instructions', async () => {
    let state: Record<string, unknown> = {};
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'one' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'two' } }] })));
    const { deps } = dependencies({ fetch, getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); }, findGroup: vi.fn(async () => ({ ...group, config: { bridge_reserved_prompt: 'reserved-only scenario instructions', bridge_reserved2_prompt: 'reserved2-only send policy' } })) });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner', bridge_mode: 'reserved', agent_model: 'test-model' } };
    await handler(configured, message({ userId: 'owner', text: '/prompt summarize the decision' }));
    await handler(configured, message());
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[0].content).toContain('summarize the decision');
    expect(state.initialPrompt).toBeUndefined();
    await handler(configured, message());
    const secondSystem = JSON.parse(String(fetch.mock.calls[1][1]?.body)).messages[0].content;
    expect(secondSystem).not.toContain('summarize the decision');
    expect(secondSystem).toContain('reserved-only scenario instructions');
    expect(secondSystem).not.toContain('reserved2-only send policy');
  });

  it('persists chat_wait and resumes its pending tool call with the next conversation message', async () => {
    let state: Record<string, unknown> = {};
    const requests: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'wait-call', type: 'function', function: { name: 'chat_wait', arguments: '{"seconds":60,"prompt":"What did you decide?"}' } }] } }] });
      return Response.json({ choices: [{ message: { content: 'I will continue with your answer.' } }] });
    });
    const replaceContext = vi.fn(async () => undefined);
    const { deps, sentReplies } = dependencies({ fetch, getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); }, replaceContext });
    const handler = createChatbotHandler(deps);
    await handler(account, message({ id: 'wait-start', text: 'Please investigate the choice.' }));
    expect((state.pendingAgentWait as { toolCallId: string }).toolCallId).toBe('wait-call');
    expect(sentReplies).toContain('What did you decide?');
    await handler(account, message({ id: 'wait-answer', text: 'Use option B.' }));
    const resumed = requests[1].messages as Array<{ role: string; tool_call_id?: string; content: string }>;
    expect(resumed.at(-1)?.role).toBe('tool');
    expect(resumed.at(-1)?.tool_call_id).toBe('wait-call');
    expect(resumed.at(-1)?.content).toContain('Use option B.');
    expect(state.pendingAgentWait).toBeUndefined();
    expect(replaceContext).toHaveBeenCalledOnce();
    expect(sentReplies.at(-1)).toBe('I will continue with your answer.');
  });

  it('returns validated local time and zone through the compatible datetime tools', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'time', type: 'function', function: { name: 'chat_current_datetime', arguments: '{}' } }] } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] })));
    const { deps } = dependencies({ fetch: providerFetch, findGroup: vi.fn(async () => ({ ...group, config: { timezone: 'Asia/Shanghai' } })) });
    await createChatbotHandler(deps)(account, message());
    const followup = JSON.parse(String(providerFetch.mock.calls[1][1]?.body));
    const result = JSON.parse(followup.messages.at(-1).content);
    expect(result).toMatchObject({ iso: new Date(1000).toISOString(), timezone: 'Asia/Shanghai' });
    expect(result.local).toContain('8:00:01');
  });

  it('ignores the removed bridge_allowed_groups allowlist', async () => {
    const { deps, fetch } = dependencies();
    const configured = { ...account, pluginConfig: { bridge_allowed_groups: 'another-group' } };

    await createChatbotHandler(deps)(configured, message());

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('lets a plugin owner bypass the group whitelist', async () => {
    const { deps, fetch } = dependencies();
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner-1' } };

    await createChatbotHandler(deps)(configured, message({ userId: 'owner-1' }));

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('splits long replies by bridge_max_message_chars', async () => {
    const longReply = 'A'.repeat(250);
    const longFetch = vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{ message: { content: longReply } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const { deps, sentReplies } = dependencies({ fetch: longFetch as unknown as typeof globalThis.fetch });
    const configured = {
      ...account,
      pluginConfig: { bridge_max_message_chars: 100, bridge_max_messages_per_minute: 10 },
    };

    await createChatbotHandler(deps)(configured, message());

    expect(sentReplies).toHaveLength(3);
    expect(sentReplies.every((part) => part.length <= 100)).toBe(true);
  });

  it('still calls the model but suppresses final text in reserved2 mode', async () => {
    const { deps, fetch, sentReplies } = dependencies();
    const configured = { ...account, pluginConfig: { bridge_mode: 'reserved2' } };

    await createChatbotHandler(deps)(configured, message());

    expect(fetch).toHaveBeenCalledOnce();
    expect(sentReplies).toEqual([]);
  });

  it('allows a whitelisted non-mention when the injected probability sample passes', async () => {
    const { deps, sentReplies } = dependencies({ random: () => 0.049 });
    await createChatbotHandler(deps)(account, message({ mentionsBot: false, eventType: 'GROUP_MESSAGE_CREATE' }));

    expect(sentReplies).toEqual(['hello back']);
  });

  it('does not process a non-mention when the probability sample is outside the configured rate', async () => {
    const { deps, fetch, sentReplies } = dependencies({ random: () => 0.05 });
    await createChatbotHandler(deps)(account, message({ mentionsBot: false, eventType: 'GROUP_MESSAGE_CREATE' }));

    expect(fetch).not.toHaveBeenCalled();
    expect(sentReplies).toEqual([]);
  });

  it.each([
    { mentionsBot: true, eventType: 'GROUP_AT_MESSAGE_CREATE' as const },
    { mentionsBot: false, eventType: 'GROUP_MESSAGE_CREATE' as const },
  ])('silently ignores a non-whitelisted message ($eventType)', async (event) => {
    const { deps, fetch, sentReplies, writtenLogs } = dependencies();
    await createChatbotHandler(deps)(account, message({ userId: 'other-user', ...event }));

    expect(fetch).not.toHaveBeenCalled();
    expect(deps.findProvider).not.toHaveBeenCalled();
    expect(deps.sendReply).not.toHaveBeenCalled();
    expect(writtenLogs).not.toHaveBeenCalled();
    expect(deps.recordGroupCost).not.toHaveBeenCalled();
    expect(deps.getRecentContext).not.toHaveBeenCalled();
    expect(sentReplies).toEqual([]);
  });

  it('stops before provider lookup when any configured budget is already reached', async () => {
    const { deps, fetch, sentReplies, writtenLogs } = dependencies({
      isWithinCostLimits: vi.fn(async () => false),
    });
    await createChatbotHandler(deps)(account, message());

    expect(deps.isWithinCostLimits).toHaveBeenCalledWith(group, 1_000);
    expect(deps.findProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.recordGroupCost).not.toHaveBeenCalled();
    expect(deps.sendReply).not.toHaveBeenCalled();
    expect(writtenLogs).not.toHaveBeenCalled();
    expect(sentReplies).toEqual([]);
  });

  it('does not process disabled groups', async () => {
    const { deps, fetch, sentReplies } = dependencies({
      findGroup: vi.fn(async () => ({ ...group, enabled: false })),
    });
    await createChatbotHandler(deps)(account, message());

    expect(fetch).not.toHaveBeenCalled();
    expect(sentReplies).toEqual([]);
  });

  it('does not write conversation logs when LOG_RECORD is unset', async () => {
    const { deps, writtenLogs } = dependencies();
    await createChatbotHandler(deps)(account, message());

    expect(writtenLogs).not.toHaveBeenCalled();
  });

  it('writes the complete turn with a 30-day expiry only when logging is enabled', async () => {
    const { deps, writtenLogs } = dependencies({ logRecord: 'true' });
    await createChatbotHandler(deps)(account, message());

    const entries = writtenLogs.mock.calls.flatMap(([records]) => records);
    expect(entries.map((entry) => entry.status)).toEqual(['received', 'model_completed', 'completed', 'sent']);
    expect(entries.filter((entry) => entry.content).map((entry) => [entry.direction, entry.content])).toEqual([
      ['in', 'hello'], ['out', 'hello back'],
    ]);
    expect(entries[0].expiresAt).toBe(1_000 + 30 * 24 * 60 * 60 * 1000);
    expect(entries.every((entry) => entry.expiresAt === entries[0].expiresAt)).toBe(true);
  });

  it('preserves structured calls and tool messages across model rounds and bills every round', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'chat_time', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })));
    const appendContext = vi.fn(async (_key: string, _entries: ChatMessage[]) => undefined);
    const { deps, sentReplies } = dependencies({ fetch: providerFetch, appendContext });
    await createChatbotHandler(deps)(account, message());
    const second = JSON.parse(String(providerFetch.mock.calls[1][1].body));
    expect(second.messages.at(-2).tool_calls[0].id).toBe('call-1');
    expect(second.messages.at(-1).role).toBe('tool');
    expect(second.messages.at(-1).tool_call_id).toBe('call-1');
    expect(JSON.parse(second.messages.at(-1).content)).toMatchObject({ iso: new Date(1000).toISOString(), timezone: 'UTC' });
    expect(deps.recordGroupCost).toHaveBeenCalledTimes(2);
    expect(appendContext.mock.calls[0][1].map((entry: { role: string }) => entry.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(sentReplies).toEqual(['done']);
  });

  it('rejects unknown tools and schema-invalid arguments without executing sends', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [
        { id: 'unknown', type: 'function', function: { name: 'Bash', arguments: '{}' } },
        { id: 'invalid', type: 'function', function: { name: 'chat_send', arguments: '{"text":42}' } },
      ] } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '[SILENT]' } }] })));
    const { deps, sentReplies } = dependencies({ fetch: providerFetch });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_mode: 'reserved' } }, message());
    const request = JSON.parse(String(providerFetch.mock.calls[1][1].body));
    expect(request.messages.slice(-2).every((entry: { content: string }) => entry.content.startsWith('Error:'))).toBe(true);
    expect(sentReplies).toEqual([]);
    expect(request.tools.some((entry: { function: { name: string } }) => entry.function.name === 'Bash')).toBe(false);
  });

  it('permits chat_send in reserved2 and increments sequence across tool and final sends', async () => {
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'send', type: 'function', function: { name: 'chat_send', arguments: '{"text":"tool reply"}' } }] } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'final reply' } }] })));
    const { deps, sentReplies } = dependencies({ fetch: providerFetch });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_mode: 'reserved2' } }, message());
    expect(sentReplies).toEqual(['tool reply']);
    expect(deps.sendReply).toHaveBeenCalledWith(expect.objectContaining({ appId: account.appId }), 'group-openid', 'message-1', 'tool reply', { seq: 1, conversationType: 'group' });
  });

  it('only runs closed-agent for owner private conversations', async () => {
    const privateGroup = { ...group, conversationType: 'private' as const };
    const { deps, fetch, sentReplies } = dependencies({ findGroup: vi.fn(async () => privateGroup) });
    const configured = { ...account, pluginConfig: { bridge_mode: 'closed-agent', bridge_owner_ids: 'owner' } };
    await createChatbotHandler(deps)(configured, message({ userId: 'owner' }));
    await createChatbotHandler(deps)(configured, message({ userId: 'allowed-user', conversationType: 'private' }));
    expect(fetch).not.toHaveBeenCalled();
    await createChatbotHandler(deps)(configured, message({ userId: 'owner', conversationType: 'private', eventType: 'C2C_MESSAGE_CREATE' }));
    expect(sentReplies).toEqual(['hello back']);
  });

  it('applies group config overrides before plugin config and preserves batch identities', async () => {
    const { deps, fetch } = dependencies({ findGroup: vi.fn(async () => ({ ...group, config: { bridge_mode: 'chat', bridge_owner_ids: 'owner' } })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_mode: 'reserved2' } }, message({ batchMessages: [
      message({ id: 'a', userId: 'allowed-user', text: 'first' }),
      message({ id: 'b', userId: 'owner', text: 'second' }),
      message({ id: 'c', userId: 'forbidden', text: 'excluded' }),
    ] }));
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    const users = request.messages.filter((entry: { role: string }) => entry.role === 'user');
    expect(users).toHaveLength(2);
    expect(users[0].content).toContain('allowed-user');
    expect(users[1].content).toContain('owner');
    expect(JSON.stringify(users)).not.toContain('excluded');
  });

  it('blocks non-owner memory commands and persists owner role state without calling the model', async () => {
    const setState = vi.fn(async () => undefined);
    const { deps, fetch } = dependencies({ setState, getState: vi.fn(async () => ({})) });
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await createChatbotHandler(deps)(configured, message({ text: '/memory forbidden' }));
    expect(setState).not.toHaveBeenCalled();
    await createChatbotHandler(deps)(configured, message({ userId: 'owner', text: '/role concise' }));
    expect(setState).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']), expect.objectContaining({ knowledge: expect.objectContaining({ activeRole: 'default', roles: [expect.objectContaining({ content: 'concise' })] }) }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses enabled model prices and provider multiplier instead of legacy prices', async () => {
    const { deps } = dependencies({
      findProvider: vi.fn(async () => ({ ...provider, priceMultiplier: 2 })),
      findPrice: vi.fn(async () => ({ id: 'price', name: 'price', model: 'test-model', enabled: true, currency: 'USD' as const, inputCostPerMillion: 3, outputCostPerMillion: 4, createdAt: '', updatedAt: '' })),
    });
    await createChatbotHandler(deps)(account, message());
    expect(deps.recordGroupCost).toHaveBeenCalledWith(group, 0.0001, 1000);
  });

  it('fails closed on unknown prices instead of silently bypassing budgets', async () => {
    const { deps, fetch } = dependencies({ findGroup: vi.fn(async () => ({ ...group, inputCostPerMillion: 0, outputCostPerMillion: 0 })) });
    await expect(createChatbotHandler(deps)(account, message())).rejects.toThrow('pricing');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caps the agent loop at 25 model rounds with complete error messages', async () => {
    let round = 0;
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: `call-${++round}`, type: 'function', function: { name: 'chat_time', arguments: '{}' } }] } }] })));
    const { deps, sentReplies } = dependencies({ fetch: providerFetch, appendContext: vi.fn(async () => undefined) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { agent_max_rounds: 25 } }, message());
    expect(providerFetch).toHaveBeenCalledTimes(25);
    expect(deps.recordGroupCost).toHaveBeenCalledTimes(25);
    expect(sentReplies).toEqual([]);
  });

  it('summarizes older complete turns and replaces persisted context', async () => {
    const history = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: 'context '.repeat(60) }));
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'summary' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] })));
    const replaceContext = vi.fn(async (_key: string, _entries: ChatMessage[]) => undefined);
    const { deps } = dependencies({ fetch: providerFetch, getRecentContext: vi.fn(async () => history), replaceContext });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { max_context: 4096, compact_rate: 0.5 } }, message());
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(replaceContext.mock.calls[0][1][0].content).toContain('summary');
    expect(replaceContext.mock.calls[0][1][1].role).toBe('user');
    expect(deps.recordGroupCost).toHaveBeenCalledTimes(2);
  });

  it('does not return retryable storage errors after a reply was successfully sent', async () => {
    const { deps, sentReplies } = dependencies({ appendContext: vi.fn(async () => { throw new Error('storage unavailable'); }), logRecord: 'true' });
    await expect(createChatbotHandler(deps)(account, message())).resolves.toBeUndefined();
    expect(sentReplies).toEqual(['hello back']);
  });

  it('loads selected Skills/Rules as system instructions and invokes an actual MCP tool', async () => {
    let modelRound = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('mcp.example')) {
        const rpc = JSON.parse(String(init?.body));
        if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : rpc.method === 'tools/list' ? {
          tools: [{ name: 'echo', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }],
        } : { content: [{ type: 'text', text: rpc.params.arguments.text }] };
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
      }
      modelRound += 1;
      return Response.json({ choices: [{ message: modelRound === 1 ? { content: '', tool_calls: [{ id: 'mcp-call', type: 'function', function: { name: 'mcp_alpha_echo', arguments: '{"text":"actual MCP result"}' } }] } : { content: 'finished' } }] });
    });
    const { deps, sentReplies } = dependencies({
      fetch: applicationFetch,
      findGroup: vi.fn(async () => ({ ...group, skillIds: ['skill'], ruleIds: ['rule'], mcpIds: ['alpha'] })),
      findLibrary: vi.fn(async (kind, id) => ({ id, name: id, description: '', enabled: true, config: kind === 'mcps' ? { url: 'https://mcp.example/rpc', authToken: 'mcp-secret', allowedTools: ['echo'] } : { prompt: `${kind} instructions` }, createdAt: '', updatedAt: '' })),
    });
    await createChatbotHandler(deps)(account, message());
    const modelCalls = applicationFetch.mock.calls.filter(([url]) => String(url).includes('chat/completions'));
    const first = JSON.parse(String(modelCalls[0][1]?.body));
    const second = JSON.parse(String(modelCalls[1][1]?.body));
    expect(first.messages[0].content).toContain('skills instructions');
    expect(first.messages[0].content).toContain('rules instructions');
    expect(second.messages.at(-1).content).toContain('actual MCP result');
    expect(sentReplies).toEqual(['finished']);
  });

  it('requires owner approval for an MCP tool that only self-declares readOnlyHint', async () => {
    let state: Record<string, unknown> = {};
    let modelCalls = 0;
    let remoteToolCalls = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('mcp.example')) {
        const rpc = JSON.parse(String(init?.body));
        if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : rpc.method === 'tools/list' ? { tools: [
          { name: 'read', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
        ] } : (remoteToolCalls += 1, { content: [{ type: 'text', text: 'remote result' }] });
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
      }
      modelCalls += 1;
      return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'remote-read', type: 'function', function: { name: 'mcp_alpha_read', arguments: '{}' } }] } }] });
    });
    const { deps, sentReplies } = dependencies({ fetch: applicationFetch,
      findGroup: vi.fn(async () => ({ ...group, mcpIds: ['alpha'] })),
      findLibrary: vi.fn(async () => ({ id: 'alpha', name: 'MCP', description: '', enabled: true, config: { url: 'https://mcp.example/rpc' }, createdAt: '', updatedAt: '' })),
      claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = structuredClone(next); }),
    });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner' } }, message({ userId: 'allowed-user' }));
    expect(modelCalls).toBe(1);
    expect(remoteToolCalls).toBe(0);
    expect(state.toolApprovals).toMatchObject([{ status: 'pending', call: { function: { name: 'mcp_alpha_read' } } }]);
    expect(sentReplies[0]).toContain('/approve ');
  });

  it('stops tool iteration as soon as the charged budget is reached', async () => {
    const providerFetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'call', type: 'function', function: { name: 'chat_time', arguments: '{}' } }] } }] }));
    const isWithinCostLimits = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    const { deps } = dependencies({ fetch: providerFetch, isWithinCostLimits });
    await expect(createChatbotHandler(deps)(account, message())).rejects.toThrow('budget');
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(deps.recordGroupCost).toHaveBeenCalledOnce();
  });

  it('awaits persistent outbound reservations and denies sends when reservation fails', async () => {
    const { deps, sentReplies } = dependencies({ reserveOutbound: vi.fn(async () => false) });
    await expect(createChatbotHandler(deps)(account, message())).rejects.toThrow('rate limit');
    expect(sentReplies).toEqual([]);
  });

  it('writes a diagnostic without returning a retry error if outbound logging fails', async () => {
    const statuses: string[] = [];
    const append = vi.fn(async (entries: ConversationLog[]) => {
      statuses.push(entries[0].status!);
      if (entries[0].status === 'sent') throw new Error('log storage failure');
    });
    const { deps, sentReplies } = dependencies({ logRecord: 'true', conversationLogs: { append } });
    await expect(createChatbotHandler(deps)(account, message())).resolves.toBeUndefined();
    expect(sentReplies).toEqual(['hello back']);
    expect(statuses).toContain('log_storage_error');
  });

  it('does not send final text after a successful chat_send in normal chat mode', async () => {
    const applicationFetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'send', type: 'function', function: { name: 'chat_send', arguments: '{"text":"tool sent"}' } }] } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'do not send twice' } }] }));
    const { deps, sentReplies } = dependencies({ fetch: applicationFetch });
    await createChatbotHandler(deps)(account, message());
    expect(sentReplies).toEqual(['tool sent']);
  });

  it('honors zero history and disabled memory while retaining global Brave config', async () => {
    const { deps, fetch } = dependencies({ getState: vi.fn(async () => ({ memory: 'stored private preference' })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { context_history_limit: 0, memory_enabled: false, brave_api_key: 'brave-secret' } }, message());
    expect(deps.getRecentContext).not.toHaveBeenCalled();
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.messages[0].content).not.toContain('stored private preference');
    expect(request.tools.map((entry: { function: { name: string } }) => entry.function.name)).toContain('WebSearch');
  });

  it('gates owner memory writes on memory_enabled', async () => {
    const setState = vi.fn(async () => undefined);
    const { deps, fetch } = dependencies({ setState });
    const handler = createChatbotHandler(deps);
    await handler({ ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: false } }, message({ userId: 'owner', text: '/memory durable' }));
    expect(setState).not.toHaveBeenCalled();
    await handler({ ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } }, message({ userId: 'owner', text: '/memory durable' }));
    expect(setState).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']), expect.objectContaining({ knowledge: expect.objectContaining({ memories: [expect.objectContaining({ content: 'durable' })] }) }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an explicitly priced free model with zero provider multiplier', async () => {
    const { deps } = dependencies({ findProvider: vi.fn(async () => ({ ...provider, priceMultiplier: 0 })), findPrice: vi.fn(async () => ({ id: 'free', model: 'test-model', name: 'free', unit: 'tokens' as const, currency: 'USD' as const, inputCostPerMillion: 0, outputCostPerMillion: 0, enabled: true, createdAt: '', updatedAt: '' })) });
    await createChatbotHandler(deps)(account, message());
    expect(deps.recordGroupCost).toHaveBeenCalledWith(group, 0, 1000);
  });

  it('executes authorized TTS through speech API, bills characters and sends real media once', async () => {
    let round = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/audio/speech')) return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0]), { headers: { 'content-type': 'audio/mpeg' } });
      return Response.json({ choices: [{ message: ++round === 1 ? { content: '', tool_calls: [{ id: 'tts', type: 'function', function: { name: 'chat_tts', arguments: '{"text":"hello"}' } }] } : { content: 'already spoken' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    });
    const sendMedia = vi.fn(async () => undefined);
    const setState = vi.fn(async () => undefined);
    const { deps, writtenLogs, sentReplies } = dependencies({ fetch: applicationFetch, sendMedia, setState, logRecord: 'true', findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const], priceMultiplier: 2 })),
      findPrice: vi.fn(async (model, unit) => ({ id: unit!, name: model, model, unit: unit!, currency: 'USD' as const, enabled: true, inputCostPerMillion: unit === 'characters' ? 10 : 1, outputCostPerMillion: 2, createdAt: '', updatedAt: '' })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message({ text: '请用语音回复' }));
    expect(applicationFetch.mock.calls.some(([url]) => String(url).endsWith('/audio/speech'))).toBe(true);
    expect(sendMedia).toHaveBeenCalledOnce();
    expect(deps.recordGroupCost).toHaveBeenCalledWith(group, 0.0001, 1000);
    expect(setState).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']), expect.objectContaining({ voiceSendTimes: [1_000] }));
    expect(sentReplies).toEqual([]);
    const speech = writtenLogs.mock.calls.flatMap(([entries]) => entries).find((entry) => entry.status === 'speech_completed');
    expect(speech?.details?.usage).toMatchObject({ unit: 'characters', inputCharacters: 5 });
    expect(JSON.stringify(writtenLogs.mock.calls)).not.toContain('Uint8Array');
  });

  it('does not expose TTS without persistent voice-send limits', async () => {
    const { deps, fetch } = dependencies({ sendMedia: vi.fn(async () => undefined), findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const] })),
      findPrice: vi.fn(async (_model, unit) => ({ id: 'speech-price', name: 'Speech', model: 'tts-1', unit: unit!, currency: 'USD' as const, enabled: true, inputCostPerMillion: 10, outputCostPerMillion: 2, createdAt: '', updatedAt: '' })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message({ text: '请用语音回复' }));
    const tools = JSON.parse(String(fetch.mock.calls[0][1]?.body)).tools;
    expect(tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_tts')).toBe(false);
  });

  it('downloads safe outbound media and sends bytes through the injected protocol service', async () => {
    let round = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('media.example') ? new Response('image-bytes', { headers: { 'content-type': 'image/png' } }) : Response.json({ choices: [{ message: ++round === 1 ? { content: '', tool_calls: [{ id: 'media', type: 'function', function: { name: 'chat_send_media', arguments: '{"url":"https://media.example/image","type":"image"}' } }] } : { content: 'already sent' } }] }));
    const sendMedia = vi.fn(async () => undefined);
    const { deps, sentReplies } = dependencies({ fetch: applicationFetch, sendMedia });
    await createChatbotHandler(deps)(account, message());
    expect(sendMedia).toHaveBeenCalledWith(account, 'group-openid', 'message-1', expect.objectContaining({ type: 'image', bytes: expect.any(Uint8Array), contentType: 'image/png' }), { seq: 1, conversationType: 'group' });
    expect(sentReplies).toEqual([]);
  });

  it('moderates an owner meme save before persistence, then sends only the verified stored bytes', async () => {
    const values = new Map<string, MemeStoreValue>();
    const memeStore: MemeStore = {
      async put(key, bytes, metadata) { values.set(key, { bytes: new Uint8Array(bytes), metadata: structuredClone(metadata) }); },
      async get(key) { const value = values.get(key); return value ? { bytes: new Uint8Array(value.bytes), metadata: structuredClone(value.metadata) } : null; },
      async delete(key) { values.delete(key); },
      async list(prefix) { return [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]): MemeStoreListEntry => ({ key, metadata: structuredClone(value.metadata) })); },
    };
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    let modelRound = 0;
    let reviews = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('media.example')) return new Response(imageBytes, { headers: { 'content-type': 'image/png' } });
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string | Array<{ type: string }> }> };
      if (JSON.stringify(request.messages[0]?.content).includes('审核一张用于群聊表情素材库的图片')) {
        reviews += 1;
        expect(request.messages[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image_url' })]));
        return Response.json({ choices: [{ message: { content: '{"decision":"allow"}' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
      }
      const calls = [
        { id: 'save', type: 'function', function: { name: 'chat_save_meme', arguments: '{"imageIndex":1,"name":"wave"}' } },
        { id: 'send', type: 'function', function: { name: 'chat_send_meme', arguments: '{"name":"wave"}' } },
      ];
      return Response.json({ choices: [{ message: ++modelRound <= 2 ? { content: '', tool_calls: [calls[modelRound - 1]] } : { content: 'sent the approved image' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
    const sendMedia = vi.fn(async () => undefined);
    const { deps } = dependencies({ fetch: applicationFetch, memeStore, sendMedia,
      findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['image' as const] })),
    });
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await createChatbotHandler(deps)(configured, message({ userId: 'owner', text: 'save and use this reaction sticker', attachments: [{ type: 'image', url: 'https://media.example/sticker.png', contentType: 'image/png', filename: 'sticker.png', size: imageBytes.byteLength }] }));
    expect(reviews, JSON.stringify(applicationFetch.mock.calls.map(([, init]) => init?.body ? JSON.parse(String(init.body)).messages?.[0]?.content : null))).toBe(1);
    expect(values.size).toBe(1);
    expect(sendMedia).toHaveBeenCalledWith(configured, 'group-openid', 'message-1', expect.objectContaining({ type: 'image', bytes: imageBytes, contentType: 'image/png' }), { seq: 1, conversationType: 'group' });
  });

  it('does not expose meme-saving tools to non-owners even when an image is attached', async () => {
    const memeStore: MemeStore = { put: vi.fn(), get: vi.fn(async () => null), delete: vi.fn(), list: vi.fn(async () => []) };
    const requests: Array<Record<string, any>> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('media.example')) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { headers: { 'content-type': 'image/png' } });
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: 'hello back' } }] });
    });
    const { deps } = dependencies({ memeStore, fetch, findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['image' as const] })) });
    await createChatbotHandler(deps)(account, message({ attachments: [{ type: 'image', url: 'https://media.example/sticker.png', contentType: 'image/png', filename: 'sticker.png' }] }));
    expect(requests[0].tools.some((item: { function: { name: string } }) => item.function.name === 'chat_save_meme')).toBe(false);
  });

  it('collects slang messages even when the non-mention reply sampler skips the AI reply', async () => {
    let state: Record<string, unknown> = {};
    let calls = 0;
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls += 1;
      if (String(body.messages[0]?.content).includes('识别真正的新俚语')) return Response.json({ choices: [{ message: { content: '[{"term":"qwerx","sourceIndex":0}]' } }] });
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    });
    const { deps } = dependencies({ fetch: applicationFetch, random: () => 0.9, now: () => 1_000_000,
      getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); },
      findGroup: vi.fn(async () => ({ ...group, whitelistEnabled: false, nonMentionReplyRate: 0.05, config: { bridge_slang_enabled: true, bridge_slang_min_messages: 3, bridge_slang_cooldown_seconds: 300 } })) });
    const handler = createChatbotHandler(deps);
    await handler(account, message({ id: 'unmentioned-1', userId: 'member-1', mentionsBot: false, text: 'qwerx appears here' }));
    await handler(account, message({ id: 'unmentioned-2', userId: 'member-2', mentionsBot: false, text: 'qwerx appears there' }));
    expect(calls).toBe(0);
    await handler(account, message({ id: 'mentioned-3', userId: 'member-3', mentionsBot: true, text: 'another use of qwerx' }));
    expect(calls).toBe(2);
    const scope = JSON.stringify(['account-1', 'group', 'group-openid']);
    expect((state.slangWorkflows as Record<string, any>)[scope].entries).toMatchObject([{ term: 'qwerx', hits: 3, status: 'pending' }]);
  });

  it('extracts repeated group slang, waits for owner review, and injects only confirmed terms', async () => {
    let state: Record<string, unknown> = {};
    const requests: Array<Record<string, any>> = [];
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (String(body.messages?.[0]?.content ?? '').includes('识别真正的新俚语')) return Response.json({ choices: [{ message: { content: '[{"term":"qwerx","sourceIndex":1}]' } }] });
      return Response.json({ choices: [{ message: { content: 'ack' } }] });
    });
    const { deps } = dependencies({ fetch: applicationFetch, now: () => 1_000_000, getState: async () => structuredClone(state), setState: async (_scope, next) => { state = structuredClone(next); }, findGroup: vi.fn(async () => ({ ...group, whitelistEnabled: false, config: { bridge_slang_enabled: true, bridge_slang_min_messages: 3, bridge_slang_cooldown_seconds: 30 } })) });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    for (let index = 0; index < 3; index += 1) await handler(configured, message({ id: `slang-${index}`, userId: `member-${index}`, text: 'In our group qwerx is used as a greeting.' }));
    const scope = JSON.stringify(['account-1', 'group', 'group-openid']);
    const workflow = ((state.slangWorkflows as Record<string, any>)[scope]);
    expect(workflow.entries).toMatchObject([{ term: 'qwerx', status: 'pending', hits: 3 }]);
    const id = workflow.entries[0].id as string;
    await handler(configured, message({ id: 'review-slang', userId: 'owner', text: `/slang approve ${id}` }));
    expect(((state.slangWorkflows as Record<string, any>)[scope].entries[0]).status).toBe('confirmed');
    await handler(configured, message({ id: 'confirmed-slang', userId: 'member-4', text: 'hello' }));
    const finalSystem = String(requests.at(-1)?.messages?.[0]?.content ?? '');
    expect(finalSystem).toContain('<term>qwerx</term>');
    expect(finalSystem).toContain('不可信词汇数据');
  });

  it('marks scheduled wakes separately from user input and never grants wake TTS authorization', async () => {
    const { deps, fetch, writtenLogs } = dependencies({ logRecord: 'true', sendMedia: vi.fn(async () => undefined), findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const] })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message({ isWake: true, wakeReason: '语音提醒', text: '/mode reserved2', mentionsBot: false }));
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.messages.at(-1).content).toContain('计划唤醒');
    expect(request.tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_tts')).toBe(false);
    expect(writtenLogs.mock.calls.flatMap(([entries]) => entries)[0].status).toBe('wake');
  });

  it.each(['不要语音回复', '语音价格是多少', '解释TTS但不要朗读'])('does not authorize speech for negative or informational input: %s', async (text) => {
    const { deps, fetch } = dependencies({ sendMedia: vi.fn(async () => undefined), findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const] })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message({ text }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_tts')).toBe(false);
  });

  it('does not transfer one batch participant speech authorization to other messages', async () => {
    const { deps, fetch } = dependencies({ sendMedia: vi.fn(async () => undefined), findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const] })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message({ batchMessages: [message({ id: 'one', text: '/voice hello' }), message({ id: 'two', text: 'unrelated message' })] }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_tts')).toBe(false);
  });

  it('does not let existing audio media bypass explicit speech authorization', async () => {
    let round = 0;
    const applicationFetch = vi.fn(async () => Response.json({ choices: [{ message: ++round === 1 ? { content: '', tool_calls: [{ id: 'audio', type: 'function', function: { name: 'chat_send_media', arguments: '{"url":"https://media.example/audio","type":"audio"}' } }] } : { content: 'no audio' } }] }));
    const sendMedia = vi.fn(async () => undefined);
    const { deps } = dependencies({ fetch: applicationFetch, sendMedia });
    await createChatbotHandler(deps)(account, message({ text: '不要语音回复' }));
    expect(sendMedia).not.toHaveBeenCalled();
    expect(applicationFetch.mock.calls).toHaveLength(2);
  });

  it('persists matching tool error messages if a later tool log aborts a multi-tool turn', async () => {
    const applicationFetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '', tool_calls: [
      { id: 'first', type: 'function', function: { name: 'chat_time', arguments: '{}' } },
      { id: 'second', type: 'function', function: { name: 'chat_time', arguments: '{}' } },
    ] } }] }));
    const appendContext = vi.fn(async (_scope: string, _entries: ChatMessage[]) => undefined);
    const append = vi.fn(async (entries: ConversationLog[]) => { if (entries[0].status === 'tool_completed') throw new Error('log storage error'); });
    const { deps } = dependencies({ fetch: applicationFetch, appendContext, logRecord: 'true', conversationLogs: { append } });
    await expect(createChatbotHandler(deps)(account, message())).rejects.toThrow('log storage');
    const saved = appendContext.mock.calls[0][1];
    expect(saved.filter((entry) => entry.role === 'tool').map((entry) => entry.tool_call_id)).toEqual(['first', 'second']);
    expect(saved.at(-1)?.content).toContain('interrupted');
  });

  it('searches and reads account-scoped shared project memory from separate conversations', async () => {
    let round = 0;
    const shared = { id: 'memory-1', accountId: 'account-1', name: 'project-goal', title: 'Project goal', desc: 'Shared goal', type: 'project' as const, content: 'Ship the safe chatbot runtime', time: '2026-11-01T00:00:00.000Z', createdAt: '', updatedAt: '' };
    const calls: Array<Record<string, any>> = [];
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); calls.push(body);
      const toolCall = round === 0 ? { id: 'search-shared', type: 'function', function: { name: 'ProjectMemorySearch', arguments: '{"query":"safe chatbot"}' } }
        : round === 1 ? { id: 'read-shared', type: 'function', function: { name: 'ProjectMemoryRead', arguments: '{"name":"project-goal"}' } } : null;
      round += 1;
      return Response.json({ choices: [{ message: toolCall ? { content: '', tool_calls: [toolCall] } : { content: 'Using the shared project goal.' } }] });
    });
    const findWorkspaceMemories = vi.fn(async (accountId) => accountId === 'account-1' ? [shared] : []);
    const findGroup = vi.fn(async (accountId, externalId) => ({ ...group, id: `${accountId}-${externalId}`, accountId, externalId }));
    const { deps } = dependencies({ fetch: applicationFetch, findWorkspaceMemories, findGroup });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { memory_enabled: true } };
    await handler(configured, message({ groupId: 'group-one' }));
    await handler(configured, message({ id: 'message-two', groupId: 'group-two' }));
    expect(calls[0].messages[0].content).toContain('Project goal');
    expect(calls[1].messages.at(-1).content).toContain('Project goal');
    expect(calls[2].messages.at(-1).content).toContain('Ship the safe chatbot runtime');
    expect(findWorkspaceMemories).toHaveBeenCalledWith('account-1');
    const otherAccount = { ...account, account: { ...account.account, id: 'account-2' }, pluginConfig: { memory_enabled: true } };
    await handler(otherAccount, message({ id: 'other-account', accountId: 'account-2', groupId: 'separate-room' }));
    expect(findWorkspaceMemories).toHaveBeenCalledWith('account-2');
    expect(String(calls.at(-1)?.messages?.[0]?.content ?? '')).not.toContain('Project goal');
  });

  it('permits owner writes to account-shared project memory while guests only receive read tools', async () => {
    let round = 0;
    const saveWorkspaceMemory = vi.fn(async (accountId, memory) => ({ ...memory, accountId, id: 'shared-memory', createdAt: '', updatedAt: '' }));
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      round += 1;
      if (round === 2) return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'write-project', type: 'function', function: { name: 'ProjectMemoryWrite', arguments: JSON.stringify({ name: 'goal', title: 'Goal', desc: 'Current plan', type: 'project', content: 'Ship feature safely' }) } }] } }] });
      return Response.json({ choices: [{ message: { content: 'stored' } }] });
    });
    const { deps } = dependencies({ fetch: applicationFetch, findWorkspaceMemories: vi.fn(async () => []), saveWorkspaceMemory, deleteWorkspaceMemory: vi.fn(async () => true) });
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } };
    const handler = createChatbotHandler(deps);
    await handler(configured, message());
    const guestTools = JSON.parse(String(applicationFetch.mock.calls[0][1]?.body)).tools.map((item: { function: { name: string } }) => item.function.name);
    expect(guestTools).toContain('ProjectMemoryRead');
    expect(guestTools).not.toContain('ProjectMemoryWrite');
    await handler(configured, message({ id: 'owner-message', userId: 'owner' }));
    const ownerTools = JSON.parse(String(applicationFetch.mock.calls[1][1]?.body)).tools.map((item: { function: { name: string } }) => item.function.name);
    expect(ownerTools).toContain('ProjectMemoryWrite');
    expect(ownerTools).toContain('ProjectMemoryForget');
    expect(saveWorkspaceMemory).toHaveBeenCalledWith('account-1', expect.objectContaining({ name: 'goal', title: 'Goal', content: 'Ship feature safely' }));
  });

  it('persists named role cards and injects the selected mode-specific card on subsequent model requests', async () => {
    let state: Record<string, unknown> = {};
    const { deps, fetch } = dependencies({ claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = structuredClone(next); }) });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message({ userId: 'owner', text: '/role add helper # 通用\n角色公共段\n# [reserved] 主动\n不应注入\n# [chat] 对话\n角色聊天段' }));
    await handler(configured, message({ userId: 'owner', text: '/role use helper' }));
    resetOutboundRateLimits();
    await handler(configured, message());
    const system = JSON.parse(String(fetch.mock.calls[0][1]?.body)).messages[0].content;
    expect(system).toContain('角色公共段');
    expect(system).toContain('角色聊天段');
    expect(system).not.toContain('不应注入');
    expect(state.knowledge).toMatchObject({ activeRole: 'helper' });
  });

  it('executes owner MemoryWrite/MemoryRead through model tool calls with scope-bound persistence', async () => {
    let state: Record<string, unknown> = {};
    let round = 0;
    const calls: unknown[] = [];
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      const toolCall = ++round === 1 ? { id: 'write', type: 'function', function: { name: 'MemoryWrite', arguments: JSON.stringify({ name: 'preference', title: '偏好', description: '当前群偏好', type: 'user', content: '简洁回复' }) } } : { id: 'read', type: 'function', function: { name: 'MemoryRead', arguments: '{"name":"preference"}' } };
      return Response.json({ choices: [{ message: round < 3 ? { content: '', tool_calls: [toolCall] } : { content: 'stored' } }] });
    });
    const { deps } = dependencies({ fetch: applicationFetch, claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = structuredClone(next); }) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } }, message({ userId: 'owner' }));
    expect(state.knowledge).toMatchObject({ memories: [expect.objectContaining({ name: 'preference', content: '简洁回复' })] });
    expect((calls[2] as any).messages.at(-1).content).toContain('简洁回复');
    expect(deps.setState).toHaveBeenCalledWith(JSON.stringify(['account-1', 'group', 'group-openid']), expect.anything());
  });

  it('persists MCP side-effect approvals and executes once only after an owner decision', async () => {
    let state: Record<string, unknown> = {};
    let remoteCalls = 0;
    let modelCalls = 0;
    const applicationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('mcp.example')) {
        const rpc = JSON.parse(String(init?.body));
        if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : rpc.method === 'tools/list' ? { tools: [{ name: 'write', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] } : { content: [{ type: 'text', text: `write ${++remoteCalls}` }] };
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
      }
      modelCalls += 1;
      return Response.json({ choices: [{ message: modelCalls === 1 ? { content: '', tool_calls: [{ id: 'write-call', type: 'function', function: { name: 'mcp_alpha_write', arguments: '{"value":"safe"}' } }] } : { content: 'Agent continued from the actual write result.' } }] });
    });
    const { deps, sentReplies } = dependencies({ fetch: applicationFetch, findGroup: vi.fn(async () => ({ ...group, mcpIds: ['alpha'] })), findLibrary: vi.fn(async () => ({ id: 'alpha', name: 'MCP', description: '', enabled: true, config: { url: 'https://mcp.example/rpc', allowedTools: ['write'] }, createdAt: '', updatedAt: '' })), claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = structuredClone(next); }) });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner' } };
    await handler(configured, message());
    expect(remoteCalls).toBe(0);
    const approval = (state.toolApprovals as any[])[0];
    expect(approval.status).toBe('pending');
    expect(sentReplies[0]).toContain(`/approve ${approval.id}`);
    expect(sentReplies[0]).toContain('{"value":"safe"}');
    await handler(configured, message({ text: `/approve ${approval.id}` }));
    expect(remoteCalls).toBe(0);
    await handler(configured, message({ userId: 'owner', text: `/approve ${approval.id}`, mentionsBot: false }));
    expect(remoteCalls).toBe(1);
    expect(modelCalls).toBe(2);
    expect(sentReplies.at(-1)).toContain('Agent continued');
    expect((state.toolApprovals as any[])[0].status).toBe('approved');
    await expect(handler(configured, message({ userId: 'owner', text: `/approve ${approval.id}` }))).rejects.toThrow('cannot be executed again');
    expect(remoteCalls).toBe(1);
  });

  it('does not truncate validated durable knowledge arrays at the log sanitizer limit', async () => {
    const memories = Array.from({ length: 101 }, (_, index) => ({ name: `entry${index}`, title: 'entry', description: 'metadata', type: 'project', content: 'value', updatedAt: '2026-01-01T00:00:00.000Z' }));
    const setState = vi.fn(async (_scope: string, _state: Record<string, unknown>) => undefined);
    const { deps } = dependencies({ getState: vi.fn(async () => ({ knowledge: { roles: [], activeRole: '', memories } })), setState });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } }, message({ userId: 'owner', text: '/role concise' }));
    expect((setState.mock.calls[0][1].knowledge as { memories: unknown[] }).memories).toHaveLength(101);
  });

  it('allows guest knowledge reads but rejects guest knowledge mutations and other owner commands', async () => {
    const state = { knowledge: { activeRole: 'helper', roles: [{ name: 'helper', content: 'role content', description: '', updatedAt: '2026-01-01T00:00:00.000Z' }], memories: [{ name: 'memo', content: 'memory content', title: 'memo', description: 'entry', type: 'project', updatedAt: '2026-01-01T00:00:00.000Z' }] } };
    const setState = vi.fn(async () => undefined);
    const { deps, sentReplies, fetch } = dependencies({ getState: vi.fn(async () => state), setState });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } };
    await handler(configured, message({ text: '/role show helper' }));
    await handler(configured, message({ text: '/memory read memo' }));
    await handler(configured, message({ text: '/role use helper' }));
    await handler(configured, message({ text: '/memory clear' }));
    await handler(configured, message({ text: '/mode reserved2' }));
    expect(sentReplies[0]).toContain('role content');
    expect(sentReplies[1]).toContain('memory content');
    expect(sentReplies[2]).toContain('owner');
    expect(sentReplies[3]).toContain('owner');
    expect(setState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never grants a scheduled owner wake knowledge-write or management authorization', async () => {
    const setState = vi.fn(async () => undefined);
    const { deps, fetch } = dependencies({ setState, getState: vi.fn(async () => ({})), findGroup: vi.fn(async () => ({ ...group, whitelistEnabled: false })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner', memory_enabled: true } }, message({ userId: 'owner', isWake: true, text: '/role attacker', wakeReason: '/role attacker' }));
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.tools.some((entry: { function: { name: string } }) => ['MemoryWrite', 'MemoryForget'].includes(entry.function.name))).toBe(false);
    expect(setState).not.toHaveBeenCalled();
  });

  it('executes an owner approval without a non-mention probability pass or usable LLM budget/provider', async () => {
    const call = { id: 'pending', type: 'function' as const, function: { name: 'mcp_alpha_write', arguments: '{"value":"actual target"}' } };
    let state: Record<string, unknown> = { toolApprovals: [{ id: 'approval-id', call, requestedBy: 'user', requestedAt: 1000, expiresAt: 300000, status: 'pending' }] };
    let remoteCalls = 0;
    const applicationFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : rpc.method === 'tools/list' ? { tools: [{ name: 'write', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] } : { content: [{ type: 'text', text: `write ${++remoteCalls}` }] };
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
    });
    const { deps, sentReplies } = dependencies({ fetch: applicationFetch, random: () => 1, isWithinCostLimits: vi.fn(async () => false), findProvider: vi.fn(async () => null), claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = structuredClone(next); }), findGroup: vi.fn(async () => ({ ...group, mcpIds: ['alpha'] })), findLibrary: vi.fn(async () => ({ id: 'alpha', name: 'MCP', description: '', enabled: true, config: { url: 'https://mcp.example/rpc', allowedTools: ['write'] }, createdAt: '', updatedAt: '' })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner' } }, message({ userId: 'owner', mentionsBot: false, text: '/approve approval-id' }));
    expect(remoteCalls).toBe(1);
    expect(deps.findProvider).not.toHaveBeenCalled();
    expect(sentReplies.at(-1)).toContain('write 1');
    expect((state.toolApprovals as any[])[0].status).toBe('approved');
  });

  it('validates MCP argument schemas before creating any pending approval', async () => {
    let state: Record<string, unknown> = {};
    const applicationFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('mcp.example')) {
        const rpc = JSON.parse(String(init?.body));
        if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [{ name: 'write', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] } });
      }
      return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'invalid', type: 'function', function: { name: 'mcp_alpha_write', arguments: '{"value":42}' } }] } }] });
    });
    const { deps } = dependencies({ fetch: applicationFetch, claimApproval: vi.fn(async () => true), getState: vi.fn(async () => structuredClone(state)), setState: vi.fn(async (_scope, next) => { state = next; }), findGroup: vi.fn(async () => ({ ...group, mcpIds: ['alpha'] })), findLibrary: vi.fn(async () => ({ id: 'alpha', name: 'MCP', description: '', enabled: true, config: { url: 'https://mcp.example/rpc' }, createdAt: '', updatedAt: '' })) });
    await expect(createChatbotHandler(deps)(account, message())).rejects.toThrow('type');
    expect(state.toolApprovals).toBeUndefined();
  });

  it('rejects known-secret redaction expansion before writing a knowledge card that would become unreadable', async () => {
    const setState = vi.fn(async () => undefined);
    const { deps } = dependencies({ getState: vi.fn(async () => ({})), setState });
    const long = 'tiny'.repeat(6000);
    await createChatbotHandler(deps)({ ...account, appSecret: 'tiny', pluginConfig: { bridge_owner_ids: 'owner' } }, message({ userId: 'owner', text: `/role ${long}` }));
    expect(setState).not.toHaveBeenCalled();
  });

  it('refuses dangerous approval execution when the backend cannot atomically claim it', async () => {
    const pending = { id: 'approval-id', call: { id: 'call', type: 'function' as const, function: { name: 'mcp_alpha_write', arguments: '{}' } }, status: 'pending', expiresAt: 300000 };
    const { deps, fetch } = dependencies({ getState: vi.fn(async () => ({ toolApprovals: [pending] })), setState: vi.fn(async () => undefined) });
    await expect(createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner' } }, message({ userId: 'owner', text: '/approve approval-id' }))).rejects.toThrow('atomic');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an already claimed approval even if another isolate still sees stale pending state', async () => {
    const pending = { id: 'approval-id', call: { id: 'call', type: 'function' as const, function: { name: 'mcp_alpha_write', arguments: '{}' } }, status: 'pending', expiresAt: 300000 };
    const { deps, fetch } = dependencies({ claimApproval: vi.fn(async () => false), getState: vi.fn(async () => ({ toolApprovals: [pending] })), setState: vi.fn(async () => undefined) });
    await expect(createChatbotHandler(deps)({ ...account, pluginConfig: { bridge_owner_ids: 'owner' } }, message({ userId: 'owner', text: '/approve approval-id' }))).rejects.toThrow('already claimed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows complete approval arguments in scope-bound pages without any tool execution', async () => {
    const args = JSON.stringify({ target: 'document', content: 'A'.repeat(1200) });
    const pending = { id: 'approval-id', call: { id: 'call', type: 'function' as const, function: { name: 'mcp_alpha_write', arguments: args } }, status: 'pending', expiresAt: 300000, requestedBy: 'user' };
    const { deps, fetch, sentReplies } = dependencies({ getState: vi.fn(async () => ({ toolApprovals: [pending] })), setState: vi.fn(async () => undefined) });
    const handler = createChatbotHandler(deps);
    const configured = { ...account, pluginConfig: { bridge_owner_ids: 'owner', bridge_max_message_chars: 4000 } };
    await handler(configured, message({ userId: 'owner', text: '/approval approval-id 0' }));
    const first = JSON.parse(sentReplies[0]);
    await handler(configured, message({ userId: 'owner', text: `/approval approval-id ${first.nextOffset}` }));
    const second = JSON.parse(sentReplies[1]);
    expect(first.argumentText + second.argumentText).toBe(args);
    expect(second.nextOffset).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not register TTS without an explicit current user speech request', async () => {
    const { deps, fetch } = dependencies({ sendMedia: vi.fn(async () => undefined), findProvider: vi.fn(async () => ({ ...provider, mediaCapabilities: ['speech' as const] })) });
    await createChatbotHandler(deps)({ ...account, pluginConfig: { voice_model: 'tts-1' } }, message());
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.tools.some((entry: { function: { name: string } }) => entry.function.name === 'chat_tts')).toBe(false);
  });

  it('redacts secrets from all model/tool log details', async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'secret-test-key' } }] })));
    const { deps, writtenLogs } = dependencies({ fetch: providerFetch, logRecord: 'true' });
    await createChatbotHandler(deps)(account, message({ text: 'password=hidden' }));
    const logged = JSON.stringify(writtenLogs.mock.calls);
    expect(logged).not.toContain('secret-test-key');
    expect(logged).not.toContain('hidden');
  });
});
