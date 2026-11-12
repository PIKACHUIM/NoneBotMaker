import type { ChatMessage, GroupRecord, JsonObject, RuntimeBindings } from '../../shared/types';
import { configIdSet, configNumber, configString, effectivePolicyConfig, matchesConversationId, primaryConversationId } from '../../shared/plugin-catalog';
import { readBoolean } from '../../server/env';
import { completeRecentTurns } from '../../server/plugins/chatbot/tools';
import { createMemeLibrary } from '../../server/plugins/chatbot/meme-library';
import { createKVMemeStore } from '../../server/plugins/chatbot/meme-storage';
import { createKVVoiceAssetStore, createVoiceLibrary } from '../../server/plugins/chatbot/voice-library';
import { SlangWorkflow } from '../../server/plugins/chatbot/slang';
import { createConversationLogRepository, sanitizeLogDetails } from '../../server/storage/conversation-log-repository';
import { createStoredChatbotHandler, type GroupConversationStore, type GroupCostStore } from '../../server/plugins/chatbot/runtime';
import { ToolApprovalManager } from '../../server/plugins/chatbot/approval';
import { applyGroupPolicies, hasPolicySelection, loadPolicyLayers } from '../../server/plugins/chatbot/policies';
import { createRepository } from '../../server/storage/repository';
import { decryptSecrets } from '../../server/storage/secrets';
import { getQQAccessToken, replyToQQGroup, sendQQMedia } from '../../server/protocols/qq/api';
import { resolveQQAccountById } from '../../server/protocols/qq/accounts';
import { normalizeQQGroupMessage } from '../../server/protocols/qq/message';
import type { QQAccountContext, QQGroupMessage } from '../../server/protocols/qq/types';

const GATEWAY_ENDPOINT = 'https://api.bot.qq.com/gateway/bot';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const MAX_CONTEXT_ENTRIES = 1000;
const MAX_RECENT_MESSAGE_IDS = 512;
const DEDUPE_RETENTION_MS = 10 * 60_000;
const GROUP_AND_C2C_INTENT = 1 << 25;

