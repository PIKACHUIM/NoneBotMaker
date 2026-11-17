import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Base64, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeLineEvent, type LineWebhookPayload } from './message';

export interface LineWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createLineWebhookRouter(dependencies: LineWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/line', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.header('X-Line-Signature') ?? '';
    if (!signature) return context.json({ error: 'invalid_callback' }, 401);

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('line', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }

    const matches: ChatAccountContext[] = [];
    for (const candidate of accounts) {
      const secret = credential(candidate, 'channelSecret');
      if (!secret) continue;
      if (safeEqual(await hmacSha256Base64(secret, rawBody), signature)) matches.push(candidate);
    }
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    let payload: LineWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as LineWebhookPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    const botUserId = credential(account, 'botUserId');
    if (botUserId && typeof payload.destination === 'string' && payload.destination !== botUserId) {
      return context.json({ error: 'invalid_callback' }, 401);
    }

    for (const event of Array.isArray(payload.events) ? payload.events : []) {
      const message = normalizeLineEvent(event, account, now());
      if (!message) continue;
      const key = `${account.account.id}:${message.eventId ?? message.id}`;
      for (const [id, entry] of recent) if (now() - entry.at > 10 * 60_000) recent.delete(id);
      const previous = recent.get(key);
      if (previous) {
        await previous.processing;
        continue;
      }
      if (recent.size >= 2000) return context.json({ error: 'queue_full' }, 503);
      const processing = dependencies.handleMessage(account, message, bindings);
      recent.set(key, { at: now(), processing });
      try { await processing; } catch (error) { recent.delete(key); throw error; }
    }
    return context.json({ ok: true });
  });

  return router;
}
