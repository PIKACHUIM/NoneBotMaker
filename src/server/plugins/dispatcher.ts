import type { JsonObject, NormalizedMessage, RuntimeBindings } from '../../shared/types';

export interface RuntimeEvent {
  type: 'message' | 'notice' | 'request' | 'meta_event';
  platform: string;
  botId: string;
  sessionId: string;
  userId: string;
  message?: NormalizedMessage;
  payload?: unknown;
}

export interface RuntimeBot {
  id: string;
  platform: string;
  send(event: RuntimeEvent, content: string): Promise<unknown>;
  callApi?(name: string, parameters: JsonObject): Promise<unknown>;
}

export interface MatcherSession {
  matcherId: string;
  nextHandler: number;
  state: JsonObject;
  expiresAt: number;
  receiveKey?: string;
}

export interface MatcherSessionStore {
  take(key: string): Promise<MatcherSession | null>;
  put(key: string, value: MatcherSession): Promise<void>;
}

export function createD1MatcherSessionStore(bindings: RuntimeBindings): MatcherSessionStore {
  const db = bindings.DB;
  if (!db) throw new Error('Persistent matcher sessions require an atomic D1 or Durable Object session adapter.');
  const kind = 'matcher-sessions-v1';
  return {
    async take(key) {
      const row = await db.prepare('DELETE FROM records WHERE kind = ? AND id = ? RETURNING value')
        .bind(kind, key).first<{ value: string }>();
      if (!row) return null;
      const value = JSON.parse(row.value) as Partial<MatcherSession>;
      if (typeof value.matcherId !== 'string' || !Number.isSafeInteger(value.nextHandler) || (value.nextHandler as number) < 0 ||
          !Number.isFinite(value.expiresAt) || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) {
        throw new Error('Invalid persisted matcher session.');
      }
      return value as MatcherSession;
    },
    async put(key, value) {
      const encoded = JSON.stringify(value);
      if (encoded.length > 128 * 1024) throw new Error('Matcher session exceeds storage limit.');
      await db.prepare('DELETE FROM records WHERE kind = ? AND updated_at <= ?')
        .bind(kind, new Date().toISOString()).run();
      await db.prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(kind, key, encoded, new Date(value.expiresAt).toISOString()).run();
    },
  };
}

export type MatcherCheck = (context: MatcherContext) => boolean | Promise<boolean>;
export type MatcherHandler = (context: MatcherContext) => void | Promise<void>;
export type Dependency<T> = (context: MatcherContext) => T | Promise<T>;

export interface MatcherDefinition {
  id: string;
  pluginId: string;
  type?: RuntimeEvent['type'];
  priority?: number;
  block?: boolean;
  temporary?: boolean;
  expiresAt?: number;
  rules?: MatcherCheck[];
  permissions?: MatcherCheck[];
  state?: JsonObject;
  handlers: MatcherHandler[];
}

export interface RuntimePlugin {
  id: string;
  dependencies?: string[];
  matchers: Omit<MatcherDefinition, 'pluginId'>[];
  startup?(): Promise<void> | void;
  shutdown?(): Promise<void> | void;
}

export interface DispatchResult {
  matched: string[];
  blocked: boolean;
  ignored: boolean;
  errors: Array<{ matcherId: string; error: unknown }>;
}

class MatcherControl extends Error {
  constructor(readonly action: 'finish' | 'pause' | 'reject', readonly receiveKey?: string) {
    super(action);
  }
}

export class IgnoreEvent extends Error {}
export class SkipMatcher extends Error {}

export class MatcherContext {
  readonly state: JsonObject;
  block: boolean;
  private receiveTarget?: { key: string; argumentKey?: string };

  constructor(
    readonly bot: RuntimeBot,
    readonly event: RuntimeEvent,
    readonly matcher: MatcherDefinition,
    state: JsonObject,
    private readonly dependencies: Map<Dependency<unknown>, Promise<unknown>>,
  ) {
    this.state = state;
    this.block = matcher.block ?? false;
  }