interface DurableStorageData {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface ChunkManifest {
  format: 'qq-json-chunks-v1';
  version: string;
  count: number;
}

interface DurableObjectStorageLike extends DurableStorageData {
  transaction?<T>(callback: (transaction: DurableStorageData) => Promise<T>): Promise<T>;
  setAlarm(when: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
}

interface QQGatewayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface QQGatewayPacket {
  op?: unknown;
  s?: unknown;
  t?: unknown;
  d?: unknown;
}

interface QQGatewaySession {
  sessionId: string;
  sequence: number | null;
}

interface PendingMessage {
  message: QQGroupMessage;
  dueAt: number;
  attempts: number;
}

export interface QQGatewayDurableObjectOptions {
  fetch?: typeof fetch;
  createWebSocket?: (url: string) => WebSocket;
  resolveAccount?: (accountId: string, bindings: RuntimeBindings) => Promise<QQAccountContext | null>;
  getAccessToken?: (account: QQAccountContext) => Promise<string>;
  handleMessage?: (account: QQAccountContext, message: QQGroupMessage) => Promise<void>;
  now?: () => number;
}

let lastSessionSyncAt = 0;
let lastSessionSyncMode: 'webhook' | 'websocket' | undefined;
let sessionSync: Promise<void> | undefined;

export async function ensureQQGatewaySessions(bindings: RuntimeBindings): Promise<void> {
  const method = bindings.API_METHOD ?? 'webhook';
  if (method !== 'webhook' && method !== 'websocket') throw new Error('API_METHOD must be webhook or websocket.');
  if (method === 'websocket' && bindings.PLATFORM !== 'cloudflare') {
    throw new Error(`API_METHOD=websocket is only supported on Cloudflare, not ${bindings.PLATFORM ?? 'an unspecified platform'}.`);
  }
  if (method === 'webhook' && !bindings.QQ_GATEWAY_SESSIONS) return;

  const now = Date.now();
  if (lastSessionSyncMode === method && (method === 'webhook' || now - lastSessionSyncAt < 60_000)) return;
  if (sessionSync) return sessionSync;
  sessionSync = method === 'websocket' ? startConfiguredAccounts(bindings) : stopConfiguredAccounts(bindings);
  try {
    await sessionSync;
    lastSessionSyncMode = method;
    lastSessionSyncAt = Date.now();
  } finally {
    sessionSync = undefined;
  }
}

async function startConfiguredAccounts(bindings: RuntimeBindings): Promise<void> {
  await sendAccountCommands(bindings, '/connect');
}

async function stopConfiguredAccounts(bindings: RuntimeBindings): Promise<void> {
  await sendAccountCommands(bindings, '/disconnect');
}

async function sendAccountCommands(bindings: RuntimeBindings, path: '/connect' | '/disconnect'): Promise<void> {
  const namespace = bindings.QQ_GATEWAY_SESSIONS as QQGatewayNamespace | undefined;
  if (!namespace) throw new Error('QQ_GATEWAY_SESSIONS Durable Object binding is not configured.');

  const repository = createRepository(bindings);
  const accounts = await repository.list('accounts');
  await Promise.all(accounts.filter((account) => account.protocol === 'qq').map(async (account) => {
    const stub = namespace.get(namespace.idFromName(account.id));
    const response = await stub.fetch(new Request(`https://qq-gateway.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    }));
    if (!response.ok) throw new Error('Unable to update QQ gateway sessions.');
  }));
}

export class QQGatewayDurableObject {
  private socket?: WebSocket;
  private accountId?: string;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private messageQueue: Promise<void> = Promise.resolve();
  private processingQueue: Promise<void> = Promise.resolve();
  private queueMutations: Promise<void> = Promise.resolve();
  private completedHandlers = new Set<string>();
  private approvalClaims: Promise<void> = Promise.resolve();
  private reconnectAttempt = 0;
  private awaitingHeartbeatAck = false;
  private heartbeatInterval = 45_000;
  private readonly fetchImpl: typeof fetch;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly resolveAccount: NonNullable<QQGatewayDurableObjectOptions['resolveAccount']>;
  private readonly getAccessToken: NonNullable<QQGatewayDurableObjectOptions['getAccessToken']>;
  private readonly injectedMessageHandler?: QQGatewayDurableObjectOptions['handleMessage'];
  private readonly now: () => number;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: RuntimeBindings,
    options: QQGatewayDurableObjectOptions = {},
  ) {
    this.env = { ...env, PLATFORM: env.PLATFORM ?? 'cloudflare' };
    this.fetchImpl = options.fetch ?? fetch;
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.resolveAccount = options.resolveAccount ?? ((accountId, bindings) => resolveQQAccountById(accountId, bindings));
    this.getAccessToken = options.getAccessToken ?? ((account) => getQQAccessToken(account));
    this.injectedMessageHandler = options.handleMessage;
    this.now = options.now ?? Date.now;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.PLATFORM !== 'cloudflare') {
      return Response.json({ error: 'websocket_unsupported' }, { status: 503 });
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/control') return this.controlConversation(request);
    if (request.method === 'POST' && url.pathname === '/enqueue') {
      let body: { accountId?: unknown; message?: QQGroupMessage };
      try { body = await request.json() as typeof body; }
      catch { return Response.json({ error: 'invalid_request' }, { status: 400 }); }
      if (typeof body.accountId !== 'string' || !body.message?.id || body.message.accountId !== body.accountId) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      const account = await this.resolveAccount(body.accountId, this.env);
      if (!account) return Response.json({ error: 'account_unavailable' }, { status: 503 });
      this.messageQueue = this.messageQueue.catch(() => undefined).then(() => this.enqueueMessage(account, body.message!));
      try { await this.messageQueue; }
      catch { return Response.json({ error: 'queue_unavailable' }, { status: 503 }); }
      return Response.json({ queued: true }, { status: 202 });
    }
    if (request.method === 'POST' && url.pathname === '/disconnect') {
      await this.disconnect();
      return Response.json({ connected: false });
    }

    if ((this.env.API_METHOD ?? 'webhook') !== 'websocket') {
      return Response.json({ error: 'websocket_disabled' }, { status: 503 });
    }

    if (request.method === 'POST' && url.pathname === '/connect') {
      let body: { accountId?: unknown };
      try {
        body = await request.json() as { accountId?: unknown };
      } catch {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }

      try {
        await this.connectAccount(body.accountId);
        return Response.json({ starting: this.accountId === body.accountId }, { status: 202 });
      } catch (error) {
        console.error('QQ gateway connect failed.', errorMessage(error));
        await this.recordGatewayState(false, errorMessage(error));
        await this.scheduleReconnect();
        return Response.json({ starting: false, retryScheduled: true }, { status: 202 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json({ connected: this.socket?.readyState === WebSocket.OPEN });
    }

    return new Response('Not found', { status: 404 });
  }

  private async controlConversation(request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return Response.json({ error: 'invalid_request' }, { status: 400 }); }
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    const groupId = typeof body.groupId === 'string' ? body.groupId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!accountId || !groupId || !['status', 'reset', 'mode', 'silent', 'initialPrompt', 'tools', 'reconnect', 'wakeList', 'wakeCancel', 'approvals', 'approvalUpdate', 'approvalDecision', 'memeList', 'memeDelete', 'slangList', 'slangCreate', 'slangApprove', 'slangReject', 'slangDelete', 'slangUpdate', 'voiceList', 'voiceUpload', 'voiceDelete'].includes(action)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const repository = createRepository(this.env);
    const stored = await repository.get('groups', groupId);
    if (!stored || stored.accountId !== accountId) return Response.json({ error: 'not_found' }, { status: 404 });
    const account = await this.resolveAccount(accountId, this.env);
    if (!account) return Response.json({ error: 'account_unavailable' }, { status: 404 });
    const decryptedGroup = await decryptSecrets(stored as JsonObject, this.env) as unknown as GroupRecord;
    const externalId = typeof body.externalId === 'string' ? body.externalId : primaryConversationId(decryptedGroup.externalId);
    if (!matchesConversationId(decryptedGroup.externalId, externalId)) return Response.json({ error: 'not_found' }, { status: 404 });
    const rawGroup = { ...decryptedGroup, externalId };
    const group = applyGroupPolicies(rawGroup, await loadPolicyLayers(repository, stored), account.pluginConfig);
    const scope = JSON.stringify([accountId, group.conversationType ?? 'group', group.externalId]);
    const store = this.conversationStore();
    if (!store.getState || !store.setState) return Response.json({ error: 'conversation_control_unavailable' }, { status: 503 });
    const readState = store.getState.bind(store);
    const writeState = store.setState.bind(store);
    if (action === 'reconnect') {
      if ((this.env.API_METHOD ?? 'webhook') !== 'websocket') return Response.json({ error: 'gateway_disabled' }, { status: 409 });
      try {
        await this.connectAccount(accountId);
        return Response.json({ data: { connected: this.socket?.readyState === WebSocket.OPEN } });
      } catch (error) {
        await this.recordGatewayState(false, errorMessage(error));
        return Response.json({ error: 'gateway_reconnect_failed' }, { status: 503 });
      }
    }
    if (action === 'approvalUpdate') {
      if (typeof body.approvalId !== 'string' || typeof body.arguments !== 'string') return Response.json({ error: 'invalid_approvalUpdate' }, { status: 400 });
      const manager = new ToolApprovalManager({ scopeKey: scope, getState: async () => await readState(scope),
        setState: async (next) => { await writeState(scope, next); }, now: this.now });
      try {
        const updated = await manager.updateArguments(body.approvalId, body.arguments, 'console-admin', true);
        return Response.json({ data: { approval: { id: updated.id, tool: updated.call.function.name,
          arguments: JSON.parse(updated.call.function.arguments), editedBy: updated.editedBy, editedAt: updated.editedAt } } });
      } catch (error) {
        const reason = errorMessage(error);
        return Response.json({ error: 'invalid_approvalUpdate' }, { status: reason.includes('does not exist') ? 404 : reason.includes('cannot be edited') ? 409 : 400 });
      }
    }
    const state = await readState(scope);
    const approvals = Array.isArray(state.toolApprovals) ? state.toolApprovals.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const approval = value as Record<string, unknown>;
      const call = approval.call as Record<string, unknown> | undefined;
      const fn = call?.function as Record<string, unknown> | undefined;
      if (typeof approval.id !== 'string' || typeof fn?.name !== 'string' || typeof approval.status !== 'string' || !Number.isFinite(approval.expiresAt)) return [];
      let args: JsonObject | undefined;
      if (typeof fn.arguments === 'string' && fn.arguments.length <= 16_384) { try { args = sanitizeLogDetails(JSON.parse(fn.arguments)); } catch { args = { unavailable: 'invalid_json' }; } }
      return [{ id: approval.id, tool: fn.name, status: approval.status, expiresAt: approval.expiresAt as number,
        requestedBy: typeof approval.requestedBy === 'string' ? approval.requestedBy : '', ...(args ? { arguments: args } : {}) }];
    }) : [];
    if (action === 'status') {
      return Response.json({ data: {
        accountId, groupId, externalId: group.externalId, conversationType: group.conversationType ?? 'group', enabled: group.enabled,
        connected: this.socket?.readyState === WebSocket.OPEN, gatewayMode: this.env.API_METHOD === 'websocket' ? 'websocket' : 'webhook', mode: typeof state.mode === 'string' ? state.mode : configString(group.config, 'bridge_mode', 'chat'),
        silent: state.silent === true, model: group.model, providerId: group.providerId,
        contextMessages: (await store.getRecent(scope, 1000)).length, initialPromptPending: typeof state.initialPrompt === 'string',
        ...(typeof state.initialPrompt === 'string' ? { initialPrompt: state.initialPrompt } : {}),
        disabledTools: [...configIdSet(state.disabledTools)], pendingAgentWait: Boolean(state.pendingAgentWait),
        pendingApprovals: approvals, policyIds: { dialog: group.dialogPolicyId ?? '', voice: group.voicePolicyId ?? '', identity: group.identityPolicyId ?? '' },
      } });
    }
    if (action === 'reset') {
      if (!store.clear) return Response.json({ error: 'conversation_reset_unavailable' }, { status: 503 });
      await store.clear(scope);
      delete state.pendingAgentWait;
      await writeState(scope, state);
      return Response.json({ data: { reset: true } });
    }
    if (action === 'mode') {
      if (!['chat', 'reserved', 'reserved2', 'closed-agent'].includes(String(body.mode))) return Response.json({ error: 'invalid_mode' }, { status: 400 });
      state.mode = body.mode;
      delete state.disabledTools;
      delete state.pendingAgentWait;
      await writeState(scope, state);
      return Response.json({ data: { mode: state.mode } });
    }
    if (action === 'silent') {
      if (typeof body.silent !== 'boolean') return Response.json({ error: 'invalid_silent' }, { status: 400 });
      state.silent = body.silent;
      await writeState(scope, state);
      return Response.json({ data: { silent: state.silent } });
    }
    if (action === 'initialPrompt') {
      if (body.prompt === null) delete state.initialPrompt;
      else if (typeof body.prompt === 'string' && new TextEncoder().encode(body.prompt).byteLength <= 4000) state.initialPrompt = body.prompt;
      else return Response.json({ error: 'invalid_initialPrompt' }, { status: 400 });
      await writeState(scope, state);
      return Response.json({ data: { initialPromptPending: typeof state.initialPrompt === 'string' } });
    }
    if (action === 'tools') {
      if (!Array.isArray(body.disabledTools) || body.disabledTools.length > 200 || body.disabledTools.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name))) return Response.json({ error: 'invalid_disabledTools' }, { status: 400 });
      state.disabledTools = [...new Set(body.disabledTools)];
      await writeState(scope, state);
      return Response.json({ data: { disabledTools: state.disabledTools } });
    }
    if (action === 'voiceList' || action === 'voiceUpload' || action === 'voiceDelete') {
      const voiceStore = createKVVoiceAssetStore(this.env);
      if (!voiceStore) return Response.json({ error: 'voice_storage_unavailable' }, { status: 503 });
      const library = createVoiceLibrary(voiceStore);
      if (action === 'voiceList') return Response.json({ data: { items: await library.list(accountId) } });
      if (action === 'voiceDelete') {
        if (typeof body.voiceName !== 'string') return Response.json({ error: 'invalid_voice_asset' }, { status: 400 });
        return Response.json({ data: { deleted: await library.delete(accountId, 'account', body.voiceName) } });
      }
      if (typeof body.voiceName !== 'string' || typeof body.voiceContentType !== 'string' || typeof body.voiceData !== 'string' || body.voiceData.length > 7 * 1024 * 1024) return Response.json({ error: 'invalid_voice_asset' }, { status: 400 });
      let voiceBytes: Uint8Array;
      try { voiceBytes = Uint8Array.from(atob(body.voiceData), (character) => character.charCodeAt(0)); } catch { return Response.json({ error: 'invalid_voice_asset' }, { status: 400 }); }
      const asset = await library.save({ accountId, scope: 'account', name: body.voiceName, contentType: body.voiceContentType, bytes: voiceBytes, createdBy: 'console-admin' });
      return Response.json({ data: { asset } });
    }
    if (action === 'memeList' || action === 'memeDelete') {
      const memeStore = createKVMemeStore(this.env);
      if (!memeStore) return Response.json({ error: 'meme_storage_unavailable' }, { status: 503 });
      const library = createMemeLibrary({ store: memeStore, review: async () => 'uncertain' });
      if (action === 'memeList') return Response.json({ data: { items: await library.list(accountId, scope) } });
      if (typeof body.memeName !== 'string') return Response.json({ error: 'invalid_memeName' }, { status: 400 });
      return Response.json({ data: { deleted: await library.delete(accountId, scope, body.memeName) } });
    }
    const source: QQGroupMessage = {
      id: 'console-control', accountId, botId: account.appId, groupId: primaryConversationId(group.externalId), userId: '', text: '', mentionsBot: false,
      receivedAt: this.now(), conversationType: group.conversationType ?? 'group', eventType: group.conversationType === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE',
    };
    if (action === 'approvalDecision') {
      if (typeof body.approvalId !== 'string' || !['approve', 'reject'].includes(String(body.decision))) return Response.json({ error: 'invalid_approvalDecision' }, { status: 400 });
      const ownerId = [...configIdSet(group.config?.bridge_owner_ids)][0];
      if (!ownerId) return Response.json({ error: 'conversation_owner_not_configured' }, { status: 409 });
      const replies: string[] = [];
      const handler = createStoredChatbotHandler(this.env, {
        conversationStore: store, costStore: this.costStore(),
        sendReply: async (_bot, _target, _messageId, content) => { replies.push(content); },
        reserveOutbound: async () => true,
        fetch: this.fetchImpl, now: this.now,
      });
      await handler(account, { ...source, id: `console-${crypto.randomUUID()}`, eventId: `console-${crypto.randomUUID()}`, userId: ownerId, text: `/${body.decision} ${body.approvalId}`, mentionsBot: true });
      return Response.json({ data: { decision: body.decision, actingOwnerId: ownerId, messages: replies } });
    }
    if (action === 'wakeList') return Response.json({ data: { items: await this.listWakes(account, source) } });
    if (action === 'wakeCancel') {
      if (typeof body.wakeId !== 'string') return Response.json({ error: 'invalid_wakeId' }, { status: 400 });
      return Response.json({ data: { cancelled: await this.cancelWake(account, source, body.wakeId) } });
    }
    if (action.startsWith('slang')) {
      if ((group.conversationType ?? 'group') !== 'group') return Response.json({ error: 'slang_group_only' }, { status: 400 });
      const slang = new SlangWorkflow({ scopeKey: scope, getState: async () => await store.getState!(scope), setState: async (next) => { await store.setState!(scope, next); }, now: this.now,
        minMessages: Math.trunc(configNumber(group.config, 'bridge_slang_min_messages', 10, 3, 100)), cooldownSeconds: Math.trunc(configNumber(group.config, 'bridge_slang_cooldown_seconds', 300, 30, 86400)) });
      if (action === 'slangList') return Response.json({ data: { items: await slang.list() } });
      if (action === 'slangCreate') {
        if (typeof body.slangTerm !== 'string') return Response.json({ error: 'invalid_slangTerm' }, { status: 400 });
        return Response.json({ data: { item: await slang.propose(body.slangTerm, typeof body.slangContext === 'string' ? body.slangContext : '') } });
      }
      if (typeof body.slangId !== 'string') return Response.json({ error: 'invalid_slangId' }, { status: 400 });
      if (action === 'slangApprove') return Response.json({ data: { item: await slang.approve(body.slangId, true) } });
      if (action === 'slangReject') return Response.json({ data: { item: await slang.reject(body.slangId, true) } });
      if (action === 'slangUpdate') {
        const details = body.slangDetails as { meaning?: unknown; usage?: unknown; example?: unknown; risk?: unknown; sources?: unknown } | undefined;
        if (!details || typeof details.meaning !== 'string' || typeof details.usage !== 'string' || typeof details.example !== 'string' || typeof details.risk !== 'string' || details.sources !== undefined && (!Array.isArray(details.sources) || details.sources.some((source) => typeof source !== 'string'))) return Response.json({ error: 'invalid_slangDetails' }, { status: 400 });
        return Response.json({ data: { item: await slang.updateDetails(body.slangId, { meaning: details.meaning, usage: details.usage, example: details.example, risk: details.risk, ...(Array.isArray(details.sources) ? { sources: details.sources as string[] } : {}) }, true) } });
      }
      await slang.delete(body.slangId, true);
      return Response.json({ data: { deleted: true } });
    }
    return Response.json({ data: { items: approvals } });
  }

  async alarm(): Promise<void> {
    // 重连优先于可能较长的消息处理，避免provider请求阻塞gateway恢复。
    if ((this.env.API_METHOD ?? 'webhook') !== 'websocket') await this.disconnect();
    else {
      const accountId = await this.state.storage.get<string>('accountId');
      if (accountId) {
        try { await this.connectAccount(accountId); }
        catch (error) {
          await this.recordGatewayState(false, errorMessage(error));
          await this.scheduleReconnect();
        }
      }
    }
    this.processingQueue = this.processingQueue.catch(() => undefined).then(() => this.drainPendingMessages());
    await this.processingQueue;
  }

  private async connectAccount(accountId: string): Promise<void> {
    const account = await this.resolveAccount(accountId, this.env);
    if (!account || !account.account.enabled || !account.pluginEnabled) {
      await this.disconnect();
      return;
    }

    const version = `${account.appId}:${account.account.updatedAt}`;
    const savedVersion = await this.state.storage.get<string>('accountVersion');
    if (savedVersion !== version) {
      await this.closeSocket();
      await this.state.storage.delete('session');
      await this.state.storage.delete('sequence');
      await this.state.storage.put('accountVersion', version);
    }
    this.accountId = accountId;
    await this.state.storage.put('accountId', accountId);
    this.lastSequence = await this.state.storage.get<number>('sequence');

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      await this.setGatewayAlarm(this.now() + MAINTENANCE_INTERVAL_MS);
      return;
    }

    const accessToken = await this.getAccessToken(account);
    // 必须以裸函数调用全局fetch；以方法形式调用（this.fetchImpl）在Workers里会抛Illegal invocation。
    const fetchImpl = this.fetchImpl;
    const gatewayResponse = await fetchImpl(GATEWAY_ENDPOINT, {
      headers: { authorization: `QQBot ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!gatewayResponse.ok) throw new Error('QQ gateway lookup failed.');
    const gateway = await gatewayResponse.json() as { url?: unknown };
    if (typeof gateway.url !== 'string') throw new Error('QQ gateway response is invalid.');
    const gatewayUrl = new URL(gateway.url);
    if (gatewayUrl.protocol !== 'wss:' || !isQQGatewayHost(gatewayUrl.hostname)) {
      throw new Error('QQ gateway URL is invalid.');
    }

    const socket = this.createWebSocket(gatewayUrl.toString());
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleFrame(event.data))
        .catch(async () => {
          await this.closeSocket();
          await this.scheduleReconnect();
        });
      this.state.waitUntil(this.messageQueue);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.clearHeartbeat();
      this.socket = undefined;
      this.state.waitUntil(this.recordGatewayState(false, `closed ${event.code} ${event.reason ?? ''}`.trim()));
      if (event.code === 4914 || event.code === 4915) {
        this.state.waitUntil(this.disconnect());
        return;
      }
      this.state.waitUntil(this.scheduleReconnect());
    });
    socket.addEventListener('error', () => socket.close());
    await this.setGatewayAlarm(this.now() + MAINTENANCE_INTERVAL_MS);
  }

  private async handleFrame(data: string | ArrayBuffer | Blob): Promise<void> {
    const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
    const packet = JSON.parse(text) as QQGatewayPacket;
    if (!Number.isInteger(packet.op)) return;

    if (packet.op === 10) {
      const hello = packet.d as { heartbeat_interval?: unknown } | null;
      if (!hello || typeof hello.heartbeat_interval !== 'number' || !Number.isFinite(hello.heartbeat_interval)) {
        throw new Error('QQ gateway HELLO is invalid.');
      }
      this.heartbeatInterval = Math.max(1_000, Math.min(120_000, hello.heartbeat_interval));
      await this.sendIdentifyOrResume();
      return;
    }

    if (packet.op === 11) {
      this.awaitingHeartbeatAck = false;
      return;
    }

    if (packet.op === 1) {
      this.sendHeartbeat();
      return;
    }

    if (packet.op === 7 || packet.op === 9) {
      if (packet.op === 9) {
        await this.state.storage.delete('session');
        await this.state.storage.delete('sequence');
        this.lastSequence = undefined;
      }
      await this.closeSocket();
      await this.scheduleReconnect();
      return;
    }

    if (packet.op !== 0) return;
    const sequence = Number.isSafeInteger(packet.s) ? packet.s as number : null;
    if (packet.t === 'READY') {
      const ready = packet.d as { session_id?: unknown } | null;
      if (typeof ready?.session_id === 'string') {
        await this.state.storage.put('session', {
          sessionId: ready.session_id,
          sequence,
        } satisfies QQGatewaySession);
      }
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      console.log('QQ gateway session ready.', this.accountId);
      await this.recordGatewayState(true);
    } else if (packet.t === 'RESUMED') {
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      await this.recordGatewayState(true);
    } else if (packet.t === 'GROUP_AT_MESSAGE_CREATE' || packet.t === 'GROUP_MESSAGE_CREATE' || packet.t === 'C2C_MESSAGE_CREATE') {
      await this.handleGroupMessage(packet);
    }

    if (sequence !== null) {
      this.lastSequence = sequence;
      await this.state.storage.put('sequence', sequence);
      const session = await this.state.storage.get<QQGatewaySession>('session');
      if (session) await this.state.storage.put('session', { ...session, sequence });
    }
  }

  private async sendIdentifyOrResume(): Promise<void> {
    const accountId = this.accountId ?? await this.state.storage.get<string>('accountId');
    if (!accountId) throw new Error('QQ account is not configured.');
    const account = await this.resolveAccount(accountId, this.env);
    if (!account) throw new Error('QQ account is unavailable.');
    const accessToken = await this.getAccessToken(account);
    const session = await this.state.storage.get<QQGatewaySession>('session');

    if (session?.sessionId && Number.isSafeInteger(session.sequence)) {
      this.sendPacket({
        op: 6,
        d: { token: `QQBot ${accessToken}`, session_id: session.sessionId, seq: session.sequence },
      });
    } else {
      this.sendPacket({
        op: 2,
        d: {
          token: `QQBot ${accessToken}`,
          intents: GROUP_AND_C2C_INTENT,
          shard: [0, 1],
          properties: { $os: 'cloudflare', $browser: 'nonebotmaker', $device: 'nonebotmaker' },
        },
      });
    }
  }

  private async handleGroupMessage(packet: QQGatewayPacket): Promise<void> {
    const accountId = this.accountId ?? await this.state.storage.get<string>('accountId');
    if (!accountId) return;
    const account = await this.resolveAccount(accountId, this.env);
    if (!account || !account.account.enabled || !account.pluginEnabled) return;

    const message = normalizeQQGroupMessage(packet as { id?: string; t?: string; d?: unknown }, account, this.now());
    if (!message || await this.wasMessageProcessed(message.id)) return;

    if (this.injectedMessageHandler) {
      await this.injectedMessageHandler(account, message);
      await this.markMessageProcessed(message.id);
    } else {
      await this.enqueueMessage(account, message);
    }
  }

  private async enqueueMessage(account: QQAccountContext, message: QQGroupMessage): Promise<void> {
    if (await this.wasEventProcessed(message)) return;
    const repository = this.injectedMessageHandler ? undefined : createRepository(this.env);
    const group = repository ? await repository.list('groups').then((groups) => groups.find((entry) =>
      entry.accountId === account.account.id && matchesConversationId(entry.externalId, message.groupId) &&
      (entry.conversationType ?? 'group') === (message.conversationType ?? 'group'))) : undefined;
    const policies = group && repository && hasPolicySelection(group) ? await loadPolicyLayers(repository, group) : {};
    const config = group
      ? effectivePolicyConfig(account.pluginConfig, policies, group.config as JsonObject | undefined)
      : account.pluginConfig ?? {};
    const window = message.isWake || message.conversationType === 'private' ? 0 : configNumber(config, 'bridge_group_batch_seconds', 1, 0, 10) * 1000;
    await this.state.storage.put('queueAccountId', account.account.id);
    await this.updatePending(async (pending) => {
      if (pending.some((entry) => (entry.message.eventId ?? entry.message.id) === (message.eventId ?? message.id)) || await this.wasEventProcessed(message)) return pending;
      const hash = await this.messageHash(message.eventId ?? message.id);
      const processed = await this.state.storage.get<Array<{ id: string; at: number }>>(`processedMessages:${hash.slice(0, 2)}`) ?? [];
      if (processed.filter((entry) => this.now() - entry.at < DEDUPE_RETENTION_MS).length + pending.length >= MAX_RECENT_MESSAGE_IDS) throw new Error('QQ deduplication capacity reached.');
      const previous = pending.find((entry) => !entry.message.isWake && !message.isWake && this.messageScope(entry.message) === this.messageScope(message));
      const dueAt = previous?.dueAt ?? this.now() + Math.max(1, window);
      return [...pending, { message, dueAt, attempts: 0 }];
    });
  }

  private async drainPendingMessages(): Promise<void> {
    const accountId = await this.state.storage.get<string>('queueAccountId');
    if (!accountId) return;
    const account = await this.resolveAccount(accountId, this.env);
    if (!account) {
      await this.updatePending((waiting) => waiting.map((entry) => ({ ...entry, dueAt: Math.max(entry.dueAt, this.now() + 60_000) })));
      await this.schedulePendingAlarm();
      return;
    }
    const pending = await this.state.storage.get<PendingMessage[]>('pendingMessages') ?? [];
    const due: PendingMessage[] = [];
    for (const entry of pending.filter((item) => item.dueAt <= this.now()).slice(0, 100)) {
      const id = entry.message.eventId ?? entry.message.id;
      if (this.completedHandlers.has(id) || await this.wasEventProcessed(entry.message)) {
        try {
          await this.markMessageProcessed(id);
          await this.updatePending((current) => current.filter((item) => (item.message.eventId ?? item.message.id) !== id));
          this.completedHandlers.delete(id);
        } catch {
          await this.updatePending((current) => current.map((item) => (item.message.eventId ?? item.message.id) === id ? { ...item, dueAt: this.now() + 2000 } : item));
        }
      } else due.push(entry);
    }
    const processed = new Set<string>();
    for (const entry of due) {
      if (processed.has(entry.message.eventId ?? entry.message.id)) continue;
      const batch = entry.message.isWake ? [entry] : due.filter((item) => !processed.has(item.message.eventId ?? item.message.id) && !item.message.isWake && this.messageScope(item.message) === this.messageScope(entry.message));
      const latest = batch[batch.length - 1].message;
      const combined: QQGroupMessage = batch.length > 1 ? {
        ...latest, text: batch.map((item) => item.message.text).join('\n'),
        mentionsBot: batch.some((item) => item.message.mentionsBot),
        attachments: batch.flatMap((item) => item.message.attachments ?? []),
        batchMessages: batch.map((item) => item.message),
      } : latest;
      try {
        if (!(await this.wasMessageProcessed(entry.message.eventId ?? entry.message.id))) {
          if (this.injectedMessageHandler) await this.injectedMessageHandler(account, combined);
          else {
            const handler = createStoredChatbotHandler(this.env, {
              conversationStore: this.conversationStore(), costStore: this.costStore(),
              sendReply: async (bot, targetId, messageId, content, options) => {
                const seq = await this.allocateReplySequence(targetId, messageId, options?.seq ?? 1, options?.conversationType ?? 'group');
                await replyToQQGroup(bot, targetId, messageId, content, this.fetchImpl, seq, options?.conversationType, combined.isWake === true);
                for (const item of batch) this.completedHandlers.add(item.message.eventId ?? item.message.id);
              },
              sendMedia: async (bot, targetId, messageId, media, options) => {
                const seq = await this.allocateReplySequence(targetId, messageId, options.seq, options.conversationType);
                await sendQQMedia(bot, targetId, messageId, media, { ...options, seq }, this.fetchImpl, combined.isWake === true);
                for (const item of batch) this.completedHandlers.add(item.message.eventId ?? item.message.id);
              },
              reserveOutbound: async (key, count, at, limit) => this.reserveOutbound(key, count, at, limit),
              scheduleWake: async (bot, message, delay, reason) => this.scheduleWake(bot, message, delay, reason),
              listWakes: async (bot, message) => this.listWakes(bot, message),
              cancelWake: async (bot, message, id) => this.cancelWake(bot, message, id),
              fetch: this.fetchImpl, now: this.now,
            });
            await handler(account, combined);
          }
          for (const item of batch) this.completedHandlers.add(item.message.eventId ?? item.message.id);
          for (const item of batch) await this.markMessageProcessed(item.message.eventId ?? item.message.id);
        }
        await this.updatePending((current) => current.filter((item) => !batch.some((done) => (done.message.eventId ?? done.message.id) === (item.message.eventId ?? item.message.id))));
        for (const item of batch) this.completedHandlers.delete(item.message.eventId ?? item.message.id);
      } catch (error) {
        if (batch.every((item) => this.completedHandlers.has(item.message.eventId ?? item.message.id))) {
          // handler已成功（可能已有外部发送），只重试完成状态持久化，不重新执行发送。
          await this.updatePending((current) => current.map((item) => batch.some((done) => (done.message.eventId ?? done.message.id) === (item.message.eventId ?? item.message.id)) ? { ...item, dueAt: this.now() + 2000 } : item));
          for (const item of batch) processed.add(item.message.eventId ?? item.message.id);
          continue;
        }
        const failed = new Set<string>();
        for (const item of batch) {
          if (item.attempts + 1 >= 5) {
            await this.recordQueueFailure(account, item.message, error);
            await this.markMessageProcessed(item.message.eventId ?? item.message.id);
            failed.add(item.message.eventId ?? item.message.id);
          }
        }
        await this.updatePending((current) => current.flatMap((item) => {
          const id = item.message.eventId ?? item.message.id;
          if (failed.has(id)) return [];
          if (!batch.some((entry) => (entry.message.eventId ?? entry.message.id) === id)) return [item];
          const attempts = item.attempts + 1;
          return [{ ...item, attempts, dueAt: this.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)) }];
        }));
      }
      for (const item of batch) processed.add(item.message.eventId ?? item.message.id);
    }
    await this.schedulePendingAlarm();
  }

