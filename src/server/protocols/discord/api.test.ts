import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendDiscordMedia, sendDiscordProactiveText, sendDiscordText } from './api';

function account(): ChatAccountContext {
  return {
    appId: '123456789012345678',
    protocol: 'discord',
    credentials: { botId: '123456789012345678', botToken: 'discord-token' },
    appSecret: 'discord-token',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'discord', name: 'Discord', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };

describe('Discord API', () => {
  it('posts text with reply metadata and disabled mentions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ id: '1' }));
    await sendDiscordText(account(), '8001', '9001', 'hello', options, fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/channels/8001/messages');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bot discord-token' });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      content: 'hello', allowed_mentions: { parse: [] }, message_reference: { message_id: '9001' },
    });
  });

  it('uploads media as multipart data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ id: '2' }));
    await sendDiscordMedia(account(), '8001', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options, fetchMock);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('files[0]')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(form.get('payload_json')))).toMatchObject({ content: '' });
  });

  it('rejects invalid channel ids', async () => {
    await expect(sendDiscordProactiveText(account(), 'not-a-channel', 'hi', vi.fn<typeof fetch>())).rejects.toThrow('channel id');
  });
});
