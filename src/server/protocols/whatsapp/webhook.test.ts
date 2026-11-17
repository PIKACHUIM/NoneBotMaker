import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { hmacSha256Hex } from '../crypto';

const state = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  account: {
    appId: '1029384756',
    protocol: 'whatsapp',
    credentials: { phoneNumberId: '1029384756', accessToken: 'graph-token', appSecret: 'app-secret', verifyToken: 'verify-me' },
    appSecret: 'app-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'whatsapp', name: 'WhatsApp', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { createWhatsAppWebhookRouter } from './webhook';

function payload(overrides: { phoneNumberId?: string; text?: string } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: overrides.phoneNumberId ?? '1029384756' },
          contacts: [{ profile: { name: 'Alice' }, wa_id: '15551234567' }],
          messages: [{ from: '15551234567', id: 'wamid.1', timestamp: '1800000000', type: 'text', text: { body: overrides.text ?? 'hello' } }],
        },
      }],
    }],
  };
}

async function post(body: unknown, secret = 'app-secret') {
  const raw = JSON.stringify(body);
  const signature = `sha256=${await hmacSha256Hex(secret, raw)}`;
  return createWhatsAppWebhookRouter({ handleMessage: state.handleMessage, now: () => state.now }).request('/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': signature },
    body: raw,
  });
}

function router() {
  return createWhatsAppWebhookRouter({ handleMessage: state.handleMessage, now: () => state.now });
}

describe('WhatsApp webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('answers GET verification with the stored verify token', async () => {
    const ok = await router().request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    const wrong = await router().request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=other&hub.challenge=12345');
    expect(wrong.status).toBe(403);
  });

  it('verifies the payload signature and normalizes a direct message', async () => {
    const response = await post(payload());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'whatsapp' }),
      expect.objectContaining({
        id: 'wamid.1', groupId: '15551234567', userId: '15551234567', userName: 'Alice',
        text: 'hello', mentionsBot: true, conversationType: 'private', eventId: 'whatsapp:wamid.1',
      }),
      expect.anything(),
    );
  });

  it('rejects bad signatures and unknown receiving numbers', async () => {
    expect((await post(payload(), 'wrong')).status).toBe(401);
    expect((await post(payload({ phoneNumberId: '9999999999' }))).status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('ignores delivery status callbacks', async () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1029384756' }, statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }],
    };
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
