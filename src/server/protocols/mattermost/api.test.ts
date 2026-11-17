import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendMattermostMedia, sendMattermostProactiveText, sendMattermostText } from './api';

function account(): ChatAccountContext {
  return {
    appId: 'https://mm.example.com',
    protocol: 'mattermost',
    credentials: { baseUrl: 'https://mm.example.com', token: 'hook-token', accessToken: 'bot-token' },
    appSecret: 'hook-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'mattermost', name: 'Mattermost', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };

describe('Mattermost API', () => {
  it('creates a post with the bot token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ id: 'post-1' }));
    await sendMattermostText(account(), 'channel-1', '', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mm.example.com/api/v4/posts');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer bot-token' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ channel_id: 'channel-1', message: 'hello' });
  });

  it('uploads a file before attaching it to a post', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ file_infos: [{ id: 'file-1' }] }))
      .mockResolvedValueOnce(Response.json({ id: 'post-2' }));
    await sendMattermostMedia(account(), 'channel-1', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://mm.example.com/api/v4/files');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ channel_id: 'channel-1', file_ids: ['file-1'] });
  });

  it('sends proactive text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ id: 'post-3' }));
    await sendMattermostProactiveText(account(), 'channel-1', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ channel_id: 'channel-1', message: 'hi' });
  });
});
