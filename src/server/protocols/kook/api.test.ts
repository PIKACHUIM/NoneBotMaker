import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { getKookGatewayUrl, sendKookMedia, sendKookProactiveText, sendKookText } from './api';

function account(): ChatAccountContext {
  return {
    appId: '10001',
    protocol: 'kook',
    credentials: { botId: '10001', token: 'kook-token' },
    appSecret: 'kook-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'kook', name: 'KOOK', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };

describe('KOOK API', () => {
  it('reads a trusted gateway URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: { url: 'wss://ws.kookapp.cn/gateway' } }));
    expect(await getKookGatewayUrl(account(), fetchMock)).toBe('wss://ws.kookapp.cn/gateway');
    const unsafe = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: { url: 'wss://attacker.example/gateway' } }));
    await expect(getKookGatewayUrl(account(), unsafe)).rejects.toThrow('not trusted');
  });

  it('creates a kmarkdown message with the bot token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: { msg_id: '1' } }));
    await sendKookText(account(), 'channel-1', 'msg-1', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.kookapp.cn/api/v3/message/create');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bot kook-token' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ type: 9, target_id: 'channel-1', content: 'hello', quote: 'msg-1' });
  });

  it('uploads media and sends a markdown link', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 0, data: { url: 'https://img.kookapp.cn/a.png' } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { msg_id: '2' } }));
    await sendKookMedia(account(), 'channel-1', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.kookapp.cn/api/v3/asset/create');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).content).toContain('https://img.kookapp.cn/a.png');
  });

  it('sends proactive text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ code: 0, data: {} }));
    await sendKookProactiveText(account(), 'user-1', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ target_id: 'user-1', content: 'hi' });
  });
});
