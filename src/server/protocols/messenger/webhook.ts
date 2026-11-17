import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Hex, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeMessengerEvent, type MessengerEntry, type MessengerEvent, type MessengerPayload } from './message';

export interface MessengerWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createMessengerWebhookRouter(dependencies: MessengerWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.get('/webhook/messenger', async (context) => {
    const mode = context.req.query('hub.mode');
    const token = context.req.query('hub.verify_token') ?? '';
    const challenge = context.req.query('hub.challenge') ?? '';
    if (mode !== 'subscribe' || !token) return context.text('forbidden', 403);
    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('messenger', context.env ?? {})).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.text('storage unavailable', 503);
    }
    const matches = accounts.filter((candidate) => {
      const expected = credential(candidate, 'verifyToken');
      return Boolean(expected) && safeEqual(expected, token);
    });
    if (matches.length !== 1) return context.text('forbidden', 403);
    return context.text(challenge, 200);
  });

  router.post('/webhook/messenger', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let payload: MessengerPayload;
    try {
      payload = JSON.parse(rawBody) as MessengerPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (payload.object !== 'page' || !Array.isArray(payload.entry)) return context.json({ ok: true });

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('messenger', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const signature = (context.req.header('x-hub-signature-256') ?? '').replace(/^sha256=/i, '');

    const accepted: Array<{ account: ChatAccountContext; entry: MessengerEntry }> = [];
    for (const rawEntry of (payload.entry as unknown[]).slice(0, 10)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as MessengerEntry;
      const pageId = typeof entry.id === 'string' ? entry.id : '';
      const account = accounts.find((candidate) => credential(candidate, 'pageId') === pageId);
      if (!account) continue;
      const appSecret = credential(account, 'appSecret');
      const expected = appSecret ? await hmacSha256Hex(appSecret, rawBody) : '';
      if (!expected || !signature || !safeEqual(expected, signature)) return context.json({ error: 'invalid_signature' }, 401);
      accepted.push({ account, entry });
    }
    if (!accepted.length) return context.json({ error: 'invalid_callback' }, 401);

    for (const { account, entry } of accepted) {
      const events = Array.isArray(entry.messaging) ? entry.messaging as MessengerEvent[] : [];
      for (const event of events.slice(0, 50)) {
        const message = normalizeMessengerEvent(event, account, now());
        if (!message) continue;
        const key = `${account.account.id}:${message.eventId ?? message.id}`;
        for (const [id, item] of recent) if (now() - item.at > 10 * 60_000) recent.delete(id);
        const previous = recent.get(key);
        if (previous) {
          await previous.processing;
          continue;
        }
        if (recent.size >= 2000) return context.json({ error: 'queue_full' }, 503);
        const processing = dependencies.handleMessage(account, message, bindings);
        recent.set(key, { at: now(), processing });
        try {
          await processing;
        } catch (error) {
          recent.delete(key);
          throw error;
        }
      }
    }
    return context.json({ ok: true });
  });

  return router;
}
