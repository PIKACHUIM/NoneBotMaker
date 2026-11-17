import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeVkMessage, type VkPayload } from './message';

export interface VkWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createVkWebhookRouter(dependencies: VkWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/vk', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let payload: VkPayload;
    try {
      payload = JSON.parse(rawBody) as VkPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    const groupId = typeof payload.group_id === 'number' ? String(payload.group_id) : typeof payload.group_id === 'string' ? payload.group_id : '';
    if (!groupId) return context.json({ error: 'invalid_callback' }, 401);

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('vk', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matches = accounts.filter((candidate) => credential(candidate, 'groupId') === groupId);
    if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = matches[0];

    if (payload.type === 'confirmation') {
      const confirmation = credential(account, 'confirmationToken');
      if (!confirmation) return context.text('invalid', 403);
      return context.text(confirmation, 200);
    }

    const secret = credential(account, 'secret');
    const provided = typeof payload.secret === 'string' ? payload.secret : '';
    if (!secret || !provided || !safeEqual(secret, provided)) {
      return context.json({ error: 'invalid_signature' }, 401);
    }
    if (payload.type !== 'message_new') return context.text('ok', 200);

    const message = normalizeVkMessage(payload, account, now());
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
    return context.text('ok', 200);
  });

  return router;
}
