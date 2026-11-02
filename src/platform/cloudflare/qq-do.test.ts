import { describe, expect, it, vi } from 'vitest';
import type { BotAccountRecord, RuntimeBindings } from '../../shared/types';
import type { QQAccountContext, QQGroupMessage } from '../../server/protocols/qq/types';
import { replyToQQGroup } from '../../server/protocols/qq/api';
import type { ChatMessage } from '../../shared/types';
import type { GroupConversationStore } from '../../server/plugins/chatbot/runtime';
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

function boundedTransactionalState(seed: Record<string, unknown> = {}) {
  const handle = state(seed);
  const save = handle.storage.put.getMockImplementation()!;
  handle.storage.put.mockImplementation(async (key, value) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 128 * 1024) throw new Error('DO value exceeds 128KB.');
    await save(key, value);
  });
  type Storage = ConstructorParameters<typeof QQGatewayDurableObject>[0]['storage'];
  const transaction = async <T,>(callback: (data: Storage) => Promise<T>): Promise<T> => {
    const snapshot = new Map(handle.values);
    try { return await callback(handle.storage as unknown as Storage); }
    catch (error) { handle.values.clear(); for (const [key, value] of snapshot) handle.values.set(key, value); throw error; }
  };
  Object.assign(handle.storage, { transaction });
  return handle;
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

