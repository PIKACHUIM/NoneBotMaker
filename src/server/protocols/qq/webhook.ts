import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { QQAccountContext, QQGroupMessage } from './types';
import { normalizeQQGroupMessage } from './message';
import { signWebhookChallenge, verifyWebhookSignature } from './signature';

const MAX_WEBHOOK_BODY_BYTES = 1_048_576;
const ACK = { op: 12 } as const;

export interface QQWebhookDependencies {
  resolveAccount(appId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null>;
  handleMessage(account: QQAccountContext, message: QQGroupMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

export function createQQWebhookRouter(dependencies: QQWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/qq', async (context) => {
    const bindings = context.env ?? {};
    const method = bindings.API_METHOD ?? 'webhook';
    if (method !== 'webhook') {
      const unsupportedPlatform = method === 'websocket' && bindings.PLATFORM !== 'cloudflare';
      return unsupportedPlatform
        ? context.json({ error: 'websocket_unsupported' }, 503)
        : context.json({ error: 'webhook_disabled' }, 404);
    }

    const appId = context.req.header('X-Bot-Appid');
    if (!appId) return context.json({ error: 'invalid callback' }, 401);

    const account = await dependencies.resolveAccount(appId, bindings);
    const appSecret = account?.appSecret ?? account?.botSecret;
    if (!account || account.appId !== appId || !appSecret) {
      return context.json({ error: 'invalid callback' }, 401);
    }

    const contentType = context.req.header('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return context.json({ error: 'invalid callback' }, 415);
    }
    const contentLength = Number(context.req.header('content-length') ?? 0);
    if (contentLength > MAX_WEBHOOK_BODY_BYTES) return context.json({ error: 'invalid callback' }, 413);

    const reader = context.req.raw.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_WEBHOOK_BODY_BYTES) { await reader.cancel(); return context.json({ error: 'invalid callback' }, 413); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    if (body.length === 0 || body.length > MAX_WEBHOOK_BODY_BYTES) {
      return context.json({ error: 'invalid callback' }, 400);
    }

    let payload: QQWebhookPayload;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as QQWebhookPayload;
    } catch {
      return context.json({ error: 'invalid callback' }, 400);
    }
    if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.op)) {
      return context.json({ error: 'invalid callback' }, 400);
    }

    if (payload.op === 13) {
      const challenge = payload.d as { event_ts?: unknown; plain_token?: unknown } | undefined;
      if (
        !challenge ||
        typeof challenge.event_ts !== 'string' ||
        !/^\d{1,20}$/.test(challenge.event_ts) ||
        typeof challenge.plain_token !== 'string' ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(challenge.plain_token)
      ) {
        return context.json({ error: 'invalid callback' }, 400);
      }
      const signature = await signWebhookChallenge(appSecret, challenge.event_ts, challenge.plain_token);
      return context.json({ plain_token: challenge.plain_token, signature });
    }

    if (payload.op !== 0) return context.json({ error: 'invalid callback' }, 400);
    const timestamp = context.req.header('X-Signature-Timestamp');
    const signature = context.req.header('X-Signature-Ed25519');
    if (
      !timestamp ||
      !signature ||
      !/^\d{1,12}$/.test(timestamp) ||
      Math.abs(now() - Number(timestamp) * 1000) > 5 * 60_000 ||
      !(await verifyWebhookSignature(appSecret, timestamp, body, signature))
    ) {
      return context.json({ error: 'invalid callback' }, 401);
    }

    const message = normalizeQQGroupMessage(payload, account, now());
    if (message) {
      if (bindings.PLATFORM === 'cloudflare') {
        const namespace = bindings.QQ_GATEWAY_SESSIONS as {
          idFromName(name: string): unknown;
          get(id: unknown): { fetch(request: Request): Promise<Response> };
        } | undefined;
        if (!namespace) return context.json({ error: 'queue_unavailable' }, 503);
        const response = await namespace.get(namespace.idFromName(account.account.id)).fetch(new Request('https://qq-gateway.internal/enqueue', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId: account.account.id, message }),
          signal: AbortSignal.timeout(5_000),
        }));
        if (!response.ok) return context.json({ error: 'queue_unavailable' }, 503);
      } else {
        for (const [key, entry] of recent) if (now() - entry.at > 10 * 60_000) recent.delete(key);
        const key = `${account.account.id}:${message.eventId ?? message.id}`;
        const previous = recent.get(key);
        if (previous) await previous.processing;
        else {
          if (recent.size >= 2000) return context.json({ error: 'queue_full' }, 503);
          const processing = dependencies.handleMessage(account, message, bindings);
          recent.set(key, { at: now(), processing });
          try { await processing; } catch (error) { recent.delete(key); throw error; }
        }
      }
    }
    return context.json(ACK);
  });

  return router;
}

interface QQWebhookPayload {
  op?: number;
  t?: string;
  id?: string;
  d?: unknown;
}
