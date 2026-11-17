import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { hmacSha256Hex, safeEqual } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { normalizeWhatsAppPayload, whatsappPhoneNumberId, type WhatsAppWebhookPayload } from './message';

export interface WhatsAppWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function createWhatsAppWebhookRouter(dependencies: WhatsAppWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.get('/webhook/whatsapp', async (context) => {
    const bindings = context.env ?? {};
    const mode = context.req.query('hub.mode') ?? '';
    const token = context.req.query('hub.verify_token') ?? '';
    const challenge = context.req.query('hub.challenge') ?? '';
    if (mode !== 'subscribe' || !token) return context.json({ error: 'invalid_callback' }, 403);
    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('whatsapp', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    const matched = accounts.some((candidate) => {
      const expected = credential(candidate, 'verifyToken');
      return Boolean(expected) && safeEqual(expected, token);
    });
    return matched ? context.text(challenge, 200) : context.json({ error: 'invalid_callback' }, 403);
  });

  router.post('/webhook/whatsapp', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.header('X-Hub-Signature-256') ?? '';
    if (!signature.startsWith('sha256=')) return context.json({ error: 'invalid_callback' }, 401);

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('whatsapp', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }

    const signed: ChatAccountContext[] = [];
    for (const candidate of accounts) {
      const secret = credential(candidate, 'appSecret');
      if (!secret) continue;
      if (safeEqual(`sha256=${await hmacSha256Hex(secret, rawBody)}`, signature)) signed.push(candidate);
    }
    if (!signed.length) return context.json({ error: 'invalid_callback' }, 401);

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    const receivingId = whatsappPhoneNumberId(payload);
    const candidates = receivingId
      ? signed.filter((candidate) => (credential(candidate, 'phoneNumberId') || candidate.appId) === receivingId)
      : signed;
    if (candidates.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
    const account = candidates[0];
    const batch = normalizeWhatsAppPayload(payload, account, now());

    for (const message of batch.messages) {
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
