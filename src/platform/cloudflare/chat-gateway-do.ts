import type { RuntimeBindings } from '../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../../server/protocols/types';
import { resolveChatAccountById } from '../../server/protocols/accounts';
import { createPersistentChatbotStores, createStoredChatbotHandler } from '../../server/plugins/chatbot/runtime';
import { sendChatMedia, sendChatText } from '../../server/protocols/sender';
import { createRepository } from '../../server/storage/repository';
import { normalizeDiscordMessage, type DiscordGatewayPacket } from '../../server/protocols/discord/message';
import { normalizeSatoriEvent, type SatoriEvent, type SatoriSignal } from '../../server/protocols/satori/message';
import { satoriEventsUrl } from '../../server/protocols/satori/api';

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const DISCORD_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const DEDUPE_RETENTION_MS = 10 * 60_000;
const MAX_RECENT_EVENTS = 400;
const SATORI_HEARTBEAT_MS = 10_000;

const GATEWAY_PROTOCOLS = new Set(['discord', 'satori']);

interface DurableStorageData {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectStorageLike extends DurableStorageData {
  setAlarm(when: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
}

interface GatewayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface DiscordSession {
  sessionId: string;
  resumeUrl: string;
}

interface RecentEvent {
  id: string;
  at: number;
}

let lastSessionSyncAt = 0;

/** Starts gateway sessions for accounts whose protocol needs a long-lived connection. */
export async function ensureChatGatewaySessions(bindings: RuntimeBindings): Promise<void> {
  if (bindings.PLATFORM !== 'cloudflare') return;
  const namespace = bindings.CHAT_GATEWAY_SESSIONS as GatewayNamespace | undefined;
  if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') return;
  if (Date.now() - lastSessionSyncAt < 60_000) return;
  lastSessionSyncAt = Date.now();

  const accounts = await createRepository(bindings).list('accounts');
  await Promise.all(accounts
    .filter((account) => GATEWAY_PROTOCOLS.has(String(account.protocol)))
    .map(async (account) => {
      const stub = namespace.get(namespace.idFromName(account.id));
      const response = await stub.fetch(new Request('https://chat-gateway.internal/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: account.id }),
      }));
      if (!response.ok) throw new Error('Unable to start the chat gateway session.');
    }));
}

export class ChatGatewayDurableObject {
  private socket?: WebSocket;
  private accountId?: string;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatInterval = 41_250;
  private awaitingHeartbeatAck = false;
  private reconnectAttempt = 0;
  private lastSequence = 0;
  private messageQueue: Promise<void> = Promise.resolve();
  private dedupeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: RuntimeBindings,
  ) {
    this.env = { ...env, PLATFORM: env.PLATFORM ?? 'cloudflare' };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json({ connected: this.socket?.readyState === WebSocket.OPEN });
    }
    if (request.method === 'POST' && url.pathname === '/disconnect') {
      await this.disconnect();
      return Response.json({ connected: false });
    }
    if (request.method === 'POST' && url.pathname === '/connect') {
      let body: { accountId?: unknown };
      try {
        body = await request.json() as { accountId?: unknown };
      } catch {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      if (typeof body.accountId !== 'string' || !body.accountId) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      this.accountId = body.accountId;
      await this.state.storage.put('accountId', body.accountId);
      try {
        await this.connectAccount(body.accountId);
        return Response.json({ starting: true }, { status: 202 });
      } catch (error) {
        console.error('Chat gateway connect failed.', errorMessage(error));
        await this.scheduleReconnect();
        return Response.json({ starting: false, retryScheduled: true }, { status: 202 });
      }
    }
    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const accountId = this.accountId ?? await this.state.storage.get<string>('accountId');
    if (!accountId) return;
    try {
      await this.connectAccount(accountId);
    } catch (error) {
      console.error('Chat gateway alarm failed.', errorMessage(error));
      await this.scheduleReconnect();
    }
  }