  private messageScope(message: QQGroupMessage): string {
    return JSON.stringify([message.accountId, message.conversationType ?? 'group', message.groupId]);
  }

  private async allocateReplySequence(targetId: string, messageId: string, expected: number, conversationType: 'group' | 'private'): Promise<number> {
    const legacyKey = JSON.stringify([conversationType, targetId, messageId]);
    const key = await this.messageHash(legacyKey);
    const storageKey = `replySequences:${key.slice(0, 2)}`;
    const sequences = await this.state.storage.get<Record<string, { seq: number; at: number }>>(storageKey) ?? {};
    for (const [id, state] of Object.entries(sequences)) if (this.now() - state.at > 15 * 60_000) delete sequences[id];
    if (!sequences[key] && Object.keys(sequences).length >= 512) throw new Error('QQ reply sequence capacity reached.');
    const legacy = await this.state.storage.get<Record<string, { seq: number; at: number }>>('replySequences');
    const legacySequence = legacy?.[legacyKey];
    const previous = Math.max(sequences[key]?.seq ?? 0, legacySequence && this.now() - legacySequence.at < 15 * 60_000 ? legacySequence.seq : 0);
    const seq = Math.max(previous + 1, expected);
    sequences[key] = { seq, at: this.now() };
    await this.state.storage.put(storageKey, sequences);
    return seq;
  }

