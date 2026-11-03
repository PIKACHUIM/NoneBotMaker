import { Hono } from 'hono';
import type { GroupRecord, JsonObject, RuntimeBindings } from '../../shared/types';
import { configIdSet, configString, conversationIdList, matchesConversationId, primaryConversationId } from '../../shared/plugin-catalog';
import type { QQGroupMessage } from '../protocols/qq/types';
import { resolveQQAccountById } from '../protocols/qq/accounts';
import { createRepository } from '../storage/repository';
import { createPersistentChatbotStores, createStoredChatbotHandler } from '../plugins/chatbot/runtime';
import { applyGroupPolicies, loadPolicyLayers } from '../plugins/chatbot/policies';
import { createMemeLibrary } from '../plugins/chatbot/meme-library';
import { createKVMemeStore } from '../plugins/chatbot/meme-storage';
import { ApiError } from './management';

interface ConversationControlRequest {
  action: 'status' | 'reset' | 'mode' | 'silent' | 'initialPrompt' | 'tools' | 'wakeList' | 'wakeCancel' | 'approvals' | 'approvalDecision' | 'memeList' | 'memeDelete';
  mode?: string;
  silent?: boolean;
  prompt?: string | null;
  disabledTools?: string[];
  wakeId?: string;
  approvalId?: string;
  decision?: 'approve' | 'reject';
  externalId?: string;
  memeName?: string;
}

interface QQControlNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

function requiredValue(value: unknown, key: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, `invalid_${key}`);
  return value.trim();
}

function safeApprovalSummary(state: JsonObject): Array<{ id: string; tool: string; status: string; expiresAt: number; requestedBy: string }> {
  if (!Array.isArray(state.toolApprovals)) return [];
  return state.toolApprovals.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const approval = value as Record<string, unknown>;
    const call = approval.call as Record<string, unknown> | undefined;
    const fn = call?.function as Record<string, unknown> | undefined;
    if (typeof approval.id !== 'string' || typeof fn?.name !== 'string' || typeof approval.status !== 'string' || !Number.isFinite(approval.expiresAt)) return [];
    return [{ id: approval.id, tool: fn.name, status: approval.status, expiresAt: approval.expiresAt as number, requestedBy: typeof approval.requestedBy === 'string' ? approval.requestedBy : '' }];
  });
}

async function doControl(bindings: RuntimeBindings, accountId: string, group: GroupRecord, input: ConversationControlRequest): Promise<unknown> {
  const namespace = bindings.QQ_GATEWAY_SESSIONS as QQControlNamespace | undefined;
  if (!namespace) throw new ApiError(503, 'conversation_control_unavailable');
  const response = await namespace.get(namespace.idFromName(accountId)).fetch(new Request('https://qq-gateway.internal/control', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, groupId: group.id, ...input, externalId: input.externalId ?? primaryConversationId(group.externalId) }), signal: AbortSignal.timeout(10_000),
  }));
  if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : response.status as 400 | 403 | 404, 'conversation_control_unavailable');
  const result = await response.json() as { data?: unknown };
  return result.data;
}

async function executeConsoleApproval(
  bindings: RuntimeBindings,
  group: GroupRecord,
  externalId: string,
  input: ConversationControlRequest,
  stores: ReturnType<typeof createPersistentChatbotStores>,
): Promise<unknown> {
  if (!input.approvalId || !['approve', 'reject'].includes(input.decision ?? '')) throw new ApiError(400, 'invalid_approvalDecision');
  const account = await resolveQQAccountById(group.accountId, bindings);
  if (!account) throw new ApiError(404, 'account_unavailable');
  const repository = createRepository(bindings);
  const resolved = applyGroupPolicies(group, await loadPolicyLayers(repository, group as unknown as JsonObject), account.pluginConfig);
  const ownerId = [...configIdSet(resolved.config?.bridge_owner_ids)][0];
  if (!ownerId) throw new ApiError(409, 'conversation_owner_not_configured');
  const messages: string[] = [];
  const handler = createStoredChatbotHandler(bindings, {
    ...stores,
    sendReply: async (_bot, _target, _messageId, content) => { messages.push(content); },
  });
  const message: QQGroupMessage = {
    id: `console-${crypto.randomUUID()}`, eventId: `console-${crypto.randomUUID()}`, accountId: group.accountId,
    botId: account.appId, groupId: externalId, userId: ownerId, text: `/${input.decision} ${input.approvalId}`,
    mentionsBot: true, receivedAt: Date.now(), conversationType: group.conversationType ?? 'group',
    eventType: (group.conversationType ?? 'group') === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE',
  };
  await handler(account, message);
  return { decision: input.decision, actingOwnerId: ownerId, messages };
}