describe('durable QQ webhook queue', () => {
  const bindings: RuntimeBindings = { PLATFORM: 'cloudflare', API_METHOD: 'webhook' };
  function message(bot: QQAccountContext, id: string, type: 'group' | 'private' = 'group'): QQGroupMessage {
    return { id, eventId: `event-${id}`, accountId: bot.account.id, botId: bot.appId, groupId: 'same-openid', userId: 'user', text: id, mentionsBot: true, receivedAt: 1000, conversationType: type, eventType: type === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE' };
  }
  function enqueue(object: QQGatewayDurableObject, bot: QQAccountContext, event: QQGroupMessage) {
    return object.fetch(new Request('https://qq-gateway.internal/enqueue', { method: 'POST', body: JSON.stringify({ accountId: bot.account.id, message: event }) }));
  }

  it('lists and cancels only scheduled wakes for the selected account and conversation', async () => {
    const bot = account('wake-control');
    const storage = state();
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { resolveAccount: async () => bot, now: () => 1000 });
    const control = object as unknown as { scheduleWake(bot: QQAccountContext, source: QQGroupMessage, seconds: number, reason: string): Promise<void>; listWakes(bot: QQAccountContext, source: QQGroupMessage): Promise<Array<{ id: string; reason: string }>>; cancelWake(bot: QQAccountContext, source: QQGroupMessage, id: string): Promise<boolean> };
    const source = message(bot, 'source');
    await control.scheduleWake(bot, source, 10, 'group reminder');
    await control.scheduleWake(bot, message(bot, 'private', 'private'), 10, 'private reminder');
    const groupWakes = await control.listWakes(bot, source);
    expect(groupWakes).toHaveLength(1);
    expect(groupWakes[0].reason).toBe('group reminder');
    expect(await control.cancelWake(bot, message(bot, 'private', 'private'), groupWakes[0].id)).toBe(false);
    expect(await control.cancelWake(bot, source, groupWakes[0].id)).toBe(true);
    expect(await control.listWakes(bot, source)).toEqual([]);
    expect(await control.listWakes(bot, message(bot, 'private', 'private'))).toHaveLength(1);
  });

  it('ACKs after durable enqueue, survives restart, batches by scope and deduplicates retries', async () => {
    let now = 1000;
    const bot = account('queue');
    const storage = state();
    const handleMessage = vi.fn(async (_bot: QQAccountContext, _message: QQGroupMessage) => undefined);
    const options = { resolveAccount: async () => bot, handleMessage, now: () => now };
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options);
    for (const [id, type] of [['a', 'group'], ['b', 'group'], ['c', 'private']] as const) {
      expect((await enqueue(object, bot, message(bot, id, type))).status).toBe(202);
    }
    await enqueue(object, bot, message(bot, 'a'));
    expect((storage.values.get('pendingMessages') as unknown[])).toHaveLength(3);
    expect(handleMessage).not.toHaveBeenCalled();
    now = 2100;
    const restarted = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options);
    await restarted.alarm();
    expect(handleMessage).toHaveBeenCalledTimes(2);
    expect(handleMessage.mock.calls[0]?.[1]).toMatchObject({ text: 'a\nb', batchMessages: [{ id: 'a' }, { id: 'b' }] });
    expect(handleMessage.mock.calls[1]?.[1]).toMatchObject({ conversationType: 'private', id: 'c' });
    expect(storage.values.get('pendingMessages')).toEqual([]);
    await enqueue(restarted, bot, message(bot, 'a'));
    expect(storage.values.get('pendingMessages')).toEqual([]);
  });

  it('persists failed work for alarm retry instead of losing a successful ACK', async () => {
    let now = 1000;
    const bot = account('retry');
    const storage = state();
    const handleMessage = vi.fn(async (): Promise<void> => { throw new Error('temporary failure'); });
    const options = { resolveAccount: async () => bot, handleMessage, now: () => now };
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options);
    await enqueue(object, bot, message(bot, 'retry'));
    now = 2100;
    await object.alarm();
    expect(storage.values.get('pendingMessages')).toMatchObject([{ attempts: 1 }]);
    handleMessage.mockImplementation(async () => undefined);
    now = 5000;
    await new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options).alarm();
    expect(storage.values.get('pendingMessages')).toEqual([]);
    expect(handleMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps enqueue fast while a provider is processing another persisted message', async () => {
    let now = 1000;
    const bot = account('fast-ack');
    const storage = state();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const provider = new Promise<void>((resolve) => { release = resolve; });
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { resolveAccount: async () => bot, now: () => now, handleMessage: async () => { started(); await provider; } });
    await enqueue(object, bot, message(bot, 'first'));
    now = 2100;
    const processing = object.alarm();
    await entered;
    expect((await enqueue(object, bot, message(bot, 'second'))).status).toBe(202);
    release();
    await processing;
    expect(storage.values.get('pendingMessages')).toMatchObject([{ message: { id: 'second' } }]);
  });

  it('does not batch private conversations with the group window', async () => {
    const bot = { ...account('private-window'), pluginConfig: { bridge_group_batch_seconds: 10 } };
    const storage = state();
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { resolveAccount: async () => bot, handleMessage: async () => undefined, now: () => 1000 });
    await enqueue(object, bot, message(bot, 'private', 'private'));
    expect(storage.values.get('pendingMessages')).toMatchObject([{ dueAt: 1001 }]);
  });

  it('does not repeat old message ids through a new webhook event id but still allows a wake', async () => {
    const bot = account('legacy-ids');
    const storage = state({ recentMessageIds: ['old-message'] });
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { resolveAccount: async () => bot, handleMessage: async () => undefined, now: () => 1000 });
    await enqueue(object, bot, message(bot, 'old-message'));
    expect(storage.values.get('pendingMessages')).toBeUndefined();
    await enqueue(object, bot, { ...message(bot, 'old-message'), eventId: 'wake:unique', isWake: true });
    expect(storage.values.get('pendingMessages')).toMatchObject([{ message: { eventId: 'wake:unique' } }]);
  });

  it('honors the group batch window override instead of the inherited plugin value', async () => {
    const bot = { ...account('window'), pluginConfig: { bridge_group_batch_seconds: 3 } };
    const storage = state();
    const statement = { bind: vi.fn(), all: vi.fn(async () => ({ results: [{ value: JSON.stringify({ id: 'group', accountId: bot.account.id, externalId: 'same-openid', config: { bridge_group_batch_seconds: 0 } }) }] })) };
    statement.bind.mockImplementation(() => statement);
    const env = { ...bindings, DB: { prepare: () => statement } } as unknown as RuntimeBindings;
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], env, { resolveAccount: async () => bot, now: () => 1000 });
    await enqueue(object, bot, message(bot, 'window'));
    expect(storage.values.get('pendingMessages')).toMatchObject([{ dueAt: 1001 }]);
  });

  it('retries only persistence after a successful handler and dedupe write failure', async () => {
    let now = 1000;
    const bot = account('post-send-failure');
    const storage = state();
    const save = storage.storage.put.getMockImplementation()!;
    let fail = false;
    storage.storage.put.mockImplementation(async (key, value) => {
      if (fail && key.startsWith('processedMessages:')) { fail = false; throw new Error('dedupe unavailable'); }
      await save(key, value);
    });
    const handleMessage = vi.fn(async () => { fail = true; });
    const object = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { resolveAccount: async () => bot, handleMessage, now: () => now });
    await enqueue(object, bot, message(bot, 'sent'));
    now = 2100;
    await object.alarm();
    expect(handleMessage).toHaveBeenCalledOnce();
    expect(storage.values.get('pendingMessages')).toMatchObject([{ attempts: 0, dueAt: 4100 }]);
    now = 5000;
    await object.alarm();
    expect(handleMessage).toHaveBeenCalledOnce();
    expect(storage.values.get('pendingMessages')).toEqual([]);
  });

  it('shares persistent sequences for text/media and isolates private targets', async () => {
    const storage = state();
    type Sequenced = { allocateReplySequence(target: string, id: string, expected: number, type: 'group' | 'private'): Promise<number> };
    const first = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { now: () => 1000 }) as unknown as Sequenced;
    expect(await first.allocateReplySequence('target', 'message', 1, 'group')).toBe(1);
    expect(await first.allocateReplySequence('target', 'message', 1, 'group')).toBe(2);
    const second = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, { now: () => 1000 }) as unknown as Sequenced;
    expect(await second.allocateReplySequence('target', 'message', 1, 'group')).toBe(3);
    expect(await second.allocateReplySequence('target', 'message', 1, 'private')).toBe(1);
  });

  it('persists scheduled wakes and drains them after an object restart', async () => {
    let now = 1000;
    const bot = account('wake');
    const storage = state();
    const handled = vi.fn(async (_bot: QQAccountContext, _event: QQGroupMessage) => undefined);
    const options = { resolveAccount: async () => bot, handleMessage: handled, now: () => now };
    const first = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options);
    const scheduling = first as unknown as { scheduleWake(account: QQAccountContext, message: QQGroupMessage, seconds: number, reason: string): Promise<void> };
    await scheduling.scheduleWake(bot, message(bot, 'source'), 10, 'remember this');
    expect(storage.storage.setAlarm).toHaveBeenCalledWith(11000);
    now = 12000;
    await new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings, options).alarm();
    expect(handled).toHaveBeenCalledWith(bot, expect.objectContaining({ id: 'source', isWake: true, wakeReason: 'remember this', text: 'remember this' }));
    expect(storage.values.get('pendingMessages')).toEqual([]);
  });

  it('stores outbound limits across restarts and keeps private/group keys isolated', async () => {
    const storage = state();
    type RateLimited = { reserveOutbound(key: string, count: number, at: number, limit: number): Promise<boolean> };
    const first = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings) as unknown as RateLimited;
    expect(await first.reserveOutbound('group-key', 2, 1000, 2)).toBe(true);
    const restarted = new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], bindings) as unknown as RateLimited;
    expect(await restarted.reserveOutbound('group-key', 1, 2000, 2)).toBe(false);
    expect(await restarted.reserveOutbound('private-key', 1, 2000, 2)).toBe(true);
    expect(await restarted.reserveOutbound('group-key', 1, 62000, 2)).toBe(true);
  });
});