  private async reserveOutbound(key: string, count: number, at: number, limit: number): Promise<boolean> {
    const storageKey = `outbound:${key}`;
    const recent = (await this.state.storage.get<number[]>(storageKey) ?? []).filter((stamp) => at - stamp < 60_000);
    if (count < 1 || recent.length + count > limit) return false;
    await this.state.storage.put(storageKey, [...recent, ...Array.from({ length: count }, () => at)]);
    return true;
  }

  private async scheduleWake(account: QQAccountContext, source: QQGroupMessage, seconds: number, reason: string): Promise<void> {
    const eventId = `wake:${crypto.randomUUID()}`;
    const message: QQGroupMessage = {
      ...source, eventId, text: reason.slice(0, 1000), attachments: [], batchMessages: undefined,
      isWake: true, wakeReason: reason.slice(0, 1000), mentionsBot: true, receivedAt: this.now(),
    };
    // 保留原始消息用于上下文；唤醒发送走主动消息，不复用过期的被动msg_id。
    const dueAt = this.now() + Math.max(1, Math.min(86_400, seconds)) * 1000;
    await this.state.storage.put('queueAccountId', account.account.id);
    await this.updatePending((pending) => [...pending, { message, dueAt, attempts: 0 }]);
  }

  private async listWakes(account: QQAccountContext, source: QQGroupMessage): Promise<Array<{ id: string; dueAt: number; reason: string }>> {
    if (source.accountId !== account.account.id) throw new Error('Wake target does not belong to this account.');
    const pending = await this.state.storage.get<PendingMessage[]>('pendingMessages') ?? [];
    return pending.filter((entry) => entry.message.isWake && this.messageScope(entry.message) === this.messageScope(source))
      .map((entry) => ({ id: entry.message.eventId ?? entry.message.id, dueAt: entry.dueAt, reason: entry.message.wakeReason ?? '' }));
  }

