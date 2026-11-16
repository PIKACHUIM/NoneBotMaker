import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { resolveChatAccountByCredential } from '../accounts';
import { hmacSha1Hex, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeOneBotMessage, type OneBotPayload } from './message';

export interface OneBotWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createOneBotWebhookRouter(dependencies: OneBotWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/onebot', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }
    let payload: OneBotPayload;
    try {
      payload = JSON.parse(rawBody) as OneBotPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return context.json({ error: 'invalid_payload' }, 400);
    if (payload.post_type !== 'message') return context.json({ status: 'ok', retcode: 0 });

    const selfId = typeof payload.self_id === 'string' ? payload.self_id : typeof payload.self_id === 'number' ? String(payload.self_id) : '';
    if (!selfId) return context.json({ error: 'invalid_callback' }, 400);
    let account: ChatAccountContext | null;
    try {
      account = await resolveChatAccountByCredential('onebot', selfId, bindings);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    if (!account || !account.account.enabled || !account.pluginEnabled) {
      return context.json({ error: 'invalid_callback' }, 401);
    }

    const secret = credential(account, 'secret');
    if (secret) {
      const header = context.req.header('X-Signature') ?? '';
      const signature = header.replace(/^sha1=/i, '').toLowerCase();
      if (!signature || !safeEqual(await hmacSha1Hex(secret, rawBody), signature)) {
        return context.json({ error: 'invalid_signature' }, 401);
      }
    }

    const message = normalizeOneBotMessage(payload, account, now());
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
    return context.json({ status: 'ok', retcode: 0 });
  });

  return router;
}