describe('QQ durable context and knowledge compatibility', () => {
  type ContextOwner = { conversationStore(): GroupConversationStore };
  const bindings: RuntimeBindings = { PLATFORM: 'cloudflare' };
  const object = (storage: ReturnType<typeof state>, env = bindings) => new QQGatewayDurableObject(storage as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], env) as unknown as ContextOwner;

  it('claims a dangerous approval only once, durably across restart and knowledge/context clearing', async () => {
    const storage = boundedTransactionalState();
    const store = object(storage).conversationStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claimApproval!('scope', 'approval-id')));
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.setState!('scope', {});
    await store.clear!('scope');
    expect(await object(storage).conversationStore().claimApproval!('scope', 'approval-id')).toBe(false);
    expect(await store.claimApproval!('private-scope', 'approval-id')).toBe(true);
    expect([...storage.values.keys()].filter((key) => key.startsWith('approvalClaim:'))).toHaveLength(2);
  });

  it('fails closed when an approval claim cannot be committed', async () => {
    const storage = boundedTransactionalState();
    const save = storage.storage.put.getMockImplementation()!;
    let fail = true;
    storage.storage.put.mockImplementation(async (key, value) => {
      if (fail && key.startsWith('approvalClaim:')) throw new Error('claim storage unavailable');
      await save(key, value);
    });
    const store = object(storage).conversationStore();
    await expect(store.claimApproval!('scope', 'approval-id')).rejects.toThrow('claim storage unavailable');
    expect([...storage.values.keys()].some((key) => key.startsWith('approvalClaim:'))).toBe(false);
    fail = false;
    expect(await store.claimApproval!('scope', 'approval-id')).toBe(true);
    expect(await store.claimApproval!('scope', 'approval-id')).toBe(false);
  });

  it('stores a large complete turn and 512KB knowledge in chunks under the real DO value limit', async () => {
    const storage = boundedTransactionalState();
    const store = object(storage).conversationStore();
    const entries: ChatMessage[] = [{ role: 'user', content: '汉'.repeat(70_000) }, { role: 'assistant', content: 'reply' }];
    await store.append('scope', entries);
    const knowledge = { knowledge: { memories: [{ content: '文'.repeat(160_000) }] }, approvals: { pending: { arguments: 'a'.repeat(100_000) } } };
    await store.setState!('scope', knowledge);
    const restarted = object(storage).conversationStore();
    expect(await restarted.getRecent('scope', 1)).toEqual(entries);
    expect(await restarted.getState!('scope')).toEqual(knowledge);
    for (const value of storage.values.values()) expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(128 * 1024);
    await restarted.clear!('scope');
    expect(await restarted.getRecent('scope', 50)).toEqual([]);
    expect(await restarted.getState!('scope')).toEqual(knowledge);
  });

  it('preserves previous state atomically on a chunk failure and refuses oversize without erasing history', async () => {
    const storage = boundedTransactionalState();
    const store = object(storage).conversationStore();
    await store.setState!('scope', { old: 'keep' });
    await store.append('scope', [{ role: 'user', content: 'keep' }]);
    const save = storage.storage.put.getMockImplementation()!;
    let failed = false;
    storage.storage.put.mockImplementation(async (key, value) => {
      if (!failed && key.startsWith('chatState:scope:')) { failed = true; throw new Error('chunk write failed'); }
      await save(key, value);
    });
    await expect(store.setState!('scope', { memory: '汉'.repeat(80_000) })).rejects.toThrow('chunk write failed');
    expect(await object(storage).conversationStore().getState!('scope')).toEqual({ old: 'keep' });
    await expect(store.replace!('scope', [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }])).rejects.toThrow('byte limit');
    expect(await store.getRecent('scope', 50)).toEqual([{ role: 'user', content: 'keep' }]);
  });

  it('lazily migrates only the matching account old group history and does not resurrect cleared history', async () => {
    const old: ChatMessage[] = [{ role: 'user', content: 'old-group-only' }, { role: 'assistant', content: 'reply' }];
    const storage = boundedTransactionalState({ queueAccountId: 'account', 'context:old-group': old });
    const statement = { bind: vi.fn(), all: vi.fn(async () => ({ results: [{ value: JSON.stringify({ id: 'old-group', accountId: 'account', externalId: 'openid', conversationType: 'group' }) }] })) };
    statement.bind.mockImplementation(() => statement);
    const env = { ...bindings, DB: { prepare: () => statement } } as unknown as RuntimeBindings;
    const store = object(storage, env).conversationStore();
    const scope = JSON.stringify(['account', 'group', 'openid']);
    expect(await store.getRecent(scope, 50)).toEqual(old);
    expect(await store.getRecent(JSON.stringify(['account', 'private', 'openid']), 50)).toEqual([]);
    expect(await store.getRecent(JSON.stringify(['other-account', 'group', 'openid']), 50)).toEqual([]);
    await store.clear!(scope);
    expect(await object(storage, env).conversationStore().getRecent(scope, 50)).toEqual([]);
    expect(storage.values.get('context:old-group')).toEqual(old);
  });
});

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

  it('defaults native Durable Object bindings to Cloudflare without requiring a PLATFORM variable', async () => {
    const durableObject = new QQGatewayDurableObject(state() as unknown as ConstructorParameters<typeof QQGatewayDurableObject>[0], {});
    const response = await durableObject.fetch(new Request('https://qq-gateway.internal/disconnect', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: false });
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