  private async cancelWake(account: QQAccountContext, source: QQGroupMessage, id: string): Promise<boolean> {
    if (source.accountId !== account.account.id) throw new Error('Wake target does not belong to this account.');
    let removed = false;
    await this.updatePending((pending) => pending.filter((entry) => {
      const matches = entry.message.isWake && this.messageScope(entry.message) === this.messageScope(source) && (entry.message.eventId ?? entry.message.id) === id;
      removed ||= Boolean(matches);
      return !matches;
    }));
    await this.schedulePendingAlarm();
    return removed;
  }

  private async recordGatewayState(connected: boolean, error?: string): Promise<void> {
    const db = this.env.DB;
    const accountId = this.accountId ?? await this.state.storage.get<string>('accountId');
    if (!db || !accountId) return;
    const at = new Date(this.now()).toISOString();
    const value = JSON.stringify({ accountId, connected, ...(error ? { error: error.slice(0, 500) } : {}), updatedAt: at });
    // 连接状态写入D1仅用于排障，失败不能影响gateway本身。
    try {
      await db.prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind('gateway-state', accountId, value, at).run();
    } catch { /* diagnostics are best effort */ }
  }

  private async recordQueueFailure(account: QQAccountContext, message: QQGroupMessage, error: unknown): Promise<void> {
    if (!readBoolean(this.env.LOG_RECORD)) return;
    const group = (await createRepository(this.env).list('groups')).find((entry) =>
      entry.accountId === account.account.id && matchesConversationId(entry.externalId, message.groupId) &&
      (entry.conversationType ?? 'group') === (message.conversationType ?? 'group'));
    await createConversationLogRepository(this.env).append([{
      id: `queue-failure:${message.eventId ?? message.id}`, accountId: account.account.id,
      pluginId: account.account.pluginId, pluginType: 'elysia-best/plugin-chatbot',
      groupId: group?.id ?? this.messageScope(message), groupExternalId: message.groupId, userId: message.userId,
      direction: 'in', content: 'QQ message processing failed after retries.', status: 'failed',
      eventId: message.eventId ?? message.id, details: { error: error instanceof Error ? error.message : 'Unknown error' },
      createdAt: this.now(), expiresAt: this.now() + 30 * 24 * 60 * 60_000,
    }]);
  }

