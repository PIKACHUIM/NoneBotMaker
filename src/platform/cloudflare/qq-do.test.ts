import { describe, expect, it, vi } from 'vitest';
import type { BotAccountRecord, RuntimeBindings } from '../../shared/types';
import type { QQAccountContext } from '../../server/protocols/qq/types';
import { replyToQQGroup } from '../../server/protocols/qq/api';
import { ensureQQGatewaySessions, QQGatewayDurableObject } from './qq-do';

function state(seed: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(seed));
  const waits: Promise<unknown>[] = [];
  return {
    storage: {
      get: vi.fn(async <T = unknown>(key: string) => values.get(key) as T | undefined),
      put: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
      delete: vi.fn(async (key: string) => values.delete(key)),
      setAlarm: vi.fn(async (_when: number | Date) => undefined),
      deleteAlarm: vi.fn(async () => undefined),
    },
    waitUntil: vi.fn((promise: Promise<unknown>) => { waits.push(promise); }),
    values,
    waits,
  };
}

class TestWebSocket {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push((event) => {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    });
    this.listeners.set(type, callbacks);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', { code } as CloseEvent);
  }

  sendFrame(packet: unknown): void {
    this.emit('message', { data: JSON.stringify(packet) } as MessageEvent);
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function drain(stateHandle: ReturnType<typeof state>): Promise<void> {
  while (stateHandle.waits.length > 0) {
    await Promise.all(stateHandle.waits.splice(0));
  }
}

function account(appId: string): QQAccountContext {
  return {
    appId,
    botSecret: 'bot-secret',
    clientSecret: 'client-secret',
    pluginEnabled: true,
    account: {
      id: `account-${appId}`,
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
}

function gatewayDependencies(bot: QQAccountContext) {
  const sockets: TestWebSocket[] = [];
  const handledMessages: unknown[] = [];
  const replies: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/gateway/bot')) return Response.json({ url: 'wss://api.bot.qq.com/gateway' });
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'reply-token', expires_in: '7200' });
    if (url.includes('/v2/groups/')) {
      replies.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ err_code: 0 });
    }
    return new Response(null, { status: 404 });
  });

  return {
    sockets,
    handledMessages,
    replies,
    options: {
      fetch: fetch as typeof globalThis.fetch,
      createWebSocket: (url: string) => {
        const socket = new TestWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      resolveAccount: async () => bot,
      getAccessToken: async () => 'gateway-token',
      handleMessage: async (resolvedAccount: QQAccountContext, message: { id: string; groupId: string }) => {
        handledMessages.push({ accountId: resolvedAccount.account.id, message });
        await replyToQQGroup(resolvedAccount, message.groupId, message.id, 'gateway reply', fetch as typeof globalThis.fetch);
      },
      now: () => Date.parse('2026-07-02T12:00:00.000Z'),
    },
  };
}

