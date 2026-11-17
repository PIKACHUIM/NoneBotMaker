import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeRocketChatMessage, type RocketChatPayload } from './message';

export interface RocketChatWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createRocketChatWebhookRouter(dependencies: RocketChatWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/rocketchat', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let payload: RocketChatPayload;
    try {
      payload = JSON.parse(rawBody) as RocketChatPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    const token = typeof payload.token === 'string' ? payload.token : '';
    if (!token) return context.json({ error: 'invalid_callback' }, 401);

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('rocketchat', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matches = accounts.filter((candidate) => {
      const expected = credential(candidate, 'token');
      return Boolean(expected) && safeEqual(expected, token);
    });
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    const message = normalizeRocketChatMessage(payload, account, now());
    if (message) {
      const key = `${account.account.id}:${message.eventId ?? message.id}`;
      for (const [id, item] of recent) if (now() - item.at > 10 * 60_000) recent.delete(id);
      const previous = recent.get(key);
      if (previous) {
        await previous.processing;
      } else {
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