  private async connectAccount(accountId: string): Promise<void> {
    const account = await resolveChatAccountById(accountId, this.env);
    if (!account || !account.account.enabled || !account.pluginEnabled || !GATEWAY_PROTOCOLS.has(account.protocol)) {
      await this.disconnect();
      return;
    }

    const version = `${account.protocol}:${account.appId}:${account.account.updatedAt}`;
    if (await this.state.storage.get<string>('accountVersion') !== version) {
      await this.closeSocket();
      await this.state.storage.delete('discordSession');
      await this.state.storage.delete('sequence');
      await this.state.storage.delete('satoriSn');
      await this.state.storage.put('accountVersion', version);
    }

    this.accountId = accountId;
    await this.state.storage.put('accountId', accountId);
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      await this.scheduleMaintenance();
      return;
    }
    if (account.protocol === 'discord') await this.connectDiscord(account);
    else await this.connectSatori(account);
  }

  private async connectDiscord(account: ChatAccountContext): Promise<void> {
    const session = await this.state.storage.get<DiscordSession>('discordSession');
    this.lastSequence = await this.state.storage.get<number>('sequence') ?? 0;
    const base = session?.resumeUrl || DISCORD_GATEWAY_URL;
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new Error('Discord gateway URL is invalid.');
    }
    if (url.protocol !== 'wss:' || !(url.hostname === 'discord.gg' || url.hostname.endsWith('.discord.gg'))) {
      throw new Error('Discord gateway URL is invalid.');
    }
    url.searchParams.set('v', '10');
    url.searchParams.set('encoding', 'json');

    const socket = new WebSocket(url.toString());
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleDiscordFrame(account, event.data))
        .catch(async (error) => {
          console.error('Discord gateway frame failed.', errorMessage(error));
          await this.closeSocket();
          await this.scheduleReconnect();
        });
      this.state.waitUntil(this.messageQueue);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.clearHeartbeat();
      this.socket = undefined;
      if (event.code === 4004 || event.code === 4010 || event.code === 4011 || event.code === 4012 || event.code === 4013 || event.code === 4014) {
        // Authentication or intent failures will not recover by reconnecting.
        this.state.waitUntil(this.disconnect());
        return;
      }
      this.state.waitUntil(this.scheduleReconnect());
    });
    socket.addEventListener('error', () => socket.close());
    await this.scheduleMaintenance();
  }

  private async handleDiscordFrame(account: ChatAccountContext, data: string | ArrayBuffer | Blob): Promise<void> {
    const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
    const packet = JSON.parse(text) as DiscordGatewayPacket;
    if (!Number.isInteger(packet.op)) return;

    if (packet.op === 10) {
      const hello = packet.d as { heartbeat_interval?: unknown } | null;
      if (!hello || typeof hello.heartbeat_interval !== 'number' || !Number.isFinite(hello.heartbeat_interval)) {
        throw new Error('Discord gateway HELLO is invalid.');
      }
      this.heartbeatInterval = Math.max(1_000, Math.min(120_000, hello.heartbeat_interval));
      await this.sendDiscordIdentifyOrResume(account);
      this.startHeartbeat();
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
    if (packet.op === 7) {
      await this.closeSocket();
      await this.scheduleReconnect();
      return;
    }
    if (packet.op === 9) {
      if (packet.d !== true) {
        await this.state.storage.delete('discordSession');
        await this.state.storage.delete('sequence');
        this.lastSequence = 0;
      }
      await this.closeSocket();
      await this.scheduleReconnect();
      return;
    }
    if (packet.op !== 0) return;

    const sequence = Number.isSafeInteger(packet.s) ? packet.s as number : null;
    if (sequence !== null) {
      this.lastSequence = sequence;
      await this.state.storage.put('sequence', sequence);
    }
    if (packet.t === 'READY') {
      const ready = packet.d as { session_id?: unknown; resume_gateway_url?: unknown } | null;
      if (typeof ready?.session_id === 'string') {
        const resumeUrl = typeof ready.resume_gateway_url === 'string' ? ready.resume_gateway_url : DISCORD_GATEWAY_URL;
        await this.state.storage.put('discordSession', { sessionId: ready.session_id, resumeUrl } satisfies DiscordSession);
      }
      this.reconnectAttempt = 0;
      this.clearHeartbeat();
      this.startHeartbeat();
      await this.scheduleMaintenance();
      return;
    }
    if (packet.t === 'RESUMED') {
      this.reconnectAttempt = 0;
      this.clearHeartbeat();
      this.startHeartbeat();
      await this.scheduleMaintenance();
      return;
    }
    if (packet.t === 'MESSAGE_CREATE') {
      const message = normalizeDiscordMessage(packet.d, account, account.appId, Date.now());
      if (message) await this.handleMessage(account, message);
    }
  }

  private async sendDiscordIdentifyOrResume(account: ChatAccountContext): Promise<void> {
    const session = await this.state.storage.get<DiscordSession>('discordSession');
    if (session?.sessionId && this.lastSequence > 0) {
      this.sendPacket({ op: 6, d: { token: credential(account, 'botToken'), session_id: session.sessionId, seq: this.lastSequence } });
      return;
    }
    this.sendPacket({
      op: 2,
      d: {
        token: credential(account, 'botToken'),
        intents: DISCORD_INTENTS,
        properties: { os: 'cloudflare', browser: 'nonebotmaker', device: 'nonebotmaker' },
      },
    });
  }

  private async connectSatori(account: ChatAccountContext): Promise<void> {
    this.lastSequence = await this.state.storage.get<number>('satoriSn') ?? 0;
    const url = satoriEventsUrl(account);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      const token = credential(account, 'token');
      this.sendPacket({ op: 3, body: { ...(token ? { token } : {}), ...(this.lastSequence ? { sn: this.lastSequence } : {}) } });
      this.startHeartbeat();
    });
    socket.addEventListener('message', (event) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleSatoriFrame(account, event.data))
        .catch(async (error) => {
          console.error('Satori gateway frame failed.', errorMessage(error));
          await this.closeSocket();
          await this.scheduleReconnect();
        });
      this.state.waitUntil(this.messageQueue);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.clearHeartbeat();
      this.socket = undefined;
      this.state.waitUntil(this.scheduleReconnect());
    });
    socket.addEventListener('error', () => socket.close());
    this.startHeartbeat(SATORI_HEARTBEAT_MS);
    await this.scheduleMaintenance();
  }

  private async handleSatoriFrame(account: ChatAccountContext, data: string | ArrayBuffer | Blob): Promise<void> {
    const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
    const signal = JSON.parse(text) as SatoriSignal;
    if (signal.op === 4) {
      this.reconnectAttempt = 0;
      await this.scheduleMaintenance();
      return;
    }
    if (signal.op !== 0) return;
    const sn = typeof signal.sn === 'number' && Number.isFinite(signal.sn) ? signal.sn : undefined;
    if (sn !== undefined) {
      this.lastSequence = sn;
      await this.state.storage.put('satoriSn', sn);
    }
    const message = normalizeSatoriEvent((signal.body ?? {}) as SatoriEvent, account, Date.now());
    if (message) await this.handleMessage(account, message);
  }

  private async handleMessage(account: ChatAccountContext, message: ChatPlatformMessage): Promise<void> {
    if (await this.wasProcessed(message.eventId ?? message.id)) return;
    const handler = createStoredChatbotHandler(this.env, {
      ...createPersistentChatbotStores(this.env),
      sendReply: sendChatText,
      sendMedia: sendChatMedia,
    });
    await handler(account, message);
    await this.markProcessed(message.eventId ?? message.id);
  }

  private wasProcessed(id: string): Promise<boolean> {
    const operation = this.dedupeQueue.catch(() => undefined).then(async () => {
      const events = await this.recentEvents();
      return events.some((entry) => entry.id === id);
    });
    this.dedupeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private markProcessed(id: string): Promise<void> {
    const operation = this.dedupeQueue.catch(() => undefined).then(async () => {
      const events = await this.recentEvents();
      if (events.some((entry) => entry.id === id)) return;
      if (events.length >= MAX_RECENT_EVENTS) events.shift();
      events.push({ id, at: Date.now() });
      await this.state.storage.put('recentEvents', events);
    });
    this.dedupeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async recentEvents(): Promise<RecentEvent[]> {
    const now = Date.now();
    const events = await this.state.storage.get<RecentEvent[]>('recentEvents') ?? [];
    return events.filter((entry) => now - entry.at < DEDUPE_RETENTION_MS);
  }

  private sendHeartbeat(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.heartbeatInterval <= SATORI_HEARTBEAT_MS) {
      this.sendPacket({ op: 1 });
      return;
    }
    if (this.awaitingHeartbeatAck) {
      this.socket.close(4000, 'heartbeat ack timeout');
      return;
    }
    this.awaitingHeartbeatAck = true;
    try {
      this.sendPacket({ op: 1, d: this.lastSequence || null });
    } catch {
      this.socket.close();
    }
  }

  private startHeartbeat(interval = this.heartbeatInterval): void {
    this.clearHeartbeat();
    this.heartbeatInterval = interval;
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.awaitingHeartbeatAck = false;
  }

  private sendPacket(packet: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Gateway socket is not open.');
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

  private async scheduleMaintenance(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + MAINTENANCE_INTERVAL_MS);
  }

  private async scheduleReconnect(): Promise<void> {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt += 1;
    await this.state.storage.setAlarm(Date.now() + delay);
  }
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