  private updatePending(update: (pending: PendingMessage[]) => PendingMessage[] | Promise<PendingMessage[]>): Promise<void> {
    const mutation = this.queueMutations.catch(() => undefined).then(async () => {
      const current = await this.state.storage.get<PendingMessage[]>('pendingMessages') ?? [];
      const next = await update(current);
      if (next.length > 500 || new TextEncoder().encode(JSON.stringify(next)).length > 100_000) throw new Error('QQ queue capacity reached.');
      // 短锁只包住持久状态修改，不包住provider网络调用；先设置alarm再落队列。
      if (next.length) await this.setQueueAlarm(Math.min(...next.map((entry) => entry.dueAt)));
      await this.state.storage.put('pendingMessages', next);
    });
    this.queueMutations = mutation;
    return mutation;
  }

  private async schedulePendingAlarm(): Promise<void> {
    const pending = await this.state.storage.get<PendingMessage[]>('pendingMessages') ?? [];
    if (pending.length) await this.setQueueAlarm(Math.max(this.now() + 1, Math.min(...pending.map((entry) => entry.dueAt))));
  }

  private async setQueueAlarm(when: number): Promise<void> {
    const gatewayAt = await this.state.storage.get<number>('gatewayAlarmAt');
    await this.state.storage.setAlarm(Math.max(this.now() + 1, Math.min(when, gatewayAt ?? Infinity)));
  }

