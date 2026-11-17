import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendLineMedia, sendLineProactiveText, sendLineText } from './api';

function account(): ChatAccountContext {
  return {
    appId: '2000123456',
    protocol: 'line',
    credentials: { channelId: '2000123456', channelSecret: 'secret', channelAccessToken: 'line-token' },
    appSecret: 'secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'line', name: 'LINE', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };

describe('LINE API', () => {
  it('pushes text to the conversation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
    await sendLineText(account(), 'Cgroup', '1', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer line-token' });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ to: 'Cgroup', messages: [{ type: 'text', text: 'hello' }] });
  });

  it('sends proactive text through the same push API', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
    await sendLineProactiveText(account(), 'U42', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ to: 'U42', messages: [{ type: 'text', text: 'hi' }] });
  });

  it('reports that media needs public HTTPS URLs', async () => {
    await expect(sendLineMedia(account(), 'U42', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options)).rejects.toThrow('public HTTPS URLs');
  });
});
