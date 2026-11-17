import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendSlackMedia, sendSlackProactiveText, sendSlackText } from './api';

function account(): ChatAccountContext {
  return {
    appId: 'A0123456789',
    protocol: 'slack',
    credentials: { appId: 'A0123456789', botToken: 'xoxb-test', signingSecret: 'signing' },
    appSecret: 'signing',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'slack', name: 'Slack', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };
const media = { type: 'image' as const, bytes: new Uint8Array([1, 2]), contentType: 'image/png', filename: 'a.png' };

describe('Slack API', () => {
  it('posts text with the bot token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    await sendSlackText(account(), 'C123', '1.0', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer xoxb-test' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ channel: 'C123', text: 'hello', unfurl_links: false });
  });

  it('uploads media through the external upload flow', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, upload_url: 'https://files.slack.com/upload/v1/abc', file_id: 'F1' }))
      .mockResolvedValueOnce(new Response('OK'))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await sendSlackMedia(account(), 'C123', '', media, options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://files.slack.com/upload/v1/abc');
    expect(fetchMock.mock.calls[2][0]).toBe('https://slack.com/api/files.completeUploadExternal');
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toMatchObject({ files: [{ id: 'F1', title: 'a.png' }], channel_id: 'C123' });
  });

  it('rejects upload URLs that do not belong to Slack', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, upload_url: 'https://attacker.example/upload', file_id: 'F1' }));
    await expect(sendSlackMedia(account(), 'C123', '', media, options, fetchMock)).rejects.toThrow('not trusted');
  });

  it('sends proactive text without a reply target', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    await sendSlackProactiveText(account(), 'C123', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ channel: 'C123', text: 'hi' });
  });
});
