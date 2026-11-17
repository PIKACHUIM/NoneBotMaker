import { Hono } from 'hono';
import type { RuntimeBindings } from '../../../shared/types';
import type { ChatAccountContext, ChatPlatformMessage } from '../types';
import { listChatAccounts } from '../accounts';
import { readWebhookBody, xmlValue, WebhookBodyError } from '../http';
import { decryptWeCom, verifyWeComSignature } from './crypto';
import { normalizeWeComMessage } from './message';

export interface WeComWebhookDependencies {
  handleMessage(account: ChatAccountContext, message: ChatPlatformMessage, bindings: RuntimeBindings): Promise<void>;
  now?: () => number;
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

async function enabledAccounts(bindings: RuntimeBindings): Promise<ChatAccountContext[]> {
  return (await listChatAccounts('wecom', bindings)).filter((candidate) => candidate.account.enabled && candidate.pluginEnabled);
}

export function createWeComWebhookRouter(dependencies: WeComWebhookDependencies) {
  const router = new Hono<{ Bindings: RuntimeBindings }>();
  const now = dependencies.now ?? Date.now;
  const recent = new Map<string, { at: number; processing: Promise<void> }>();

  router.get('/webhook/wecom', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.query('msg_signature') ?? '';
    const timestamp = context.req.query('timestamp') ?? '';
    const nonce = context.req.query('nonce') ?? '';
    const echo = context.req.query('echostr') ?? '';
    if (!signature || !timestamp || !nonce || !echo) return context.text('invalid callback', 403);

    let accounts: ChatAccountContext[];
    try {
      accounts = await enabledAccounts(bindings);
    } catch {
      return context.text('storage unavailable', 503);
    }
    for (const account of accounts) {
      const token = credential(account, 'token');
      const encodingKey = credential(account, 'encodingAESKey');
      const corpId = credential(account, 'corpId') || account.appId;
      if (!token || !encodingKey || !corpId) continue;
      if (!await verifyWeComSignature(token, timestamp, nonce, echo, signature)) continue;
      try {
        return context.text(await decryptWeCom(encodingKey, echo, corpId), 200);
      } catch {
        return context.text('invalid callback', 403);
      }
    }
    return context.text('invalid callback', 403);
  });

  router.post('/webhook/wecom', async (context) => {
    const bindings = context.env ?? {};
    const signature = context.req.query('msg_signature') ?? '';
    const timestamp = context.req.query('timestamp') ?? '';
    const nonce = context.req.query('nonce') ?? '';
    if (!signature || !timestamp || !nonce) return context.text('invalid callback', 401);

    let rawBody: string;
    try {
      rawBody = await readWebhookBody(context.req.raw);
    } catch (error) {
      if (error instanceof WebhookBodyError) return context.json({ error: error.code }, error.status);
      throw error;
    }
    const encrypted = xmlValue(rawBody, 'Encrypt');
    if (!encrypted) return context.text('invalid callback', 400);

    let accounts: ChatAccountContext[];
    try {
      accounts = await enabledAccounts(bindings);
    } catch {
      return context.text('storage unavailable', 503);
    }

    const matches: Array<{ account: ChatAccountContext; xml: string }> = [];
    for (const account of accounts) {
      const token = credential(account, 'token');
      const encodingKey = credential(account, 'encodingAESKey');
      const corpId = credential(account, 'corpId') || account.appId;
      if (!token || !encodingKey || !corpId) continue;
      if (!await verifyWeComSignature(token, timestamp, nonce, encrypted, signature)) continue;
      try {
        matches.push({ account, xml: await decryptWeCom(encodingKey, encrypted, corpId) });
      } catch {
        // Signature matched another account; decryption failure means it is not this one.
      }
    }
    if (matches.length !== 1) return context.text('invalid callback', 401);
    const { account, xml } = matches[0];

    const message = normalizeWeComMessage(xml, account, now());
    if (message) {
      const key = `${account.account.id}:${message.eventId ?? message.id}`;
      for (const [id, entry] of recent) if (now() - entry.at > 10 * 60_000) recent.delete(id);
      const previous = recent.get(key);
      if (previous) {
        await previous.processing;
      } else {
        if (recent.size >= 2000) return context.text('busy', 503);
        const processing = dependencies.handleMessage(account, message, bindings);
        recent.set(key, { at: now(), processing });
        try { await processing; } catch (error) { recent.delete(key); throw error; }
      }
    }
    return context.text('success', 200);
  });

  return router;
}
