import {
  DEFAULT_NON_MENTION_REPLY_RATE,
  LOG_RETENTION_DAYS,
  type ConversationLog,
  type GroupRecord,
  type ProviderChatRequest,
  type ProviderRecord,
} from '../../../shared/types';
import { configIdSet, configNumber, configString } from '../../../shared/plugin-catalog';
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
  reserveOutbound?(groupId: string, count: number, at: number, limit: number): boolean;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

export type ChatbotMessageHandler = (account: QQAccountContext, message: QQGroupMessage) => Promise<void>;

const CONTEXT_MESSAGE_LIMIT = 20;
const OUTBOUND_WINDOW_MS = 60_000;
const outboundWindows = new Map<string, number[]>();

export function resetOutboundRateLimits(): void {
  outboundWindows.clear();
}

function reserveOutbound(groupId: string, count: number, at: number, limit: number): boolean {
  const recent = (outboundWindows.get(groupId) ?? []).filter((stamp) => at - stamp < OUTBOUND_WINDOW_MS);
  if (count < 1 || recent.length + count > limit) {
    outboundWindows.set(groupId, recent);
    return false;
  }
  outboundWindows.set(groupId, [...recent, ...Array.from({ length: count }, () => at)]);
  return true;
}

function splitMessage(text: string, limit: number): string[] {
  let remaining = text.trim();
  const chunks: string[] = [];
  while (remaining.length > limit) {
    let boundary = Math.max(remaining.lastIndexOf('\n', limit), remaining.lastIndexOf(' ', limit));
    if (boundary < limit / 2) boundary = Math.max(remaining.lastIndexOf('。', limit), remaining.lastIndexOf('.', limit)) + 1;
    if (boundary <= 0) boundary = limit;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function trimContext(
  entries: Array<{ role: 'user' | 'assistant'; content: string }>,
  tokenBudget: number,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const maxChars = Math.max(1, Math.floor(tokenBudget * 4));
  const kept: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let used = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const size = Math.ceil(entry.content.length / 4) + 4;
    if (used + size > maxChars) break;
    kept.push(entry);
    used += size;
  }
  return kept.reverse();
}

export function createChatbotHandler(dependencies: ChatbotHandlerDependencies): ChatbotMessageHandler {
  const random = dependencies.random ?? Math.random;
  const now = dependencies.now ?? Date.now;

  return async (account, message) => {
    if (!account.account.enabled || !account.pluginEnabled) return;

    const pluginConfig = account.pluginConfig ?? {};
    const mode = configString(pluginConfig, 'bridge_mode', 'chat');
    if (mode === 'reserved2' || mode === 'closed-agent') return;

    const ownerIds = configIdSet(pluginConfig.bridge_owner_ids);
    const allowedGroups = configIdSet(pluginConfig.bridge_allowed_groups);
    const group = await dependencies.findGroup(account.account.id, message.groupId);
    if (!group?.enabled) return;
    if (allowedGroups.size > 0 && !allowedGroups.has(group.externalId)) return;

    const isOwner = ownerIds.has(message.userId);
    if (group.whitelistEnabled && !isOwner && !group.whitelistUserIds.includes(message.userId)) return;

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

    const maxContext = configNumber(pluginConfig, 'max_context', 262_144, 4096, 2_000_000);
    const compactRate = configNumber(pluginConfig, 'compact_rate', 0.8, 0.1, 0.99);
    const context = trimContext(
      await dependencies.getRecentContext(group.id, CONTEXT_MESSAGE_LIMIT),
      Math.max(1, Math.floor(maxContext * compactRate)),
    );
    const request: ProviderChatRequest = {
      model: group.model || configString(pluginConfig, 'agent_model'),
      messages: [
        ...(group.systemPrompt.trim() ? [{ role: 'system' as const, content: group.systemPrompt }] : []),
        ...context,
        { role: 'user', content: message.text },
      ],
      reasoningEffort: group.reasoningEffort,
    };
    const completion = await completeOpenAICompatible(provider, request, dependencies.fetch);
    const inputCost = group.inputCostPerMillion > 0
      ? group.inputCostPerMillion
      : configNumber(pluginConfig, 'bridge_input_cost_per_million', 0, 0);
    const outputCost = group.outputCostPerMillion > 0
      ? group.outputCostPerMillion
      : configNumber(pluginConfig, 'bridge_output_cost_per_million', 0, 0);
    const cost = (completion.promptTokens * inputCost + completion.completionTokens * outputCost) / 1_000_000;
    await dependencies.recordGroupCost(group, cost, costPeriodAt);
    const reply = completion.content.trim();
    if (!reply) return;
    if (mode === 'reserved' && reply === '[SILENT]') return;

    const maxMessageChars = configNumber(pluginConfig, 'bridge_max_message_chars', 500, 100, 4000);
    const parts = splitMessage(reply, Math.max(100, Math.trunc(maxMessageChars)));
    if (!parts.length) return;
    const perMinute = Math.trunc(configNumber(pluginConfig, 'bridge_max_messages_per_minute', 6, 1, 60));
    const reserve = dependencies.reserveOutbound ?? reserveOutbound;
    if (!reserve(group.id, parts.length, costPeriodAt, perMinute)) return;

    await sendAndLog(account, message, group, reply, parts, dependencies, now);
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
  parts: string[],
  dependencies: ChatbotHandlerDependencies,
  now: () => number,
): Promise<void> {
  for (const part of parts) {
    await dependencies.sendReply(account, message.groupId, message.id, part);
  }
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
