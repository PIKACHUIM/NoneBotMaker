import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { sendWeComMedia, sendWeComProactiveText, sendWeComText } from './api';

function account(corpId = 'ww1234567890abcdef'): ChatAccountContext {
  return {
    appId: corpId,
    protocol: 'wecom',
    credentials: {
      corpId,
      agentId: '1000002',
      secret: 'app-secret',
      token: 'callback-token',
      encodingAESKey: 'a'.repeat(43),
    },
    appSecret: 'app-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'wecom', name: 'WeCom', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'private' as const };

describe('WeCom API', () => {
  it('caches the access token and sends text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ errcode: 0, access_token: 'token-1', expires_in: 7200 }));
    await sendWeComText(account('wwtext000001'), 'zhangsan', '', 'hello', options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/cgi-bin/gettoken');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/cgi-bin/message/send?access_token=token-1');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      touser: 'zhangsan', agentid: 1000002, msgtype: 'text', text: { content: 'hello' },
    });
  });

  it('uploads media and sends it by media id', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errcode: 0, access_token: 'token-2', expires_in: 7200 }))
      .mockResolvedValueOnce(Response.json({ errcode: 0, media_id: 'media-1' }))
      .mockResolvedValueOnce(Response.json({ errcode: 0 }));
    await sendWeComMedia(account('wwmedia000001'), 'zhangsan', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, options, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/cgi-bin/media/upload');
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toMatchObject({
      msgtype: 'image', image: { media_id: 'media-1' },
    });
  });

  it('sends proactive text', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errcode: 0, access_token: 'token-3', expires_in: 7200 }))
      .mockResolvedValueOnce(Response.json({ errcode: 0 }));
    await sendWeComProactiveText(account('wwproactive01'), 'zhangsan', 'hi', fetchMock);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ touser: 'zhangsan', text: { content: 'hi' } });
  });
});
