import type { GroupRecord, RuntimeBindings } from '../../shared/types';
import { createStoredChatbotHandler, type GroupConversationStore, type GroupCostStore } from '../../server/plugins/chatbot/runtime';
import { createRepository } from '../../server/storage/repository';
import { getQQAccessToken, replyToQQGroup } from '../../server/protocols/qq/api';
import { resolveQQAccountById } from '../../server/protocols/qq/accounts';
import { normalizeQQGroupMessage } from '../../server/protocols/qq/message';
import type { QQAccountContext, QQGroupMessage } from '../../server/protocols/qq/types';

const GATEWAY_ENDPOINT = 'https://api.bot.qq.com/gateway/bot';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const MAX_CONTEXT_ENTRIES = 40;
const MAX_RECENT_MESSAGE_IDS = 2_000;
const GROUP_AND_C2C_INTENT = 1 << 25;

interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
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

interface GroupContextMessage {
  role: 'user' | 'assistant';
  content: string;
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
      } catch {
        await this.scheduleReconnect();
        return Response.json({ starting: false, retryScheduled: true }, { status: 202 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json({ connected: this.socket?.readyState === WebSocket.OPEN });
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    if ((this.env.API_METHOD ?? 'webhook') !== 'websocket') {
      await this.disconnect();
      return;
    }
    const accountId = await this.state.storage.get<string>('accountId');
    if (!accountId) return;
    try {
      await this.connectAccount(accountId);
    } catch {
      await this.scheduleReconnect();
    }
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
      await this.state.storage.setAlarm(this.now() + MAINTENANCE_INTERVAL_MS);
      return;
    }

    const accessToken = await this.getAccessToken(account);
    const gatewayResponse = await this.fetchImpl(GATEWAY_ENDPOINT, {
      headers: { authorization: `QQBot ${accessToken}` },
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
      if (event.code === 4914 || event.code === 4915) {
        this.state.waitUntil(this.disconnect());
        return;
      }
      this.state.waitUntil(this.scheduleReconnect());
    });
    socket.addEventListener('error', () => socket.close());
    await this.state.storage.setAlarm(this.now() + MAINTENANCE_INTERVAL_MS);
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
    } else if (packet.t === 'RESUMED') {
      this.reconnectAttempt = 0;
      this.startHeartbeat();
    } else if (packet.t === 'GROUP_AT_MESSAGE_CREATE' || packet.t === 'GROUP_MESSAGE_CREATE') {
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
    } else {
      const handler = createStoredChatbotHandler(this.env, {
        conversationStore: this.conversationStore(),
        costStore: this.costStore(),
        sendReply: (bot, groupOpenId, messageId, content) =>
          replyToQQGroup(bot, groupOpenId, messageId, content, this.fetchImpl),
        fetch: this.fetchImpl,
        now: this.now,
      });
      await handler(account, message);
    }
    await this.markMessageProcessed(message.id);
  }

  private conversationStore(): GroupConversationStore {
    return {
      getRecent: async (groupId, limit) => {
        const entries = await this.state.storage.get<GroupContextMessage[]>(`context:${encodeURIComponent(groupId)}`) ?? [];
        return entries.slice(-limit);
      },
      append: async (groupId, entries) => {
        const key = `context:${encodeURIComponent(groupId)}`;
        const current = await this.state.storage.get<GroupContextMessage[]>(key) ?? [];
        await this.state.storage.put(key, [...current, ...entries].slice(-MAX_CONTEXT_ENTRIES));
      },
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

  private async wasMessageProcessed(messageId: string): Promise<boolean> {
    const ids = await this.state.storage.get<string[]>('recentMessageIds') ?? [];
    return ids.includes(messageId);
  }

  private async markMessageProcessed(messageId: string): Promise<void> {
    const ids = await this.state.storage.get<string[]>('recentMessageIds') ?? [];
    if (ids.includes(messageId)) return;
    await this.state.storage.put('recentMessageIds', [...ids, messageId].slice(-MAX_RECENT_MESSAGE_IDS));
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
    await this.state.storage.deleteAlarm();
  }

  private async scheduleReconnect(): Promise<void> {
    if (!this.accountId) this.accountId = await this.state.storage.get<string>('accountId');
    if (!this.accountId) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt += 1;
    await this.state.storage.setAlarm(this.now() + delay);
  }
}

function isQQGatewayHost(hostname: string): boolean {
  return ['api.bot.qq.com', 'api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com'].includes(hostname);
}