  depend<T>(dependency: Dependency<T>, cached = true): Promise<T> {
    if (!cached) return Promise.resolve().then(() => dependency(this));
    if (!this.dependencies.has(dependency)) {
      this.dependencies.set(dependency, Promise.resolve().then(() => dependency(this)));
    }
    return this.dependencies.get(dependency) as Promise<T>;
  }

  send(content: string): Promise<unknown> {
    return this.bot.send(this.event, content);
  }

  async finish(content?: string): Promise<never> {
    if (content !== undefined) await this.send(content);
    throw new MatcherControl('finish');
  }

  async pause(content?: string): Promise<never> {
    if (content !== undefined) await this.send(content);
    throw new MatcherControl('pause');
  }

  async reject(content?: string): Promise<never> {
    if (content !== undefined) await this.send(content);
    if (this.receiveTarget) {
      delete this.state[this.receiveTarget.key];
      if (this.receiveTarget.argumentKey) delete this.state[this.receiveTarget.argumentKey];
    }
    throw new MatcherControl('reject', this.receiveTarget?.key);
  }

  async receive(key: string, prompt?: string): Promise<NormalizedMessage> {
    this.receiveTarget = { key };
    const received = this.state[key];
    if (received && typeof received === 'object' && !Array.isArray(received)) return received as NormalizedMessage;
    if (prompt !== undefined) await this.send(prompt);
    throw new MatcherControl('reject', key);
  }

  async got(key: string, prompt?: string): Promise<string> {
    const receiveKey = `__received:${key}`;
    this.receiveTarget = { key: receiveKey, argumentKey: key };
    if (typeof this.state[key] === 'string') return this.state[key] as string;
    const received = await this.receive(receiveKey, prompt);
    this.receiveTarget = { key: receiveKey, argumentKey: key };
    this.state[key] = received.text;
    delete this.state[receiveKey];
    return received.text;
  }

  stopPropagation(): void {
    this.block = true;
  }
}

export interface RuntimeHooks {
  eventBefore?: Array<(event: RuntimeEvent, bot: RuntimeBot, state: JsonObject) => Promise<void> | void>;
  eventAfter?: Array<(event: RuntimeEvent, result: DispatchResult) => Promise<void> | void>;
  matcherBefore?: MatcherHandler[];
  matcherAfter?: Array<(context: MatcherContext, error?: unknown) => Promise<void> | void>;
  botConnected?: Array<(bot: RuntimeBot) => Promise<void> | void>;
  botDisconnected?: Array<(bot: RuntimeBot) => Promise<void> | void>;
  apiBefore?: Array<(bot: RuntimeBot, name: string, parameters: JsonObject) => Promise<void> | void>;
  apiAfter?: Array<(bot: RuntimeBot, name: string, result: unknown, error?: unknown) => Promise<void> | void>;
}

export class PluginRuntime {
  private readonly plugins = new Map<string, RuntimePlugin>();
  private readonly matchers = new Map<string, MatcherDefinition>();
  private readonly registeredMatchers = new Map<string, MatcherDefinition>();
  private readonly bots = new Map<string, RuntimeBot>();
  private readonly memorySessions = new Map<string, MatcherSession>();
  private started = false;
  private starting?: Promise<void>;
  private startupOrder: RuntimePlugin[] = [];

  constructor(
    private readonly options: { hooks?: RuntimeHooks; sessions?: MatcherSessionStore; now?: () => number; sessionTimeoutMs?: number } = {},
  ) {}