  private async setGatewayAlarm(when: number): Promise<void> {
    await this.state.storage.put('gatewayAlarmAt', when);
    const pending = await this.state.storage.get<PendingMessage[]>('pendingMessages') ?? [];
    await this.state.storage.setAlarm(Math.max(this.now() + 1, Math.min(when, ...pending.map((entry) => entry.dueAt))));
  }

  private async readJson<T>(key: string, data?: DurableStorageData): Promise<T | undefined> {
    if (!data && this.state.storage.transaction) return this.state.storage.transaction((transaction) => this.readJson<T>(key, transaction));
    data ??= this.state.storage;
    const root = await data.get<T | ChunkManifest>(key);
    if (!root || typeof root !== 'object' || !('format' in root) || root.format !== 'qq-json-chunks-v1') return root as T | undefined;
    const manifest = root as ChunkManifest;
    if (!Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 128) throw new Error('QQ state chunk manifest is invalid.');
    const parts = await Promise.all(Array.from({ length: manifest.count }, (_, index) => data.get<string>(`${key}:${manifest.version}:${index}`)));
    if (parts.some((part) => typeof part !== 'string')) throw new Error('QQ state chunks are incomplete.');
    return JSON.parse(parts.join('')) as T;
  }

  private async writeJson(key: string, value: unknown, maxBytes: number): Promise<void> {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('QQ persistent state exceeds its byte limit.');
    const parts: string[] = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 20_000);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      parts.push(text.slice(start, end)); start = end;
    }
    const version = crypto.randomUUID();
    const write = async (data: DurableStorageData) => {
      const previous = await data.get<ChunkManifest>(key);
      for (let index = 0; index < parts.length; index++) await data.put(`${key}:${version}:${index}`, parts[index]);
      // root最后切换；真实DO事务使整轮分片及root原子提交，不会暴露半份知识/上下文。
      await data.put(key, { format: 'qq-json-chunks-v1', version, count: parts.length } satisfies ChunkManifest);
      if (this.state.storage.transaction && previous?.format === 'qq-json-chunks-v1') {
        for (let index = 0; index < previous.count; index++) await data.delete(`${key}:${previous.version}:${index}`);
      }
    };
    if (this.state.storage.transaction) await this.state.storage.transaction(write);
    else await write(this.state.storage);
  }

  private async legacyGroupId(scope: string): Promise<string | undefined> {
    let identity: unknown;
    try { identity = JSON.parse(scope); } catch { return undefined; }
    if (!Array.isArray(identity) || identity.length !== 3 || identity[1] !== 'group' || identity.some((part) => typeof part !== 'string')) return undefined;
    const accountId = this.accountId ?? await this.state.storage.get<string>('queueAccountId') ?? await this.state.storage.get<string>('accountId');
    if (identity[0] !== accountId) return undefined;
    const group = (await createRepository(this.env).list('groups')).find((entry) =>
      entry.accountId === accountId && matchesConversationId(entry.externalId, identity[2]) && (entry.conversationType ?? 'group') === 'group');
    return group?.id;
  }

  private async loadContext(scope: string): Promise<ChatMessage[]> {
    const key = `context:${encodeURIComponent(scope)}`;
    const current = await this.readJson<ChatMessage[]>(key);
    if (current !== undefined) return current;
    const legacyId = await this.legacyGroupId(scope);
    if (!legacyId) return [];
    const legacy = await this.readJson<ChatMessage[]>(`context:${encodeURIComponent(legacyId)}`);
    if (!legacy) return [];
    const retained = completeRecentTurns(legacy, MAX_CONTEXT_ENTRIES);
    await this.writeJson(key, retained, 2 * 1024 * 1024);
    return retained;
  }

  private async claimApproval(scopeKey: string, approvalId: string): Promise<boolean> {
    const key = `approvalClaim:${await this.messageHash(JSON.stringify([scopeKey, approvalId]))}`;
    const claim = async (data: DurableStorageData): Promise<boolean> => {
      if (await data.get<boolean>(key)) return false;
      await data.put(key, true);
      return true;
    };
    const operation = this.approvalClaims.catch(() => undefined).then(() =>
      this.state.storage.transaction ? this.state.storage.transaction(claim) : claim(this.state.storage));
    this.approvalClaims = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private conversationStore(): GroupConversationStore & { approvalAuthority: 'serialized' } {
    return {
      approvalAuthority: 'serialized',
      getRecent: async (groupId, limit) => completeRecentTurns(await this.loadContext(groupId), limit),
      append: async (groupId, entries) => {
        const current = await this.loadContext(groupId);
        await this.writeJson(`context:${encodeURIComponent(groupId)}`, completeRecentTurns([...current, ...entries], MAX_CONTEXT_ENTRIES), 2 * 1024 * 1024);
      },
      replace: async (groupId, entries) => this.writeJson(`context:${encodeURIComponent(groupId)}`, completeRecentTurns(entries, MAX_CONTEXT_ENTRIES), 2 * 1024 * 1024),
      clear: async (groupId) => this.writeJson(`context:${encodeURIComponent(groupId)}`, [], 2 * 1024 * 1024),
      getState: async (groupId) => await this.readJson<JsonObject>(`chatState:${encodeURIComponent(groupId)}`) ?? {},
      setState: async (groupId, value) => this.writeJson(`chatState:${encodeURIComponent(groupId)}`, value, 1024 * 1024),
      claimApproval: (scopeKey, approvalId) => this.claimApproval(scopeKey, approvalId),
    };
  }

  private costStore(): GroupCostStore {
    return {
      consistency: 'durable-object',
      isWithinLimits: async (group, at) => {
        const state = await this.state.storage.get<{
          dayKey: string;
          dailySpend: number;
          monthKey: string;
          monthlySpend: number;
          totalSpend: number;
        }>(this.costKey(group.id));
        const iso = new Date(at).toISOString();
        const dailySpend = state?.dayKey === iso.slice(0, 10) ? state.dailySpend : 0;
        const monthlySpend = state?.monthKey === iso.slice(0, 7) ? state.monthlySpend : 0;
        const totalSpend = state?.totalSpend ?? 0;
        return !(
          (group.dailyCostLimit > 0 && dailySpend >= group.dailyCostLimit) ||
          (group.monthlyCostLimit > 0 && monthlySpend >= group.monthlyCostLimit) ||
          (group.totalCostLimit > 0 && totalSpend >= group.totalCostLimit)
        );
      },
      add: async (group, amount, at) => {
        const key = this.costKey(group.id);
        const previous = await this.state.storage.get<{
          dayKey: string;
          dailySpend: number;
          monthKey: string;
          monthlySpend: number;
          totalSpend: number;
        }>(key);
        const iso = new Date(at).toISOString();
        const dayKey = iso.slice(0, 10);
        const monthKey = iso.slice(0, 7);
        await this.state.storage.put(key, {
          dayKey,
          dailySpend: (previous?.dayKey === dayKey ? previous.dailySpend : 0) + amount,
          monthKey,
          monthlySpend: (previous?.monthKey === monthKey ? previous.monthlySpend : 0) + amount,
          totalSpend: (previous?.totalSpend ?? 0) + amount,
        });
      },
    };
  }

  private costKey(groupId: string): string {
    return `cost:${encodeURIComponent(groupId)}`;
  }

  private async messageHash(messageId: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageId)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private async wasEventProcessed(message: QQGroupMessage): Promise<boolean> {
    return await this.wasMessageProcessed(message.eventId ?? message.id) || (!message.isWake && await this.wasMessageProcessed(message.id));
  }

  private async wasMessageProcessed(messageId: string): Promise<boolean> {
    const legacy = await this.state.storage.get<string[]>('recentMessageIds') ?? [];
    if (legacy.includes(messageId)) return true;
    const hash = await this.messageHash(messageId);
    const entries = await this.state.storage.get<Array<{ id: string; at: number }>>(`processedMessages:${hash.slice(0, 2)}`) ?? [];
    return entries.some((entry) => entry.id === hash && this.now() - entry.at < DEDUPE_RETENTION_MS);
  }

  private async markMessageProcessed(messageId: string): Promise<void> {
    const hash = await this.messageHash(messageId);
    const key = `processedMessages:${hash.slice(0, 2)}`;
    const entries = (await this.state.storage.get<Array<{ id: string; at: number }>>(key) ?? [])
      .filter((entry) => this.now() - entry.at < DEDUPE_RETENTION_MS);
    if (entries.some((entry) => entry.id === hash)) return;
    if (entries.length >= MAX_RECENT_MESSAGE_IDS) throw new Error('QQ deduplication capacity reached.');
    await this.state.storage.put(key, [...entries, { id: hash, at: this.now() }]);
  }

  private sendHeartbeat(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.awaitingHeartbeatAck) {
      this.socket.close(4000, 'heartbeat ack timeout');
      return;
    }
    this.awaitingHeartbeatAck = true;
    try {
      this.sendPacket({ op: 1, d: this.lastSequence ?? null });
    } catch {
      this.socket.close();
    }
  }

  private lastSequence?: number;

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.awaitingHeartbeatAck = false;
  }

  private sendPacket(packet: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('QQ gateway socket is not open.');
    this.socket.send(JSON.stringify(packet));
  }

  private async closeSocket(): Promise<void> {
    this.clearHeartbeat();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'reconnecting');
  }

  private async disconnect(): Promise<void> {
    this.accountId = undefined;
    await this.closeSocket();
    await this.state.storage.delete('accountId');
    await this.state.storage.delete('gatewayAlarmAt');
    await this.state.storage.deleteAlarm();
    await this.schedulePendingAlarm();
  }

  private async scheduleReconnect(): Promise<void> {
    if (!this.accountId) this.accountId = await this.state.storage.get<string>('accountId');
    if (!this.accountId) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt += 1;
    await this.setGatewayAlarm(this.now() + delay);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQQGatewayHost(hostname: string): boolean {
  return ['api.bot.qq.com', 'api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com'].includes(hostname);
}
