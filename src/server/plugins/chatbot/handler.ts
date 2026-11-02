import {
  DEFAULT_NON_MENTION_REPLY_RATE,
  LOG_RETENTION_DAYS,
  type ConversationLog,
  type GroupRecord,
  type ProviderChatRequest,
  type ProviderRecord,
} from '../../../shared/types';
import { CONTEXT_MESSAGE_LIMIT_DEFAULT, CONTEXT_MESSAGE_LIMIT_MAX } from '../../../shared/plugin-catalog';
import { readBoolean } from '../../env';
import type { ConversationLogRepository } from '../../storage/conversation-log-repository';
import type { QQAccountContext, QQGroupMessage } from '../../protocols/qq/types';
import { completeOpenAICompatible } from './provider';

export interface ChatbotHandlerDependencies {
  findGroup(accountId: string, groupOpenId: string): Promise<GroupRecord | null>;
  findProvider(providerId: string): Promise<ProviderRecord | null>;
  getRecentContext(groupId: string, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  isWithinCostLimits(group: GroupRecord, at: number): Promise<boolean>;
  recordGroupCost(group: GroupRecord, amount: number, at: number): Promise<void>;
  conversationLogs?: Pick<ConversationLogRepository, 'append'>;
  appendContext?(groupId: string, entries: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void>;
  logRecord?: string;
  sendReply(account: QQAccountContext, groupOpenId: string, messageId: string, content: string): Promise<void>;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

export type ChatbotMessageHandler = (account: QQAccountContext, message: QQGroupMessage) => Promise<void>;

export function createChatbotHandler(dependencies: ChatbotHandlerDependencies): ChatbotMessageHandler {
  const random = dependencies.random ?? Math.random;
  const now = dependencies.now ?? Date.now;

  return async (account, message) => {
    if (!account.account.enabled || !account.pluginEnabled) return;

    const group = await dependencies.findGroup(account.account.id, message.groupId);
    if (!group?.enabled) return;

    if (group.whitelistEnabled && !group.whitelistUserIds.includes(message.userId)) return;

    if (!message.mentionsBot) {
      const replyRate = Number.isFinite(group.nonMentionReplyRate)
        ? group.nonMentionReplyRate
        : DEFAULT_NON_MENTION_REPLY_RATE;
      if (random() >= replyRate) return;
    }

    const costPeriodAt = now();
    if (!(await dependencies.isWithinCostLimits(group, costPeriodAt))) return;

    const provider = await dependencies.findProvider(group.providerId);
    if (!provider?.enabled) return;

    const pluginConfig = account.pluginConfig ?? {};
    const configuredLimit = Number(pluginConfig.contextMessageLimit);
    const contextLimit = Number.isFinite(configuredLimit)
      ? Math.min(CONTEXT_MESSAGE_LIMIT_MAX, Math.max(0, Math.trunc(configuredLimit)))
      : CONTEXT_MESSAGE_LIMIT_DEFAULT;
    const includeHistory = pluginConfig.includeHistory !== false;
    const context = includeHistory && contextLimit > 0
      ? await dependencies.getRecentContext(group.id, contextLimit)
      : [];
    const configuredPrompt = typeof pluginConfig.defaultSystemPrompt === 'string'
      ? pluginConfig.defaultSystemPrompt.trim()
      : '';
    const systemPrompt = group.systemPrompt.trim() || configuredPrompt;
    const request: ProviderChatRequest = {
      model: group.model,
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...context,
        { role: 'user', content: message.text },
      ],
      reasoningEffort: group.reasoningEffort,
    };
    const completion = await completeOpenAICompatible(provider, request, dependencies.fetch);
    const cost =
      (completion.promptTokens * group.inputCostPerMillion + completion.completionTokens * group.outputCostPerMillion) /
      1_000_000;
    await dependencies.recordGroupCost(group, cost, costPeriodAt);
    const reply = completion.content.trim();
    if (!reply) return;

    await sendAndLog(account, message, group, reply, dependencies, now);
    await dependencies.appendContext?.(group.id, [
      { role: 'user', content: message.text },
      { role: 'assistant', content: reply },
    ]);
  };
}

async function sendAndLog(
  account: QQAccountContext,
  message: QQGroupMessage,
  group: GroupRecord,
  reply: string,
  dependencies: ChatbotHandlerDependencies,
  now: () => number,
): Promise<void> {
  await dependencies.sendReply(account, message.groupId, message.id, reply);
  if (!readBoolean(dependencies.logRecord, false)) {
    return;
  }
  if (!dependencies.conversationLogs) throw new Error('Conversation logging is enabled but no logger is configured.');

  const createdAt = now();
  const expiresAt = createdAt + LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await dependencies.conversationLogs.append([
    {
      id: crypto.randomUUID(),
      accountId: account.account.id,
      groupId: group.id,
      groupExternalId: group.externalId,
      userId: message.userId,
      direction: 'in',
      content: message.text,
      createdAt,
      expiresAt,
    },
    {
      id: crypto.randomUUID(),
      accountId: account.account.id,
      groupId: group.id,
      groupExternalId: group.externalId,
      userId: message.userId,
      direction: 'out',
      content: reply,
      createdAt,
      expiresAt,
    },
  ]);
}