async function localControl(bindings: RuntimeBindings, group: GroupRecord, input: ConversationControlRequest): Promise<unknown> {
  const stores = createPersistentChatbotStores(bindings);
  const externalId = input.externalId ?? primaryConversationId(group.externalId);
  if (!matchesConversationId(group.externalId, externalId)) throw new ApiError(404, 'not_found');
  const scope = JSON.stringify([group.accountId, group.conversationType ?? 'group', externalId]);
  const state = await stores.conversationStore.getState?.(scope) ?? {};
  switch (input.action) {
    case 'status': {
      const mode = typeof state.mode === 'string' ? state.mode : configString(group.config, 'bridge_mode', 'chat');
      const context = await stores.conversationStore.getRecent(scope, 1000);
      return { groupId: group.id, accountId: group.accountId, externalId, conversationType: group.conversationType ?? 'group', mode, silent: state.silent === true, contextMessages: context.length, initialPromptPending: typeof state.initialPrompt === 'string', disabledTools: [...configIdSet(state.disabledTools)], pendingApprovals: safeApprovalSummary(state), pendingWait: Boolean(state.pendingAgentWait) };
    }
    case 'reset':
      if (!stores.conversationStore.clear) throw new ApiError(503, 'conversation_reset_unavailable');
      await stores.conversationStore.clear(scope);
      delete state.pendingAgentWait;
      await stores.conversationStore.setState?.(scope, state);
      return { reset: true };
    case 'mode':
      if (!['chat', 'reserved', 'reserved2', 'closed-agent'].includes(input.mode ?? '')) throw new ApiError(400, 'invalid_mode');
      state.mode = input.mode;
      delete state.disabledTools;
      delete state.pendingAgentWait;
      await stores.conversationStore.setState?.(scope, state);
      return { mode: input.mode };
    case 'silent':
      state.silent = input.silent === true;
      await stores.conversationStore.setState?.(scope, state);
      return { silent: state.silent };
    case 'initialPrompt':
      if (input.prompt === null) delete state.initialPrompt;
      else {
        if (typeof input.prompt !== 'string' || new TextEncoder().encode(input.prompt).byteLength > 4000) throw new ApiError(400, 'invalid_initialPrompt');
        state.initialPrompt = input.prompt;
      }
      await stores.conversationStore.setState?.(scope, state);
      return { initialPromptPending: typeof state.initialPrompt === 'string' };
    case 'tools':
      if (!Array.isArray(input.disabledTools) || input.disabledTools.length > 200 || input.disabledTools.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name))) throw new ApiError(400, 'invalid_disabledTools');
      state.disabledTools = [...new Set(input.disabledTools)];
      await stores.conversationStore.setState?.(scope, state);
      return { disabledTools: state.disabledTools };
    case 'approvals':
      return { items: safeApprovalSummary(state) };
    case 'approvalDecision':
      return executeConsoleApproval(bindings, group, externalId, input, stores);
    case 'memeList': {
      const store = createKVMemeStore(bindings);
      if (!store) throw new ApiError(503, 'meme_storage_unavailable');
      const library = createMemeLibrary({ store, review: async () => 'uncertain' });
      return { items: await library.list(group.accountId, scope) };
    }
    case 'memeDelete': {
      const store = createKVMemeStore(bindings);
      if (!store) throw new ApiError(503, 'meme_storage_unavailable');
      if (!input.memeName) throw new ApiError(400, 'invalid_memeName');
      const library = createMemeLibrary({ store, review: async () => 'uncertain' });
      return { deleted: await library.delete(group.accountId, scope, input.memeName) };
    }
    case 'wakeList':
    case 'wakeCancel':
      throw new ApiError(503, 'wake_management_unavailable');
  }
}

async function control(bindings: RuntimeBindings, accountId: string, group: GroupRecord, input: ConversationControlRequest): Promise<unknown> {
  if (bindings.PLATFORM === 'cloudflare' && bindings.QQ_GATEWAY_SESSIONS) return doControl(bindings, accountId, group, input);
  return localControl(bindings, group, input);
}

