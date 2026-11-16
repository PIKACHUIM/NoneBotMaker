import type { ExtensionConfig, ExtensionRecord } from '../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch } from '../plugins/chatbot/network';

export type ExtensionSource = 'command' | 'schedule' | 'message' | 'manual';

export interface ExtensionEvent {
  source: ExtensionSource;
  command?: string;
  args: string;
  text: string;
  accountId: string;
  groupId: string;
  groupName?: string;
  userId?: string;
  userName?: string;
  conversationType: 'group' | 'private';
  at: number;
}

export interface ExtensionResult {
  replies: string[];
  logs: string[];
}

export interface ExtensionOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Optional Dynamic Workers loader (Cloudflare Workers Paid) for the JavaScript engine. */
  loader?: WorkerLoaderLike;
}

interface DynamicWorkerEntrypoint {
  fetch(request: Request): Promise<Response>;
}

interface DynamicWorkerStub {
  getEntrypoint(name?: string): DynamicWorkerEntrypoint;
}

export interface WorkerLoaderLike {
  load(options: {
    compatibilityDate: string;
    mainModule: string;
    modules: Record<string, string>;
    globalOutbound: null;
  }): DynamicWorkerStub;
}

const MAX_SOURCE_BYTES = 200 * 1024;
const MAX_REPLY_LENGTH = 4000;
const MAX_REPLIES = 10;

function normalizeReplies(value: unknown): string[] {
  const push = (target: string[], item: unknown) => {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) target.push(text.slice(0, MAX_REPLY_LENGTH));
      return;
    }
    if (Array.isArray(item)) {
      // OneBot-style message segments: [{ type: 'text', data: { text: '...' } }]
      for (const segment of item) push(target, segment && typeof segment === 'object'
        ? (segment as Record<string, unknown>).type === 'text'
          ? ((segment as Record<string, unknown>).data as Record<string, unknown> | undefined)?.text
          : undefined
        : undefined);
      return;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (typeof record.text === 'string') push(target, record.text);
      else if (record.data && typeof record.data === 'object') push(target, (record.data as Record<string, unknown>).text);
    }
  };
  const replies: string[] = [];
  if (typeof value === 'string') push(replies, value);
  else if (Array.isArray(value)) for (const item of value) push(replies, item);
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.replies)) for (const item of record.replies) push(replies, item);
    else if (Array.isArray(record.messages)) for (const item of record.messages) push(replies, item);
    else if (Array.isArray(record.actions)) {
      // Common bridge shape: { actions: [{ action: 'send_msg', params: { message: '...' } }] }
      for (const action of record.actions) {
        if (!action || typeof action !== 'object') continue;
        const params = (action as Record<string, unknown>).params as Record<string, unknown> | undefined;
        push(replies, params?.message);
      }
    } else push(replies, record.reply);
    push(replies, record.text);
  }
  return replies.slice(0, MAX_REPLIES);
}

function timeoutOf(config: ExtensionConfig, override?: number): number {
  const value = override ?? config.timeoutMs ?? 5000;
  return Number.isFinite(value) ? Math.max(1000, Math.min(15_000, Math.trunc(value))) : 5000;
}

function javascriptUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /code generation from strings|eval|new Function|not supported|disallowed/i.test(message);
}