describe('Cloudflare QQ gateway Durable Object', () => {
  it('does nothing in the default webhook mode', async () => {
    await expect(ensureQQGatewaySessions({})).resolves.toBeUndefined();
  });

  it('disconnects configured sessions when switching from websocket to webhook', async () => {
    const accountRecord = {
      id: 'switch-account',
      protocol: 'qq',
      createdAt: '',
      updatedAt: '',
    };
    const statement = {
      bind: vi.fn(),
      all: vi.fn(async () => ({ results: [{ value: JSON.stringify(accountRecord) }] })),
    };
    statement.bind.mockImplementation(() => statement);
    const db = { prepare: vi.fn(() => statement) };
    const paths: string[] = [];
    const namespace = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({
        fetch: vi.fn(async (request: Request) => {
          paths.push(new URL(request.url).pathname);
          return Response.json({ connected: false });
        }),
      })),
    };
    const common = { PLATFORM: 'cloudflare', DB: db, QQ_GATEWAY_SESSIONS: namespace } as unknown as RuntimeBindings;

    await ensureQQGatewaySessions({ ...common, API_METHOD: 'websocket' });
    await ensureQQGatewaySessions({ ...common, API_METHOD: 'webhook' });
    await ensureQQGatewaySessions({ ...common, API_METHOD: 'webhook' });

    expect(paths).toEqual(['/connect', '/disconnect']);
  });

  it('rejects websocket mode outside Cloudflare', async () => {
    await expect(
      ensureQQGatewaySessions({ API_METHOD: 'websocket', PLATFORM: 'edgeone' }),
    ).rejects.toThrow('only supported on Cloudflare');
  });

  it('requires the configured Durable Object binding in Cloudflare websocket mode', async () => {
    await expect(
      ensureQQGatewaySessions({ API_METHOD: 'websocket', PLATFORM: 'cloudflare' }),
    ).rejects.toThrow('QQ_GATEWAY_SESSIONS Durable Object binding is not configured');
  });

  it('does not allow a non-Cloudflare runtime to open a gateway session', async () => {
    const durableObject = new QQGatewayDurableObject(state() as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], { PLATFORM: 'esa' } as RuntimeBindings);
    const response = await durableObject.fetch(new Request('https://qq-gateway.internal/connect', { method: 'POST' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'websocket_unsupported' });
  });

  it('disconnects rather than reconnecting from an alarm in webhook mode', async () => {
    const storage = state({ accountId: 'old-account' });
    const durableObject = new QQGatewayDurableObject(
      storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0],
      { API_METHOD: 'webhook', PLATFORM: 'cloudflare' },
    );

    await durableObject.alarm();

    expect(storage.values.has('accountId')).toBe(false);
    expect(storage.storage.deleteAlarm).toHaveBeenCalledOnce();
  });

  it('identifies, handles/replies to a group message, and resumes after an alarm restart', async () => {
    const bot = account(`gateway-test-${crypto.randomUUID()}`);
    const storage = state();
    const dependencies = gatewayDependencies(bot);
    const bindings: RuntimeBindings = { API_METHOD: 'websocket', PLATFORM: 'cloudflare' };
    const durableObject = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, dependencies.options);
    const connected = await durableObject.fetch(new Request('https://qq-gateway.internal/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: bot.account.id }),
    }));

    expect(connected.status).toBe(202);
    expect(dependencies.sockets).toHaveLength(1);
    const firstSocket = dependencies.sockets[0];
    expect(firstSocket.url).toBe('wss://api.bot.qq.com/gateway');

    firstSocket.sendFrame({ op: 10, d: { heartbeat_interval: 45_000 } });
    await drain(storage);
    expect(JSON.parse(firstSocket.sent[0] ?? '{}')).toMatchObject({
      op: 2,
      d: { token: 'QQBot gateway-token', intents: 1 << 25, shard: [0, 1] },
    });

    firstSocket.sendFrame({ op: 0, s: 10, t: 'READY', d: { session_id: 'session-1' } });
    await drain(storage);
    firstSocket.sendFrame({
      op: 0,
      s: 11,
      t: 'GROUP_AT_MESSAGE_CREATE',
      id: 'event-1',
      d: {
        id: 'message-1',
        group_openid: 'group-1',
        author: { member_openid: 'user-1' },
        content: `<@${bot.appId}> hello`,
      },
    });
    await drain(storage);

    expect(dependencies.handledMessages).toEqual([{
      accountId: bot.account.id,
      message: expect.objectContaining({
        id: 'message-1',
        groupId: 'group-1',
        userId: 'user-1',
        text: 'hello',
        mentionsBot: true,
      }),
    }]);
    expect(dependencies.replies).toEqual([{
      url: 'https://api.bot.qq.com/v2/groups/group-1/messages',
      body: { msg_type: 0, content: 'gateway reply', msg_id: 'message-1', msg_seq: 1 },
    }]);
    expect(storage.values.get('session')).toEqual({ sessionId: 'session-1', sequence: 11 });

    firstSocket.close(1006);
    await drain(storage);
    const restartedObject = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, dependencies.options);
    await restartedObject.alarm();
    expect(dependencies.sockets).toHaveLength(2);
    const resumedSocket = dependencies.sockets[1];
    resumedSocket.sendFrame({ op: 10, d: { heartbeat_interval: 45_000 } });
    await drain(storage);
    expect(JSON.parse(resumedSocket.sent[0] ?? '{}')).toEqual({
      op: 6,
      d: { token: 'QQBot gateway-token', session_id: 'session-1', seq: 11 },
    });

    await restartedObject.fetch(new Request('https://qq-gateway.internal/disconnect', { method: 'POST' }));
  });
});