  register(plugin: RuntimePlugin): void {
    if (this.started || this.starting) throw new Error('Register plugins before starting the runtime.');
    if (this.plugins.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`);
    const keys = plugin.matchers.map((matcher) => `${plugin.id}:${matcher.id}`);
    if (new Set(keys).size !== keys.length || keys.some((key) => this.registeredMatchers.has(key))) throw new Error('Duplicate matcher ID.');
    this.plugins.set(plugin.id, plugin);
    for (const matcher of plugin.matchers) {
      const key = `${plugin.id}:${matcher.id}`;
      const definition = { ...matcher, pluginId: plugin.id };
      this.matchers.set(key, definition);
      this.registeredMatchers.set(key, definition);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.starting) {
      this.starting = this.initialize();
      this.starting.finally(() => { this.starting = undefined; }).catch(() => undefined);
    }
    await this.starting;
  }

  private async initialize(): Promise<void> {
    const visited = new Set<string>();
    const pending = new Set<string>();
    const order: RuntimePlugin[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (pending.has(id)) throw new Error(`Circular plugin dependency: ${id}`);
      const plugin = this.plugins.get(id);
      if (!plugin) throw new Error(`Missing plugin dependency: ${id}`);
      pending.add(id);
      for (const dependency of plugin.dependencies ?? []) visit(dependency);
      pending.delete(id);
      visited.add(id);
      order.push(plugin);
    };
    for (const id of this.plugins.keys()) visit(id);
    const initialized: RuntimePlugin[] = [];
    try {
      for (const plugin of order) {
        await plugin.startup?.();
        initialized.push(plugin);
      }
      this.startupOrder = order;
      this.started = true;
    } catch (error) {
      await Promise.allSettled(initialized.reverse().map(async (plugin) => plugin.shutdown?.()));
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.starting) await this.starting;
    const errors: unknown[] = [];
    for (const plugin of [...this.startupOrder].reverse()) {
      try { await plugin.shutdown?.(); } catch (error) { errors.push(error); }
    }
    this.startupOrder = [];
    this.started = false;
    this.memorySessions.clear();
    for (const id of [...this.bots.keys()]) {
      try { await this.disconnectBot(id); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Plugin shutdown failed.');
  }

  async connectBot(bot: RuntimeBot): Promise<void> {
    if (this.bots.has(bot.id)) throw new Error(`Duplicate bot: ${bot.id}`);
    this.bots.set(bot.id, bot);
    try {
      for (const hook of this.options.hooks?.botConnected ?? []) await hook(bot);
    } catch (error) {
      this.bots.delete(bot.id);
      throw error;
    }
  }

  async disconnectBot(id: string): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) return;
    this.bots.delete(id);
    for (const hook of this.options.hooks?.botDisconnected ?? []) await hook(bot);
  }

  async callApi(bot: RuntimeBot, name: string, parameters: JsonObject): Promise<unknown> {
    if (!bot.callApi) throw new Error('The bot adapter does not support API calls.');
    for (const hook of this.options.hooks?.apiBefore ?? []) await hook(bot, name, parameters);
    let result: unknown;
    let error: unknown;
    try {
      result = await bot.callApi(name, parameters);
    } catch (cause) {
      error = cause;
      throw cause;
    } finally {
      for (const hook of this.options.hooks?.apiAfter ?? []) await hook(bot, name, result, error);
    }
    return result;
  }

  async dispatch(bot: RuntimeBot, event: RuntimeEvent): Promise<DispatchResult> {
    await this.start();
    if (event.botId !== bot.id || event.platform !== bot.platform) throw new Error('Event does not belong to this bot adapter.');
    const result: DispatchResult = { matched: [], blocked: false, ignored: false, errors: [] };
    const state: JsonObject = {};
    const cache = new Map<Dependency<unknown>, Promise<unknown>>();
    try {
      for (const hook of this.options.hooks?.eventBefore ?? []) await hook(event, bot, state);
    } catch (error) {
      if (!(error instanceof IgnoreEvent)) throw error;
      result.ignored = true;
    }
    try {
      if (result.ignored) return result;
      const sessionKey = JSON.stringify([event.platform, bot.id, event.type, event.sessionId, event.userId]);
      const resumed = this.options.sessions
        ? await this.options.sessions.take(sessionKey)
        : this.memorySessions.get(sessionKey) ?? null;
      this.memorySessions.delete(sessionKey);
      const now = this.options.now?.() ?? Date.now();
      if (resumed && resumed.expiresAt > now) {
        const matcher = this.registeredMatchers.get(resumed.matcherId);
        if (matcher) {
          const context = new MatcherContext(bot, event, matcher, resumed.state, cache);
          const permissions = matcher.permissions ?? [];
          if (!permissions.length || (await Promise.all(permissions.map((check) => check(context)))).some(Boolean)) {
            if (resumed.receiveKey && event.message) context.state[resumed.receiveKey] = event.message;
            context.block = true;
            await this.run(context, resumed.nextHandler, sessionKey, result);
            result.blocked = true;
            return result;
          }
        }
      }
      const priorities = [...new Set([...this.matchers.values()].map((matcher) => matcher.priority ?? 1))].sort((a, b) => a - b);
      for (const priority of priorities) {
        const matches = [...this.matchers.values()].filter((matcher) => (matcher.priority ?? 1) === priority);
        await Promise.all(matches.map(async (matcher) => {
          const key = `${matcher.pluginId}:${matcher.id}`;
          if (matcher.expiresAt !== undefined && matcher.expiresAt <= now) {
            this.matchers.delete(key);
            return;
          }
          if (matcher.type && matcher.type !== event.type) return;
          const context = new MatcherContext(bot, event, matcher, { ...state, ...structuredClone(matcher.state ?? {}) }, cache);
          try {
            const permissions = matcher.permissions ?? [];
            if (permissions.length && !(await Promise.all(permissions.map((check) => check(context)))).some(Boolean)) return;
            if (!(await Promise.all((matcher.rules ?? []).map((check) => check(context)))).every(Boolean)) return;
            if (!this.matchers.has(key)) return;
            if (matcher.temporary) this.matchers.delete(key);
            await this.run(context, 0, sessionKey, result);
          } catch (error) {
            if (!(error instanceof SkipMatcher)) result.errors.push({ matcherId: key, error });
          }
        }));
        if (result.blocked) break;
      }
      return result;
    } finally {
      for (const hook of this.options.hooks?.eventAfter ?? []) await hook(event, result);
    }
  }

  private async run(context: MatcherContext, from: number, sessionKey: string, result: DispatchResult): Promise<void> {
    const matcherId = `${context.matcher.pluginId}:${context.matcher.id}`;
    let failure: unknown;
    let index = from;
    try {
      for (const hook of this.options.hooks?.matcherBefore ?? []) await hook(context);
      result.matched.push(matcherId);
      for (; index < context.matcher.handlers.length; index += 1) await context.matcher.handlers[index](context);
    } catch (error) {
      if (error instanceof MatcherControl) {
        if (error.action !== 'finish') {
          const session: MatcherSession = {
            matcherId,
            nextHandler: error.action === 'pause' ? index + 1 : index,
            state: structuredClone(context.state),
            expiresAt: (this.options.now?.() ?? Date.now()) + (this.options.sessionTimeoutMs ?? 120_000),
            ...(error.receiveKey ? { receiveKey: error.receiveKey } : {}),
          };
          if (this.options.sessions) await this.options.sessions.put(sessionKey, session);
          else this.memorySessions.set(sessionKey, session);
          context.block = true;
        }
      } else if (error instanceof SkipMatcher) {
        context.block = false;
      } else {
        failure = error;
        result.errors.push({ matcherId, error });
      }
    } finally {
      for (const hook of this.options.hooks?.matcherAfter ?? []) await hook(context, failure);
      result.blocked ||= context.block;
    }
  }
}

export function commandRule(command: string, prefixes: string[] = ['/']): MatcherCheck {
  return ({ event, state }) => {
    const text = event.message?.text.trim() ?? '';
    const prefix = prefixes.find((item) => text === `${item}${command}` || text.startsWith(`${item}${command} `));
    if (prefix === undefined) return false;
    state.command = command;
    state.commandArgs = text.slice(prefix.length + command.length).trimStart();
    return true;
  };
}

export function regexRule(expression: RegExp): MatcherCheck {
  return ({ event, state }) => {
    const local = new RegExp(expression.source, expression.flags);
    const matched = local.exec(event.message?.text ?? '');
    if (!matched) return false;
    state.regexGroups = [...matched];
    return true;
  };
}

export function userPermission(userIds: Iterable<string>): MatcherCheck {
  const allowed = new Set(userIds);
  return ({ event }) => allowed.has(event.userId);
}
