import { describe, expect, it, vi } from 'vitest';
import type { BotAccountRecord, ConversationLog, GroupRecord, ProviderRecord } from '../../../shared/types';
import type { QQAccountContext, QQGroupMessage } from '../../protocols/qq/types';
import { createChatbotHandler, type ChatbotHandlerDependencies } from './handler';

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
  return { deps, fetch, sentReplies, writtenLogs };
}

describe('createChatbotHandler', () => {
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
    expect(deps.getRecentContext).toHaveBeenCalledWith('group-1', 20);
    expect(deps.recordGroupCost).toHaveBeenCalledWith(group, 0.00002, 1_000);
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

    const entries = writtenLogs.mock.calls[0]?.[0] ?? [];
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.direction, entry.content])).toEqual([
      ['in', 'hello'],
      ['out', 'hello back'],
    ]);
    expect(entries[0].expiresAt).toBe(1_000 + 30 * 24 * 60 * 60 * 1000);
    expect(entries[1].expiresAt).toBe(entries[0].expiresAt);
  });
});
