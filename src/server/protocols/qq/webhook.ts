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
    if (!account || account.appId !== appId || !account.botSecret) {
      return context.json({ error: 'invalid callback' }, 401);
    }

    const contentType = context.req.header('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return context.json({ error: 'invalid callback' }, 415);
    }
    const contentLength = Number(context.req.header('content-length') ?? 0);
    if (contentLength > MAX_WEBHOOK_BODY_BYTES) return context.json({ error: 'invalid callback' }, 413);

    const body = new Uint8Array(await context.req.arrayBuffer());
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
        challenge.plain_token.length === 0 ||
        challenge.plain_token.length > 256
      ) {
        return context.json({ error: 'invalid callback' }, 400);
      }
      const signature = await signWebhookChallenge(account.botSecret, challenge.event_ts, challenge.plain_token);
      return context.json({ plain_token: challenge.plain_token, signature });
    }

    if (payload.op !== 0) return context.json({ error: 'invalid callback' }, 400);
    const timestamp = context.req.header('X-Signature-Timestamp');
    const signature = context.req.header('X-Signature-Ed25519');
    if (
      !timestamp ||
      !signature ||
      !(await verifyWebhookSignature(account.botSecret, timestamp, body, signature))
    ) {
      return context.json({ error: 'invalid callback' }, 401);
    }

    const message = normalizeQQGroupMessage(payload, account, now());
    if (message) await dependencies.handleMessage(account, message, bindings);
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
