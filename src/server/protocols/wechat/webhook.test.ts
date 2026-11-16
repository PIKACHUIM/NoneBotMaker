import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';

const state = vi.hoisted(() => ({
  account: {
    appId: 'wx123',
    protocol: 'wechat',
    credentials: { appId: 'wx123', appSecret: 'wx-secret', token: 'wx-token' },
    appSecret: 'wx-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'wechat', name: 'WeChat', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { sha1Hex } from '../crypto';
import { createWeChatWebhookRouter } from './webhook';

async function signature(nonce = 'nonce') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { timestamp, nonce, signature: await sha1Hex(['wx-token', timestamp, nonce].sort().join('')) };
}

function textXml() {
  return '<xml><ToUserName><![CDATA[gh_1]]></ToUserName><FromUserName><![CDATA[openid-1]]></FromUserName>' +
    '<CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType>' +
    '<Content><![CDATA[ 你好，机器人 ]]></Content><MsgId>1234567890</MsgId></xml>';
}

describe('WeChat webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('echoes the server verification challenge', async () => {
    const { timestamp, nonce, signature: sign } = await signature();
    const response = await createWeChatWebhookRouter({ handleMessage: state.handleMessage }).request(
      `/webhook/wechat?signature=${sign}&timestamp=${timestamp}&nonce=${nonce}&echostr=echo-123`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('echo-123');
  });

  it('normalizes a plaintext text message', async () => {
    const { timestamp, nonce, signature: sign } = await signature();
    const response = await createWeChatWebhookRouter({ handleMessage: state.handleMessage }).request(
      `/webhook/wechat?signature=${sign}&timestamp=${timestamp}&nonce=${nonce}`,
      { method: 'POST', headers: { 'content-type': 'text/xml' }, body: textXml() },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'wechat' }),
      expect.objectContaining({
        id: '1234567890', groupId: 'openid-1', userId: 'openid-1', text: '你好，机器人',
        mentionsBot: true, conversationType: 'private', eventType: 'wechat.text',
      }),
      expect.anything(),
    );
  });

  it('rejects a callback with an invalid signature', async () => {
    const response = await createWeChatWebhookRouter({ handleMessage: state.handleMessage }).request(
      '/webhook/wechat?signature=bad&timestamp=1700000000&nonce=nonce',
      { method: 'POST', headers: { 'content-type': 'text/xml' }, body: textXml() },
    );
    expect(response.status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('acknowledges events without invoking the model', async () => {
    const { timestamp, nonce, signature: sign } = await signature();
    const event = '<xml><FromUserName><![CDATA[openid-1]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event></xml>';
    const response = await createWeChatWebhookRouter({ handleMessage: state.handleMessage }).request(
      `/webhook/wechat?signature=${sign}&timestamp=${timestamp}&nonce=${nonce}`,
      { method: 'POST', headers: { 'content-type': 'text/xml' }, body: event },
    );
    expect(await response.text()).toBe('success');
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
