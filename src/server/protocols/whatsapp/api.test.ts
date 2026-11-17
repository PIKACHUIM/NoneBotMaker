import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendWhatsAppMedia, sendWhatsAppProactiveText, sendWhatsAppText } from './api';

function account(): ChatAccountContext {
  return {
    appId: '1029384756',
    protocol: 'whatsapp',
    credentials: { phoneNumberId: '1029384756', accessToken: 'graph-token', appSecret: 'app-secret', verifyToken: 'verify' },
    appSecret: 'app-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'whatsapp', name: 'WhatsApp', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'private' as const };

describe('WhatsApp API', () => {
  it('sends text through the Graph API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: 'wamid.1' }] }));
    await sendWhatsAppText(account(), '15551234567', '', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1029384756/messages');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer graph-token' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      messaging_product: 'whatsapp', to: '15551234567', type: 'text', text: { body: 'hello' },
    });
  });

  it('uploads media before sending it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'media-1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.2' }] }));
    await sendWhatsAppMedia(account(), '15551234567', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/1029384756/media');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      type: 'image', image: { id: 'media-1', caption: 'a.png' },
    });
  });

  it('sends proactive text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [] }));
    await sendWhatsAppProactiveText(account(), '15551234567', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ to: '15551234567', text: { body: 'hi' } });
  });
});
