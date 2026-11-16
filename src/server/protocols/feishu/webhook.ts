import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts, resolveChatAccountByCredential } from '../accounts';
import { decryptAesCbc, encryptAesCbc, safeEqual, sha256Hex } from '../crypto';
import { readWebhookBody, WebhookBodyError } from '../http';
import { getFeishuBotOpenId } from './api';
import { normalizeFeishuMessage, type FeishuPayload } from './message';

export interface FeishuWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

async function verifySignature(
  account: ChatAccountContext,
  rawBody: string,
  headers: Headers,
  now: () => number,
): Promise<boolean> {
  const encryptKey = credential(account, 'encryptKey');
  if (!encryptKey) return true;
  const timestamp = headers.get('X-Lark-Request-Timestamp') ?? '';
  const nonce = headers.get('X-Lark-Request-Nonce') ?? '';
  const signature = headers.get('X-Lark-Signature') ?? '';
  if (!/^\d{1,12}$/.test(timestamp) || !nonce || !signature) return false;
  if (Math.abs(now() - Number(timestamp) * 1000) > 5 * 60_000) return false;
  return safeEqual(await sha256Hex(timestamp + nonce + encryptKey + rawBody), signature.toLowerCase());
}

export function createFeishuWebhookRouter(dependencies: FeishuWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.post('/webhook/feishu', async (context) => {
    const bindings = context.env ?? {};
    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }
    let payload: FeishuPayload;
    try {
      payload = JSON.parse(rawBody) as FeishuPayload;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return context.json({ error: 'invalid_payload' }, 400);

    let accounts: ChatAccountContext[];
    try {
      accounts = (await listChatAccounts('feishu', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
    let account: ChatAccountContext | undefined;
    let decryptKey = '';
    if (typeof payload.encrypt === 'string') {
      const matches: Array<{ account: ChatAccountContext; payload: FeishuPayload; key: string }> = [];
      for (const candidate of accounts) {
        const key = credential(candidate, 'encryptKey');
        if (!key) continue;
        try {
          const decrypted = JSON.parse(await decryptAesCbc(key, payload.encrypt)) as FeishuPayload;
          const token = typeof decrypted.header?.token === 'string' ? decrypted.header.token : typeof decrypted.token === 'string' ? decrypted.token : '';
          if (!token || !safeEqual(token, credential(candidate, 'verificationToken'))) continue;
          matches.push({ account: candidate, payload: decrypted, key });
        } catch { /* try the next account */ }
      }
      if (matches.length !== 1) return context.json({ error: 'invalid_callback' }, 401);
      account = matches[0].account;
      payload = matches[0].payload;
      decryptKey = matches[0].key;
    } else {
      const appId = typeof payload.header?.app_id === 'string' ? payload.header.app_id : '';
      if (appId) {
        try {
          account = await resolveChatAccountByCredential('feishu', appId, bindings) ?? undefined;
        } catch {
          return context.json({ error: 'storage_unavailable' }, 503);
        }
      } else {
        const token = typeof payload.token === 'string' ? payload.token : typeof payload.header?.token === 'string' ? payload.header.token : '';
        const matches = accounts.filter((candidate) => token && safeEqual(token, credential(candidate, 'verificationToken')));
        if (matches.length === 1) account = matches[0];
      }
      if (!account) return context.json({ error: 'invalid_callback' }, 401);
    }

    if (!(await verifySignature(account, rawBody, context.req.raw.headers, now))) {
      return context.json({ error: 'invalid_signature' }, 401);
    }
    const callbackToken = typeof payload.header?.token === 'string' ? payload.header.token : typeof payload.token === 'string' ? payload.token : '';
    if (!callbackToken || !safeEqual(callbackToken, credential(account, 'verificationToken'))) {
      return context.json({ error: 'invalid_callback' }, 401);
    }

    if (payload.type === 'url_verification') {
      const challenge = typeof payload.challenge === 'string' ? payload.challenge : '';
      if (!challenge) return context.json({ error: 'invalid_challenge' }, 400);
      if (decryptKey) return context.json({ encrypt: await encryptAesCbc(decryptKey, JSON.stringify({ challenge })) });
      return context.json({ challenge });
    }

    const botOpenId = await getFeishuBotOpenId(account).catch(() => '');
    const message = normalizeFeishuMessage(payload, account, now(), botOpenId);
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
    return context.json({ code: 0 });
  });

  return router;
}
