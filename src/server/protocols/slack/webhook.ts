import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Hex, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeSlackEvent, type SlackEventPayload } from './message';

export interface SlackWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

const MAX_CLOCK_SKEW_SECONDS = 300;

export function createSlackWebhookRouter(dependencies: SlackWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/slack', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.header('X-Slack-Signature') ?? '';
    const timestamp = context.req.header('X-Slack-Request-Timestamp') ?? '';
    if (!signature.startsWith('v0=') || !/^\d{1,12}$/.test(timestamp)) {
      return context.json({ error: 'invalid_callback' }, 401);
    }
    if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      return context.json({ error: 'stale_callback' }, 401);
    }

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('slack', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }

    const signed = `v0:${timestamp}:${rawBody}`;
    const matches: ChatAccountContext[] = [];
    for (const candidate of accounts) {
      const secret = credential(candidate, 'signingSecret');
      if (!secret) continue;
      if (safeEqual(`v0=${await hmacSha256Hex(secret, signed)}`, signature)) matches.push(candidate);
    }
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    let payload: SlackEventPayload;
    try {
      payload = JSON.parse(rawBody) as SlackEventPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    if (payload.type === 'url_verification') {
      return context.json({ challenge: typeof payload.challenge === 'string' ? payload.challenge : '' });
    }
    if (payload.type !== 'event_callback') return context.json({ ok: true });
    if (payload.api_app_id !== undefined && payload.api_app_id !== account.appId) {
      return context.json({ error: 'invalid_callback' }, 401);
    }

    const message = normalizeSlackEvent(payload, account, now());
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
    return context.json({ ok: true });
  });

  return router;
}
