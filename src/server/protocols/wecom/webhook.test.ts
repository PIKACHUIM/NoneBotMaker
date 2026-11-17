import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { encryptWeCom, wecomSignature } from './crypto';

const key = 'a'.repeat(43);
const corpId = 'ww1234567890abcdef';
const token = 'callback-token';

const state = vi.hoisted(() => ({
  account: {
    appId: 'ww1234567890abcdef',
    protocol: 'wecom',
    credentials: {
      corpId: 'ww1234567890abcdef',
      agentId: '1000002',
      secret: 'app-secret',
      token: 'callback-token',
      encodingAESKey: 'a'.repeat(43),
    },
    appSecret: 'app-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'wecom', name: 'WeCom', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { createWeComWebhookRouter } from './webhook';

function router() {
  return createWeComWebhookRouter({ handleMessage: state.handleMessage, now: () => 1_800_000_000_000 });
}

function textXml(content = '你好') {
  return `<xml><ToUserName><![CDATA[${corpId}]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><CreateTime>1800000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content><MsgId>123456789</MsgId><AgentID>1000002</AgentID></xml>`;
}

async function signedBody(xml: string) {
  const encrypted = await encryptWeCom(key, xml, corpId);
  const signature = await wecomSignature(token, '1800000000', 'nonce', encrypted);
  return {
    encrypted,
    signature,
    body: `<xml><ToUserName><![CDATA[${corpId}]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt><AgentID>1000002</AgentID></xml>`,
  };
}

describe('WeCom webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('answers GET verification with the decrypted echostr', async () => {
    const echo = await encryptWeCom(key, 'echo-123', corpId);
    const signature = await wecomSignature(token, '1800000000', 'nonce', echo);
    const response = await router().request(
      `/webhook/wecom?msg_signature=${signature}&timestamp=1800000000&nonce=nonce&echostr=${encodeURIComponent(echo)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('echo-123');
  });

  it('verifies, decrypts and normalizes a text message', async () => {
    const signed = await signedBody(textXml());
    const response = await router().request(
      `/webhook/wecom?msg_signature=${signed.signature}&timestamp=1800000000&nonce=nonce`,
      { method: 'POST', headers: { 'content-type': 'text/xml' }, body: signed.body },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'wecom' }),
      expect.objectContaining({
        id: '123456789', groupId: 'zhangsan', userId: 'zhangsan',
        text: '你好', mentionsBot: true, conversationType: 'private', eventId: 'wecom:123456789',
      }),
      expect.anything(),
    );
  });

  it('rejects incorrect signatures', async () => {
    const signed = await signedBody(textXml());
    const response = await router().request(
      `/webhook/wecom?msg_signature=bad&timestamp=1800000000&nonce=nonce`,
      { method: 'POST', headers: { 'content-type': 'text/xml' }, body: signed.body },
    );
    expect(response.status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