export function registerChatbotRuntimeRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/chatbot/conversations', async (context) => {
    const repository = createRepository(context.env);
    const accounts = await repository.list('accounts');
    const accountId = context.req.query('accountId');
    const groups = await repository.list('groups');
    return context.json({ data: groups.filter((item) => !accountId || item.accountId === accountId).flatMap((item) =>
      conversationIdList(item.externalId).map((externalId) => ({
        id: item.id, accountId: item.accountId, accountName: accounts.find((account) => account.id === item.accountId)?.name ?? '',
        externalId, conversationType: item.conversationType ?? 'group', name: item.name,
        enabled: item.enabled, mode: configString(item.config as JsonObject | undefined, 'bridge_mode', 'chat'),
      }))) });
  });

  api.get('/chatbot/conversations/:accountId/:groupId', async (context) => {
    const accountId = requiredValue(context.req.param('accountId'), 'accountId');
    const groupId = requiredValue(context.req.param('groupId'), 'groupId');
    const repository = createRepository(context.env);
    const group = await repository.get('groups', groupId) as unknown as GroupRecord | null;
    if (!group || group.accountId !== accountId) throw new ApiError(404, 'not_found');
    const externalId = requiredValue(context.req.query('externalId') ?? primaryConversationId(group.externalId), 'externalId');
    if (!matchesConversationId(group.externalId, externalId)) throw new ApiError(404, 'not_found');
    return context.json({ data: await control(context.env, accountId, group, { action: 'status', externalId }) });
  });

  api.get('/chatbot/conversations/:accountId/:groupId/approvals', async (context) => {
    const accountId = requiredValue(context.req.param('accountId'), 'accountId');
    const groupId = requiredValue(context.req.param('groupId'), 'groupId');
    const repository = createRepository(context.env);
    const group = await repository.get('groups', groupId) as unknown as GroupRecord | null;
    if (!group || group.accountId !== accountId) throw new ApiError(404, 'not_found');
    const externalId = requiredValue(context.req.query('externalId') ?? primaryConversationId(group.externalId), 'externalId');
    if (!matchesConversationId(group.externalId, externalId)) throw new ApiError(404, 'not_found');
    return context.json({ data: await control(context.env, accountId, group, { action: 'approvals', externalId }) });
  });

  api.post('/chatbot/conversations/:accountId/:groupId/control', async (context) => {
    const accountId = requiredValue(context.req.param('accountId'), 'accountId');
    const groupId = requiredValue(context.req.param('groupId'), 'groupId');
    let body: Record<string, unknown>;
    try { body = await context.req.json() as Record<string, unknown>; }
    catch { throw new ApiError(400, 'invalid_json'); }
    const action = requiredValue(body.action, 'action') as ConversationControlRequest['action'];
    if (!['reset', 'mode', 'silent', 'initialPrompt', 'tools', 'wakeList', 'wakeCancel', 'approvalDecision', 'memeList', 'memeDelete'].includes(action)) throw new ApiError(400, 'invalid_action');
    const repository = createRepository(context.env);
    const group = await repository.get('groups', groupId) as unknown as GroupRecord | null;
    if (!group || group.accountId !== accountId) throw new ApiError(404, 'not_found');
    const externalId = requiredValue(body.externalId ?? primaryConversationId(group.externalId), 'externalId');
    if (!matchesConversationId(group.externalId, externalId)) throw new ApiError(404, 'not_found');
    const input: ConversationControlRequest = {
      action, externalId,
      ...(typeof body.approvalId === 'string' ? { approvalId: body.approvalId } : {}),
      ...(body.decision === 'approve' || body.decision === 'reject' ? { decision: body.decision } : {}),
      ...(typeof body.mode === 'string' ? { mode: body.mode } : {}),
      ...(typeof body.silent === 'boolean' ? { silent: body.silent } : {}),
      ...(body.prompt === null || typeof body.prompt === 'string' ? { prompt: body.prompt as string | null } : {}),
      ...(Array.isArray(body.disabledTools) ? { disabledTools: body.disabledTools as string[] } : {}),
      ...(typeof body.wakeId === 'string' ? { wakeId: body.wakeId } : {}),
      ...(typeof body.memeName === 'string' ? { memeName: body.memeName } : {}),
    };
    return context.json({ data: await control(context.env, accountId, group, input) });
  });
}
