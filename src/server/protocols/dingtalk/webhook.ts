import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Base64, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeDingTalkMessage, type DingTalkPayload } from './message';

export interface DingTalkWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createDingTalkWebhookRouter(dependencies: DingTalkWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/dingtalk', async (context) => {
    const bindings = context.env ?? {};
    const timestamp = context.req.header('timestamp') ?? '';
    const signature = context.req.header('sign') ?? '';
    if (!/^\d{1,16}$/.test(timestamp) || !signature || Math.abs(now() - Number(timestamp)) > 60 * 60_000) {
      return context.json({ error: 'invalid_callback' }, 401);
    }

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('dingtalk', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matched: ChatAccountContext[] = [];
    for (const account of accounts) {
      const secret = credential(account, 'appSecret');
      if (!secret) continue;
      const expected = await hmacSha256Base64(secret, `${timestamp}\n${secret}`);
      if (safeEqual(expected, signature) || safeEqual(expected, safeDecode(signature))) matched.push(account);
    }
    if (matched.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matched[0];

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }
    let payload: DingTalkPayload;
    try {
      payload = JSON.parse(rawBody) as DingTalkPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    const message = normalizeDingTalkMessage(payload, account, now());
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
    return context.json({ errcode: 0, errmsg: 'ok' });
  });

  return router;
}