async function runInDynamicWorker(
  loader: WorkerLoaderLike,
  source: string,
  event: ExtensionEvent,
  timeoutMs: number,
): Promise<ExtensionResult> {
  const moduleSource = [
    'export default {',
    '  async fetch(request) {',
    '    const event = await request.json();',
    '    const replies = [];',
    '    const logs = [];',
    '    const push = (item) => {',
    '      if (typeof item === "string" && item.trim()) replies.push(item.trim().slice(0, 4000));',
    '      else if (Array.isArray(item)) item.forEach(push);',
    '      else if (item && typeof item === "object" && typeof item.text === "string") push(item.text);',
    '    };',
    '    const ctx = {',
    '      event, args: event.args, command: event.command || "", state: {},',
    '      reply: push, send: push,',
    '      log: (...values) => { if (logs.length < 50) logs.push(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ").slice(0, 1000)); },',
    '      now: event.at, random: Math.random,',
    '    };',
    '    const result = await (async () => {',
    source,
    '    })();',
    '    return Response.json({ result, replies: replies.slice(0, 10), logs });',
    '  },',
    '};',
  ].join('\n');
  const worker = loader.load({
    compatibilityDate: '2026-11-01',
    mainModule: 'plugin.js',
    modules: { 'plugin.js': moduleSource },
    globalOutbound: null,
  });
  const execution = (async () => {
    const response = await worker.getEntrypoint().fetch(new Request('https://plugin.internal/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
    }));
    const payload = JSON.parse(await boundedText(response, 64 * 1024)) as { result?: unknown; replies?: unknown; logs?: unknown };
    return {
      replies: [...normalizeReplies(payload.replies), ...normalizeReplies(payload.result)].slice(0, MAX_REPLIES),
      logs: Array.isArray(payload.logs) ? payload.logs.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
    } satisfies ExtensionResult;
  })();
  return await Promise.race([
    execution,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Extension timed out after ${timeoutMs} ms.`)), timeoutMs)),
  ]);
}

/**
 * Executes an administrator-authored extension.
 * - `webhook` works on every deployment and is the recommended integration point.
 * - `javascript` executes where the runtime allows dynamic code (Node dev/server).
 *   Workers reject eval/new Function, so the error is surfaced instead of silently failing.
 */
export async function runExtension(record: ExtensionRecord, event: ExtensionEvent, options: ExtensionOptions = {}): Promise<ExtensionResult> {
  if (!record || record.enabled === false) throw new Error('Extension is disabled.');
  const config = record.config ?? ({} as ExtensionConfig);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = timeoutOf(config, options.timeoutMs);

  if (config.engine === 'webhook') {
    const url = publicHttpsUrl(String(config.webhookUrl ?? '')).toString();
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/plain' };
    if (typeof config.authToken === 'string' && config.authToken) headers.authorization = `Bearer ${config.authToken}`;
    const response = await safeFetch(url, {
      method: 'POST', headers,
      // The extra fields mirror common OneBot/Koishi event shapes so existing bridges can reuse them.
      body: JSON.stringify({
        event, extension: { id: record.id, name: record.name },
        post_type: 'message', message_type: event.conversationType, raw_message: event.text, message: event.text,
        user_id: event.userId, group_id: event.conversationType === 'group' ? event.groupId : undefined,
        self_id: event.accountId, time: Math.floor(event.at / 1000),
      }),
    }, fetchImpl, timeoutMs);
    const text = await boundedText(response, 64 * 1024);
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* plain text replies are supported */ }
    return { replies: normalizeReplies(payload), logs: [] };
  }

  if (config.engine !== 'javascript') throw new Error('Unsupported extension engine.');
  const source = typeof config.source === 'string' ? config.source : '';
  if (!source.trim()) throw new Error('JavaScript extension source is empty.');
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) throw new Error('JavaScript extension source exceeds the 200 KB limit.');

  if (options.loader) return await runInDynamicWorker(options.loader, source, event, timeoutMs);

  const replies: string[] = [];
  const logs: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = {
    event: { ...event },
    args: event.args,
    command: event.command ?? '',
    state,
    replies,
    log: (...values: unknown[]) => {
      if (logs.length < 50) logs.push(values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').slice(0, 1000));
    },
    reply: (value: unknown) => { for (const item of normalizeReplies(value)) { if (replies.length < MAX_REPLIES) replies.push(item); } },
    send: (value: unknown) => { for (const item of normalizeReplies(value)) { if (replies.length < MAX_REPLIES) replies.push(item); } },
    now: event.at,
    random: Math.random,
    fetch: async (input: string, init: RequestInit = {}) => {
      const response = await safeFetch(String(input), init, fetchImpl, timeoutMs);
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text: await boundedText(response, 256 * 1024) };
    },
  };

  let runner: () => Promise<unknown>;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function('ctx', `"use strict"; return (async () => {\n${source}\n})();`) as (context: typeof ctx) => Promise<unknown>;
    runner = () => factory(ctx);
  } catch (error) {
    if (javascriptUnavailable(error)) {
      throw new Error('当前部署禁止动态执行 JavaScript（Cloudflare Workers 不支持 eval/new Function）。请改用 HTTP 插件引擎，部署到 Node 运行时，或启用 PLUGIN_LOADER 动态工作线程绑定。');
    }
    throw error;
  }

  const result = await Promise.race([
    runner(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Extension timed out after ${timeoutMs} ms.`)), timeoutMs)),
  ]).catch((error: unknown) => {
    if (javascriptUnavailable(error)) {
      throw new Error('当前部署禁止动态执行 JavaScript（Cloudflare Workers 不支持 eval/new Function）。请改用 HTTP 插件引擎，部署到 Node 运行时，或启用 PLUGIN_LOADER 动态工作线程绑定。');
    }
    throw error;
  });

  for (const item of normalizeReplies(result)) if (replies.length < MAX_REPLIES) replies.push(item);
  return { replies: replies.slice(0, MAX_REPLIES), logs };
}
