import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeWeChatMessage, verifyWeChatSignature } from './message';

export interface WeChatWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

async function resolveAccount(bindings: RuntimeBindings, signature: string, timestamp: string, nonce: string): Promise<ChatAccountContext | null> {
  const accounts = (await listChatAccounts('wechat', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
  const matches: ChatAccountContext[] = [];
  for (const account of accounts) {
    const token = credential(account, 'token');
    if (token && await verifyWeChatSignature(token, signature, timestamp, nonce)) matches.push(account);
  }
  return matches.length === 1 ? matches[0] : null;
}
export function createWeChatWebhookRouter(dependencies: WeChatWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.get('/webhook/wechat', async (context) => {
    const signature = context.req.query('signature') ?? '';
    const timestamp = context.req.query('timestamp') ?? '';
    const nonce = context.req.query('nonce') ?? '';
    const echo = context.req.query('echostr') ?? '';
    let account: ChatAccountContext | null;
    try {
      account = await resolveAccount(context.env ?? {}, signature, timestamp, nonce);
    } catch {
      return context.text('storage unavailable', 503);
    }
    if (!account) return context.text('invalid signature', 401);
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(echo)) return context.text('invalid echo', 400);
    return context.text(echo);
  });

  router.post('/webhook/wechat', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.query('signature') ?? '';
    const timestamp = context.req.query('timestamp') ?? '';
    const nonce = context.req.query('nonce') ?? '';
    let account: ChatAccountContext | null;
    try {
      account = await resolveAccount(bindings, signature, timestamp, nonce);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    if (!account) return context.json({ error: 'invalid_callback' }, 401);

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    const message = normalizeWeChatMessage(rawBody, account, now());
    if (message) {
      const key = `${account.account.id}:${message.eventId ?? message.id}`;
      for (const [id, entry] of recent) if (now() - entry.at > 10 * 60_000) recent.delete(id);
      const previous = recent.get(key);
      if (previous) {
        await previous.processing;
      } else {
        if (recent.size >= 2000) return context.json({ error: 'queue_full' }, 503);
        const processing = dependencies.handleMessage(account, message, bindings);
        recent.set(key, { at: now(), processing });
        try { await processing; } catch (error) { recent.delete(key); throw error; }
      }
    }
    return context.text('success');
  });

  return router;
}
