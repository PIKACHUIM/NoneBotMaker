import { describe, expect, it, vi } from 'vitest';
import type { QQAccountContext, QQGroupMessage } from './types';
import { signWebhookChallenge } from './signature';
import { createQQWebhookRouter } from './webhook';

const account: QQAccountContext = {
  appId: '11111111',
  botSecret: 'DG5g3B4j9X2KOErG',
  clientSecret: 'client-secret',
  pluginEnabled: true,
  account: {
    id: 'account-1',
    pluginId: 'plugin-1',
    protocol: 'qq',
    name: 'QQ Bot',
    enabled: true,
    credentials: {},
    config: {},
    createdAt: '',
    updatedAt: '',
  },
};

describe('QQ webhook', () => {
  it('signs the official callback challenge using the Bot Secret seed', async () => {
    const signature = await signWebhookChallenge('DG5g3B4j9X2KOErG', '1725442341', 'Arq0D5A61EgUu4OxUvOp');
    expect(signature).toBe(
      '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706',
    );
  });

  it('returns the signed plain_token challenge response', async () => {
    const router = createQQWebhookRouter({
      resolveAccount: async () => account,
      handleMessage: vi.fn(async () => undefined),
    });
    const response = await router.request('/webhook/qq', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Bot-Appid': account.appId },
      body: JSON.stringify({ op: 13, d: { event_ts: '1725442341', plain_token: 'Arq0D5A61EgUu4OxUvOp' } }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plain_token: 'Arq0D5A61EgUu4OxUvOp',
      signature:
        '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706',
    });
  });

  it('rejects websocket mode on non-Cloudflare platforms', async () => {
    const resolveAccount = vi.fn(async () => account);
    const router = createQQWebhookRouter({
      resolveAccount,
      handleMessage: vi.fn(async () => undefined),
    });
    const response = await router.request(
      '/webhook/qq',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { API_METHOD: 'websocket', PLATFORM: 'edgeone' },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'websocket_unsupported' });
    expect(resolveAccount).not.toHaveBeenCalled();
  });

  it('requires a valid Ed25519 signature before dispatching an event', async () => {
    const handleMessage = vi.fn(async (_account: QQAccountContext, _message: QQGroupMessage) => undefined);
    const router = createQQWebhookRouter({ resolveAccount: async () => account, handleMessage });
    const body = JSON.stringify({
      op: 0,
      id: 'event-1',
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'message-1',
        group_openid: 'group-1',
        content: 'hello',
        author: { member_openid: 'member-1', username: 'Member' },
      },
    });
    const timestamp = '1725442341';
    const signature = await signWebhookChallenge(account.botSecret, timestamp, body);
    const headers = {
      'content-type': 'application/json',
      'X-Bot-Appid': account.appId,
      'X-Signature-Timestamp': timestamp,
      'X-Signature-Ed25519': signature,
    };

    const accepted = await router.request('/webhook/qq', { method: 'POST', headers, body });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ op: 12 });
    expect(handleMessage).toHaveBeenCalledWith(
      account,
      expect.objectContaining({ groupId: 'group-1', userId: 'member-1', mentionsBot: true }),
      {},
    );

    const rejected = await router.request('/webhook/qq', { method: 'POST', headers, body: `${body} ` });
    expect(rejected.status).toBe(401);
    expect(handleMessage).toHaveBeenCalledOnce();
  });
});
