import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { getTelegramBotIdentity } from './api';
import { normalizeTelegramMessage, type TelegramUpdate } from './message';

export interface TelegramWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createTelegramWebhookRouter(dependencies: TelegramWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/telegram', async (context) => {
    const bindings = context.env ?? {};
    const secret = context.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!secret) return context.json({ error: 'invalid_callback' }, 401);

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('telegram', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matches = accounts.filter((candidate) => {
      const expected = credential(candidate, 'secretToken');
      return expected && safeEqual(expected, secret);
    });
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }
    let update: TelegramUpdate;
    try {
      update = JSON.parse(rawBody) as TelegramUpdate;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    const bot = await getTelegramBotIdentity(account).catch(() => ({ id: account.appId, username: '', name: '' }));
    const message = normalizeTelegramMessage(update, account, now(), bot);
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
