import { describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from './types';

const mocks = vi.hoisted(() => ({
  qqText: vi.fn(async () => undefined),
  qqMedia: vi.fn(async () => undefined),
  qqProactive: vi.fn(async () => undefined),
  feishuText: vi.fn(async () => undefined),
  feishuMedia: vi.fn(async () => undefined),
  dingText: vi.fn(async () => undefined),
  dingProactive: vi.fn(async () => undefined),
  wechatText: vi.fn(async () => undefined),
  wechatMedia: vi.fn(async () => undefined),
  oneText: vi.fn(async () => undefined),
  oneMedia: vi.fn(async () => undefined),
  oneProactive: vi.fn(async () => undefined),
  teleText: vi.fn(async () => undefined),
  teleMedia: vi.fn(async () => undefined),
  teleProactive: vi.fn(async () => undefined),
}));

vi.mock('./qq/api', () => ({ replyToQQMessage: mocks.qqText, sendQQMedia: mocks.qqMedia, replyToQQGroup: mocks.qqProactive }));
vi.mock('./feishu/api', () => ({ sendFeishuText: mocks.feishuText, sendFeishuMedia: mocks.feishuMedia }));
vi.mock('./dingtalk/api', () => ({ sendDingTalkText: mocks.dingText, sendDingTalkMedia: vi.fn(async () => undefined), sendDingTalkProactiveText: mocks.dingProactive }));
vi.mock('./wechat/api', () => ({ sendWeChatText: mocks.wechatText, sendWeChatMedia: mocks.wechatMedia }));
vi.mock('./onebot/api', () => ({ sendOneBotText: mocks.oneText, sendOneBotMedia: mocks.oneMedia, sendOneBotProactiveText: mocks.oneProactive }));
vi.mock('./telegram/api', () => ({ sendTelegramText: mocks.teleText, sendTelegramMedia: mocks.teleMedia, sendTelegramProactiveText: mocks.teleProactive }));

import { sendChatMedia, sendChatText, sendProactiveChatText } from './sender';

function account(protocol: string): ChatAccountContext {
  return {
    appId: 'app', protocol, credentials: {}, appSecret: 'secret', pluginEnabled: true,
    account: { id: 'account', pluginId: 'plugin', protocol, name: protocol, enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  };
}

const options = { seq: 1, conversationType: 'group' as const };
const media = { type: 'image' as const, bytes: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png' };

describe('chat protocol sender', () => {
  it('routes text and media to the account protocol', async () => {
    for (const protocol of ['qq', 'feishu', 'dingtalk', 'wechat', 'onebot', 'telegram']) await sendChatText(account(protocol), 'target', 'message', 'hi', options);
    await sendChatMedia(account('qq'), 'target', 'message', media, options);
    await sendChatMedia(account('feishu'), 'target', 'message', media, options);
    await sendChatMedia(account('wechat'), 'target', 'message', media, options);
    await sendChatMedia(account('onebot'), 'target', 'message', media, options);
    await sendChatMedia(account('telegram'), 'target', 'message', media, options);
    expect(mocks.qqText).toHaveBeenCalledTimes(1);
    expect(mocks.feishuText).toHaveBeenCalledTimes(1);
    expect(mocks.dingText).toHaveBeenCalledTimes(1);
    expect(mocks.wechatText).toHaveBeenCalledTimes(1);
    expect(mocks.oneText).toHaveBeenCalledTimes(1);
    expect(mocks.teleText).toHaveBeenCalledTimes(1);
    expect(mocks.qqMedia).toHaveBeenCalledTimes(1);
    expect(mocks.feishuMedia).toHaveBeenCalledTimes(1);
    expect(mocks.wechatMedia).toHaveBeenCalledTimes(1);
    expect(mocks.oneMedia).toHaveBeenCalledTimes(1);
    expect(mocks.teleMedia).toHaveBeenCalledTimes(1);
  });

  it('uses proactive sends for schedules', async () => {
    for (const protocol of ['qq', 'feishu', 'dingtalk', 'wechat', 'onebot', 'telegram']) await sendProactiveChatText(account(protocol), 'target', 'private', 'hi', 2);
    expect(mocks.qqProactive).toHaveBeenCalledWith(expect.anything(), 'target', '', 'hi', fetch, 2, 'private', true);
    expect(mocks.feishuText).toHaveBeenCalledWith(expect.anything(), 'target', 'hi', { seq: 1, conversationType: 'private' });
    expect(mocks.dingProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'private', 'hi');
    expect(mocks.wechatText).toHaveBeenCalledWith(expect.anything(), 'target', 'hi', { seq: 1, conversationType: 'private' });
    expect(mocks.oneProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'private', 'hi');
    expect(mocks.teleProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
  });

  it('rejects unknown protocols instead of silently dropping messages', async () => {
    await expect(sendChatText(account('slack'), 'target', 'message', 'hi', options)).rejects.toThrow('Unsupported chat protocol');
  });
});
