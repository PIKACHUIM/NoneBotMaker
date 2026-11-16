import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendOneBotMedia, sendOneBotProactiveText, sendOneBotText } from './api';

function account(): ChatAccountContext {
  return {
    appId: '10001',
    protocol: 'onebot',
    credentials: { selfId: '10001', apiBaseUrl: 'https://onebot.example', accessToken: 'api-token', secret: '' },
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'onebot', name: 'OneBot', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const ok = vi.fn<typeof fetch>(async () => Response.json({ status: 'ok', retcode: 0 }));

describe('OneBot API', () => {
  it('sends group text with the access token and message segment', async () => {
    await sendOneBotText(account(), '555', '9001', 'hello', { seq: 1, conversationType: 'group' }, ok);
    expect(ok).toHaveBeenCalledWith('https://onebot.example/send_group_msg', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer api-token' }),
      body: JSON.stringify({ group_id: '555', message: [{ type: 'text', data: { text: 'hello' } }] }),
    }));
  });

  it('sends media as base64 segments', async () => {
    ok.mockClear();
    await sendOneBotMedia(account(), '555', '9001', {
      type: 'image', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', filename: 'a.png',
    }, { seq: 1, conversationType: 'group' }, ok);
    const body = JSON.parse(String((ok.mock.calls[0][1] as RequestInit).body));
    expect(body.message).toEqual([{ type: 'image', data: { file: 'base64://AQID' } }]);
  });

  it('uses send_private_msg for private proactive messages', async () => {
    ok.mockClear();
    await sendOneBotProactiveText(account(), '777', 'private', 'hi', ok);
    expect(ok).toHaveBeenCalledWith('https://onebot.example/send_private_msg', expect.objectContaining({
      body: JSON.stringify({ user_id: '777', message: [{ type: 'text', data: { text: 'hi' } }] }),
    }));
  });
});
