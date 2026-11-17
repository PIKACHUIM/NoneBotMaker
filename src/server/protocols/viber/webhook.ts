import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Hex, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeViberMessage, type ViberPayload } from './message';

export interface ViberWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createViberWebhookRouter(dependencies: ViberWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/viber', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    const signature = (context.req.header('x-viber-content-signature') ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(signature)) return context.json({ error: 'invalid_callback' }, 401);

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('viber', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matches: ChatAccountContext[] = [];
    for (const candidate of accounts) {
      const token = credential(candidate, 'authToken');
      if (!token) continue;
      if (safeEqual(await hmacSha256Hex(token, rawBody), signature)) matches.push(candidate);
    }
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    let payload: ViberPayload;
    try {
      payload = JSON.parse(rawBody) as ViberPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (payload.event !== 'message') return context.json({ status: 0 });

    const message = normalizeViberMessage(payload, account, now());
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
    return context.json({ status: 0 });
  });

  return router;
}
