import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { getTelegramBotIdentity, sendTelegramMedia, sendTelegramProactiveText, sendTelegramText } from './api';

function account(token: string): ChatAccountContext {
  return {
    appId: token.split(':')[0],
    protocol: 'telegram',
    credentials: { botId: token.split(':')[0], botToken: token, secretToken: 'secret' },
    appSecret: token,
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'telegram', name: 'Telegram', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const ok = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: {} }));

describe('Telegram API', () => {
  it('reads the bot identity and caches it per account', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: { id: 9001, username: 'bot', first_name: 'Bot' } }));
    const bot = account('9001:AA-test');
    expect(await getTelegramBotIdentity(bot, fetchMock)).toMatchObject({ id: '9001', username: 'bot' });
    expect(await getTelegramBotIdentity(bot, fetchMock)).toMatchObject({ id: '9001' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/bot9001:AA-test/getMe', expect.anything());
  });

  it('sends text with reply parameters', async () => {
    await sendTelegramText(account('9002:AA-test'), '-100123', '88', 'hello', { seq: 1, conversationType: 'group' }, ok);
    const body = JSON.parse(String((ok.mock.calls[0][1] as RequestInit).body));
    expect(ok).toHaveBeenCalledWith('https://api.telegram.org/bot9002:AA-test/sendMessage', expect.anything());
    expect(body).toMatchObject({ chat_id: '-100123', text: 'hello', reply_parameters: { message_id: 88, allow_sending_without_reply: true } });
  });

  it('sends media as multipart form data', async () => {
    ok.mockClear();
    await sendTelegramMedia(account('9003:AA-test'), '42', '', {
      type: 'image', bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png',
    }, { seq: 1, conversationType: 'private' }, ok);
    const init = ok.mock.calls[0][1] as RequestInit;
    expect(ok.mock.calls[0][0]).toBe('https://api.telegram.org/bot9003:AA-test/sendPhoto');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('chat_id')).toBe('42');
    expect((init.body as FormData).get('photo')).toBeInstanceOf(Blob);
  });

  it('sends proactive text without a reply', async () => {
    ok.mockClear();
    await sendTelegramProactiveText(account('9004:AA-test'), '42', 'hi', ok);
    const body = JSON.parse(String((ok.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ chat_id: '42', text: 'hi', link_preview_options: { is_disabled: true } });
  });
});
