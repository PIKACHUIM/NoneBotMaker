import { describe, expect, it } from 'vitest';
import type { ChatAccountContext } from '../types';
import { normalizeWeComMessage } from './message';

function account(): ChatAccountContext {
  return {
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
  };
}

function xml(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    ToUserName: 'ww1234567890abcdef',
    FromUserName: 'zhangsan',
    CreateTime: '1800000000',
    MsgType: 'text',
    Content: '你好',
    MsgId: '123456789',
    AgentID: '1000002',
    ...overrides,
  };
  return `<xml>${Object.entries(fields).map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`).join('')}</xml>`;
}

describe('WeCom message normalization', () => {
  it('normalizes a text message as a private conversation', () => {
    const normalized = normalizeWeComMessage(xml(), account(), 1_700_000_000_000);
    expect(normalized).toMatchObject({
      id: '123456789', groupId: 'zhangsan', userId: 'zhangsan',
      text: '你好', mentionsBot: true, conversationType: 'private',
      eventId: 'wecom:123456789', eventType: 'wecom.text', receivedAt: 1_800_000_000_000,
    });
  });

  it('uses placeholders for media and rejects other agents', () => {
    expect(normalizeWeComMessage(xml({ MsgType: 'image', Content: 'https://example/a.png' }), account(), 0)?.text).toBe('[图片]');
    expect(normalizeWeComMessage(xml({ AgentID: '9999999' }), account(), 0)).toBeNull();
  });

  it('ignores messages without a sender', () => {
    expect(normalizeWeComMessage(xml({ FromUserName: '' }), account(), 0)).toBeNull();
  });
});
