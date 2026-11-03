import { describe, expect, it, vi } from 'vitest';
import { IgnoreEvent, PluginRuntime, SkipMatcher, commandRule, onMessage, regexRule, userPermission, type MatcherSession, type RuntimeBot, type RuntimeEvent } from './dispatcher';

function fixtures(userId = 'user', botId = 'bot'): { bot: RuntimeBot; event: RuntimeEvent } {
  return {
    bot: { id: botId, platform: 'qq', send: vi.fn(async () => undefined) },
    event: {
      type: 'message', platform: 'qq', botId, sessionId: 'group:room', userId,
      message: { id: 'msg', accountId: botId, botId, groupId: 'room', userId, text: '/hello world', mentionsBot: true, receivedAt: 0 },
    },
  };
}

describe('NoneBot-style event dispatcher', () => {
  it('normalizes adapter-specific events before dispatch and exposes instrumented adapter APIs', async () => {
    const before = vi.fn(async () => undefined);
    const after = vi.fn(async () => undefined);
    const callApi = vi.fn(async () => ({ accepted: true }));
    const runtime = new PluginRuntime({ hooks: { apiBefore: [before], apiAfter: [after] } });
    runtime.registerAdapter({ platform: 'custom', normalizeEvent: (bot, input) => {
      const packet = input as { sender?: unknown; body?: unknown };
      if (typeof packet.sender !== 'string' || typeof packet.body !== 'string') return null;
      return { type: 'message', platform: bot.platform, botId: bot.id, sessionId: 'custom:room', userId: packet.sender, message: { id: 'external-event', accountId: bot.id, botId: bot.id, groupId: 'room', userId: packet.sender, text: packet.body, mentionsBot: false, receivedAt: 0 } };
    } });
    runtime.register({ id: 'plugin', matchers: [{ id: 'custom-event', handlers: [async (context) => { await context.callApi('send_reaction', { emoji: 'ok' }); }] }] });
    const bot: RuntimeBot = { id: 'custom-bot', platform: 'custom', send: vi.fn(), callApi };
    await expect(runtime.dispatchAdapterEvent(bot, { sender: 'alice', body: 'hello' })).resolves.toMatchObject({ matched: ['plugin:custom-event'] });
    await expect(runtime.dispatchAdapterEvent(bot, { broken: true })).resolves.toMatchObject({ ignored: true });
    expect(callApi).toHaveBeenCalledWith('send_reaction', { emoji: 'ok' });
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(runtime.adapterPlatforms()).toEqual(['custom']);
  });

  it('executes all same-priority matchers and blocks only lower priorities', async () => {
    const calls: string[] = [];
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [
      { id: 'first', priority: 1, block: true, handlers: [async () => { calls.push('first'); }] },
      { id: 'peer', priority: 1, handlers: [async () => { calls.push('peer'); }] },
      { id: 'lower', priority: 2, handlers: [async () => { calls.push('lower'); }] },
    ] });
    const { bot, event } = fixtures();
    const result = await runtime.dispatch(bot, event);
    expect(calls.sort()).toEqual(['first', 'peer']);
    expect(result.blocked).toBe(true);
  });

  it('skip() skips only the current handler and continues with the next handler', async () => {
    const calls: string[] = [];
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [{ id: 'handlers', priority: 1, block: true, handlers: [
      async (context) => { calls.push('first'); await context.skip(); },
      async () => { calls.push('second'); },
    ] }, { id: 'lower', priority: 2, handlers: [async () => { calls.push('lower'); }] }] });
    const { bot, event } = fixtures();
    const result = await runtime.dispatch(bot, event);
    expect(calls).toEqual(['first', 'second']);
    expect(result.blocked).toBe(true);
  });

  it('onMessage defaults to blocking and allows explicit block opt-out', async () => {
    const { bot, event } = fixtures();
    const blockedCalls: string[] = [];
    const blocking = new PluginRuntime();
    blocking.register({ id: 'plugin', matchers: [
      onMessage({ id: 'message', priority: 1, handlers: [async () => { blockedCalls.push('message'); }] }),
      { id: 'lower', priority: 2, handlers: [async () => { blockedCalls.push('lower'); }] },
    ] });
    expect((await blocking.dispatch(bot, event)).blocked).toBe(true);
    expect(blockedCalls).toEqual(['message']);
    const passThroughCalls: string[] = [];
    const passThrough = new PluginRuntime();
    passThrough.register({ id: 'plugin', matchers: [
      onMessage({ id: 'message', priority: 1, block: false, handlers: [async () => { passThroughCalls.push('message'); }] }),
      { id: 'lower', priority: 2, handlers: [async () => { passThroughCalls.push('lower'); }] },
    ] });
    expect((await passThrough.dispatch(bot, event)).blocked).toBe(false);
    expect(passThroughCalls).toEqual(['message', 'lower']);
  });

  it('uses AND rules, OR permissions, command arguments and regex groups', async () => {
    const run = vi.fn(async (context) => { expect(context.state.commandArgs).toBe('world'); });
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [
      { id: 'accepted', permissions: [userPermission(['other']), userPermission(['user'])], rules: [commandRule('hello'), regexRule(/world$/)], handlers: [run] },
      { id: 'denied', rules: [() => true, () => false], handlers: [run] },
    ] });
    const { bot, event } = fixtures();
    expect((await runtime.dispatch(bot, event)).matched).toEqual(['plugin:accepted']);
    expect(run).toHaveBeenCalledOnce();
  });

  it('destroys temporary and expired matchers', async () => {
    const run = vi.fn(async () => undefined);
    const runtime = new PluginRuntime({ now: () => 100 });
    runtime.register({ id: 'plugin', matchers: [
      { id: 'temporary', temporary: true, handlers: [run] },
      { id: 'expired', expiresAt: 99, handlers: [run] },
    ] });
    const { bot, event } = fixtures();
    await Promise.all([runtime.dispatch(bot, event), runtime.dispatch(bot, event)]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('shares dependency promises per event without leaking across events', async () => {
    const dependency = vi.fn(async () => ({ count: 1 }));
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [
      { id: 'first', handlers: [async (context) => { await context.depend(dependency); }] },
      { id: 'second', handlers: [async (context) => { await context.depend(dependency); }] },
    ] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    expect(dependency).toHaveBeenCalledOnce();
    await runtime.dispatch(bot, event);
    expect(dependency).toHaveBeenCalledTimes(2);
  });

  it('runs processors and reports matcher errors without skipping peers', async () => {
    const after = vi.fn();
    const runtime = new PluginRuntime({ hooks: {
      eventBefore: [(_event, _bot, state) => { state.before = true; }],
      matcherAfter: [after],
    } });
    runtime.register({ id: 'plugin', matchers: [
      { id: 'failed', handlers: [() => { throw new Error('failure'); }] },
      { id: 'peer', handlers: [(context) => { expect(context.state.before).toBe(true); }] },
    ] });
    const { bot, event } = fixtures();
    const result = await runtime.dispatch(bot, event);
    expect(result.errors).toHaveLength(1);
    expect(result.matched).toHaveLength(2);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('does not block propagation when a preprocessor explicitly skips a blocking matcher', async () => {
    const run = vi.fn();
    const runtime = new PluginRuntime({ hooks: { matcherBefore: [(context) => { if (context.matcher.id === 'skipped') throw new SkipMatcher(); }] } });
    runtime.register({ id: 'plugin', matchers: [
      { id: 'skipped', priority: 1, block: true, handlers: [run] },
      { id: 'lower', priority: 2, handlers: [run] },
    ] });
    const { bot, event } = fixtures();
    const result = await runtime.dispatch(bot, event);
    expect(result.matched).toEqual(['plugin:lower']);
    expect(run).toHaveBeenCalledOnce();
  });

  it('ignores events explicitly but still runs event postprocessors', async () => {
    const after = vi.fn();
    const runtime = new PluginRuntime({ hooks: { eventBefore: [() => { throw new IgnoreEvent(); }], eventAfter: [after] } });
    const { bot, event } = fixtures();
    expect((await runtime.dispatch(bot, event)).ignored).toBe(true);
    expect(after).toHaveBeenCalledOnce();
  });

  it('pause resumes at next handler and isolates bot, user and conversation', async () => {
    const run = vi.fn(async () => undefined);
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [{ id: 'flow', rules: [commandRule('hello')], handlers: [
      async (context) => { context.state.step = 1; await context.pause('next'); },
      async (context) => { expect(context.state.step).toBe(1); await run(); },
    ] }] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    const next = { ...event, message: { ...event.message!, text: 'answer' } };
    await runtime.dispatch(bot, { ...next, userId: 'other' });
    await runtime.dispatch(bot, { ...next, sessionId: 'group:other' });
    expect(run).not.toHaveBeenCalled();
    expect((await runtime.dispatch(bot, next)).blocked).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    await runtime.dispatch(bot, next);
    expect(run).toHaveBeenCalledOnce();
  });

  it('resumes a non-message pause on the next message by default', async () => {
    const resumed = vi.fn();
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [{ id: 'notice-flow', type: 'notice', handlers: [
      async (context) => { await context.pause(); },
      resumed,
    ] }] });
    const { bot, event } = fixtures();
    const notice = { ...event, type: 'notice' as const, message: undefined };
    await runtime.dispatch(bot, notice);
    expect(resumed).not.toHaveBeenCalled();
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: 'reply' } });
    expect(resumed).toHaveBeenCalledOnce();
  });

  it('continues a paused temporary matcher even after the original matcher expires', async () => {
    let now = 100;
    const resumed = vi.fn();
    const runtime = new PluginRuntime({ now: () => now, sessionTimeoutMs: 100 });
    runtime.register({ id: 'plugin', matchers: [{ id: 'temporary-flow', temporary: true, expiresAt: 110, handlers: [async (context) => { await context.pause(); }, resumed] }] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    now = 120;
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: 'next' } });
    expect(resumed).toHaveBeenCalledOnce();
    await runtime.dispatch(bot, event);
    expect(resumed).toHaveBeenCalledOnce();
  });

  it('got persists prompt/answer across runtime recreation using an external session store', async () => {
    const sessions = new Map<string, MatcherSession>();
    const store = { take: async (key: string) => { const value = sessions.get(key) ?? null; sessions.delete(key); return value; }, put: async (key: string, value: MatcherSession) => { sessions.set(key, value); } };
    const run = vi.fn();
    const create = () => {
      const runtime = new PluginRuntime({ sessions: store });
      runtime.register({ id: 'plugin', matchers: [{ id: 'flow', rules: [commandRule('hello')], handlers: [async (context) => {
        const answer = await context.got('answer', 'enter answer');
        run(answer);
        await context.finish('done');
      }] }] });
      return runtime;
    };
    const { bot, event } = fixtures();
    await create().dispatch(bot, event);
    expect(bot.send).toHaveBeenCalledWith(event, 'enter answer');
    await create().dispatch(bot, { ...event, message: { ...event.message!, text: '42' } });
    expect(run).toHaveBeenCalledWith('42');
    expect(sessions.size).toBe(0);
  });

  it('rejects an invalid got argument and accepts a fresh answer on the next event', async () => {
    const run = vi.fn();
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [{ id: 'flow', rules: [commandRule('hello')], handlers: [async (context) => {
      const answer = await context.got('answer', 'enter a number');
      if (!/^\d+$/.test(answer)) await context.reject('invalid number');
      run(answer);
    }] }] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: 'invalid' } });
    expect(run).not.toHaveBeenCalled();
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: '42' } });
    expect(run).toHaveBeenCalledWith('42');
  });

  it('expires paused sessions instead of running stale handlers', async () => {
    let now = 100;
    const run = vi.fn();
    const runtime = new PluginRuntime({ now: () => now, sessionTimeoutMs: 10 });
    runtime.register({ id: 'plugin', matchers: [{ id: 'flow', rules: [commandRule('hello')], handlers: [async (context) => { await context.pause(); }, run] }] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    now = 111;
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: 'next' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('checks current permissions before resuming a paused session', async () => {
    let allowed = true;
    const resumed = vi.fn();
    const runtime = new PluginRuntime();
    runtime.register({ id: 'plugin', matchers: [{ id: 'flow', permissions: [() => allowed], rules: [commandRule('hello')], handlers: [async (context) => { await context.pause(); }, resumed] }] });
    const { bot, event } = fixtures();
    await runtime.dispatch(bot, event);
    allowed = false;
    await runtime.dispatch(bot, { ...event, message: { ...event.message!, text: 'answer' } });
    expect(resumed).not.toHaveBeenCalled();
  });

  it('initializes once for concurrent dispatches and shuts down dependencies in reverse order', async () => {
    const calls: string[] = [];
    const baseStart = vi.fn(async () => { calls.push('base'); });
    const runtime = new PluginRuntime();
    runtime.register({ id: 'child', dependencies: ['base'], matchers: [], startup: () => { calls.push('child'); }, shutdown: () => { calls.push('child-stop'); } });
    runtime.register({ id: 'base', matchers: [], startup: baseStart, shutdown: () => { calls.push('base-stop'); } });
    const { bot, event } = fixtures();
    await Promise.all([runtime.dispatch(bot, event), runtime.dispatch(bot, event)]);
    expect(baseStart).toHaveBeenCalledOnce();
    await runtime.shutdown();
    expect(calls).toEqual(['base', 'child', 'child-stop', 'base-stop']);
  });

  it('orders dependency startup and validates cycles and missing dependencies', async () => {
    const calls: string[] = [];
    const runtime = new PluginRuntime();
    runtime.register({ id: 'child', dependencies: ['base'], matchers: [], startup: () => { calls.push('child'); } });
    runtime.register({ id: 'base', matchers: [], startup: () => { calls.push('base'); } });
    await runtime.start();
    expect(calls).toEqual(['base', 'child']);
    const missing = new PluginRuntime();
    missing.register({ id: 'child', dependencies: ['missing'], matchers: [] });
    await expect(missing.start()).rejects.toThrow('Missing');
    const cycle = new PluginRuntime();
    cycle.register({ id: 'a', dependencies: ['b'], matchers: [] });
    cycle.register({ id: 'b', dependencies: ['a'], matchers: [] });
    await expect(cycle.start()).rejects.toThrow('Circular');
  });

  it('runs bot and API lifecycle hooks and checks adapter ownership', async () => {
    const connected = vi.fn();
    const disconnected = vi.fn();
    const after = vi.fn();
    const runtime = new PluginRuntime({ hooks: { botConnected: [connected], botDisconnected: [disconnected], apiAfter: [after] } });
    const { bot, event } = fixtures();
    bot.callApi = vi.fn(async () => ({ ok: true }));
    await runtime.connectBot(bot);
    expect(connected).toHaveBeenCalledWith(bot);
    await expect(runtime.connectBot(bot)).rejects.toThrow('Duplicate');
    expect(await runtime.callApi(bot, 'send', {})).toEqual({ ok: true });
    expect(after).toHaveBeenCalledWith(bot, 'send', { ok: true }, undefined);
    await expect(runtime.dispatch(bot, { ...event, botId: 'other' })).rejects.toThrow('does not belong');
    await runtime.disconnectBot(bot.id);
    expect(disconnected).toHaveBeenCalledWith(bot);
  });
});
