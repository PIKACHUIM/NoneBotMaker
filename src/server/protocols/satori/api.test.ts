import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { satoriEventsUrl, sendSatoriMedia, sendSatoriProactiveText, sendSatoriText } from './api';

function account(): ChatAccountContext {
  return {
    appId: 'bot-1',
    protocol: 'satori',
    credentials: { endpoint: 'https://satori.example.com/', platform: 'onebot', selfId: 'bot-1', token: 'satori-token' },
    appSecret: 'satori-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'satori', name: 'Satori', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };

describe('Satori API', () => {
  it('derives the events WebSocket URL from the HTTP endpoint', () => {
    expect(satoriEventsUrl(account())).toBe('wss://satori.example.com/v1/events');
  });

  it('creates messages with platform headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]));
    await sendSatoriText(account(), 'channel-1', '', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://satori.example.com/v1/message.create');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer satori-token', 'satori-platform': 'onebot', 'satori-user-id': 'bot-1',
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ channel_id: 'channel-1', content: 'hello' });
  });

  it('sends proactive text and reports unsupported media', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]));
    await sendSatoriProactiveText(account(), 'channel-1', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ content: 'hi' });
    await expect(sendSatoriMedia(account(), 'channel-1', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options)).rejects.toThrow('not supported');
  });

  it('rejects unsupported endpoint schemes', () => {
    const unsafe = account();
    unsafe.credentials = { ...unsafe.credentials, endpoint: 'file:///etc/passwd' };
    expect(() => satoriEventsUrl(unsafe)).toThrow('endpoint is invalid');
  });
});
