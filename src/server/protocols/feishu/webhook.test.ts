import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => {
  const account = {
    appId: 'cli_test',
    protocol: 'feishu',
    credentials: { appId: 'cli_test', appSecret: 'app-secret', verificationToken: 'verify-token', encryptKey: '' },
    appSecret: 'app-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'feishu', name: 'Feishu', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext;
  return { account, handleMessage: vi.fn(async () => undefined) };
});

vi.mock('../accounts', () => ({
  listChatAccounts: vi.fn(async () => [state.account]),
  resolveChatAccountByCredential: vi.fn(async () => state.account),
}));
vi.mock('./api', () => ({ getFeishuBotOpenId: vi.fn(async () => 'ou_bot') }));

import { decryptAesCbc, encryptAesCbc, sha256Hex } from '../crypto';
import { createFeishuWebhookRouter } from './webhook';

function app() {
  return createFeishuWebhookRouter({ handleMessage: state.handleMessage });
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return app().request('/webhook/feishu', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function messageEvent() {
  return {
    header: { event_id: 'event-1', event_type: 'im.message.receive_v1', app_id: 'cli_test', token: 'verify-token', create_time: '1700000000000' },
    event: {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_user' } },
      message: {
        message_id: 'om_1', chat_id: 'oc_1', chat_type: 'group', message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 hello bot' }), mentions: [{ id: { open_id: 'ou_bot' } }],
        create_time: '1700000000000',
      },
    },
  };
}

describe('Feishu webhook', () => {
  beforeEach(() => {
    state.handleMessage.mockClear();
    state.account.credentials.encryptKey = '';
  });

  it('answers URL verification with the challenge', async () => {
    const response = await request({ type: 'url_verification', challenge: 'abc', token: 'verify-token' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: 'abc' });
  });

  it('normalizes a plaintext message event and strips mention keys', async () => {
    state.handleMessage.mockClear();
    const response = await request(messageEvent());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'feishu' }),
      expect.objectContaining({ id: 'om_1', groupId: 'oc_1', userId: 'ou_user', text: 'hello bot', mentionsBot: true, conversationType: 'group' }),
      expect.anything(),
    );
  });

  it('decrypts encrypted events after verifying the signature', async () => {
    state.handleMessage.mockClear();
    const encryptKey = 'encrypt-key';
    state.account.credentials.encryptKey = encryptKey;
    const body = { encrypt: await encryptAesCbc(encryptKey, JSON.stringify(messageEvent())) };
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce';
    const signature = await sha256Hex(timestamp + nonce + encryptKey + raw);
    const response = await app().request('/webhook/feishu', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Lark-Request-Timestamp': timestamp,
        'X-Lark-Request-Nonce': nonce, 'X-Lark-Signature': signature,
      },
      body: raw,
    });
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: 'hello bot' }), expect.anything());
  });

  it('returns an encrypted challenge when encryption is enabled', async () => {
    const encryptKey = 'encrypt-key';
    state.account.credentials.encryptKey = encryptKey;
    const body = { encrypt: await encryptAesCbc(encryptKey, JSON.stringify({ type: 'url_verification', challenge: 'xyz', token: 'verify-token' })) };
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce';
    const signature = await sha256Hex(timestamp + nonce + encryptKey + raw);
    const response = await app().request('/webhook/feishu', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'X-Lark-Request-Timestamp': timestamp,
        'X-Lark-Request-Nonce': nonce, 'X-Lark-Signature': signature,
      },
      body: raw,
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { encrypt: string };
    expect(JSON.parse(await decryptAesCbc(encryptKey, result.encrypt))).toEqual({ challenge: 'xyz' });
  });

  it('rejects events with an unknown verification token', async () => {
    const payload = messageEvent();
    payload.header.token = 'wrong-token';
    const response = await request(payload);
    expect(response.status).toBe(401);
  });
});
