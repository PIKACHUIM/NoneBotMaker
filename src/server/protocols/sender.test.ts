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
  slackText: vi.fn(async () => undefined),
  slackMedia: vi.fn(async () => undefined),
  slackProactive: vi.fn(async () => undefined),
  lineText: vi.fn(async () => undefined),
  lineMedia: vi.fn(async () => undefined),
  lineProactive: vi.fn(async () => undefined),
  waText: vi.fn(async () => undefined),
  waMedia: vi.fn(async () => undefined),
  waProactive: vi.fn(async () => undefined),
  mmText: vi.fn(async () => undefined),
  mmMedia: vi.fn(async () => undefined),
  mmProactive: vi.fn(async () => undefined),
  discordText: vi.fn(async () => undefined),
  discordMedia: vi.fn(async () => undefined),
  discordProactive: vi.fn(async () => undefined),
  satoriText: vi.fn(async () => undefined),
  satoriMedia: vi.fn(async () => undefined),
  satoriProactive: vi.fn(async () => undefined),
}));

vi.mock('./qq/api', () => ({ replyToQQMessage: mocks.qqText, sendQQMedia: mocks.qqMedia, replyToQQGroup: mocks.qqProactive }));
vi.mock('./feishu/api', () => ({ sendFeishuText: mocks.feishuText, sendFeishuMedia: mocks.feishuMedia }));
vi.mock('./dingtalk/api', () => ({ sendDingTalkText: mocks.dingText, sendDingTalkMedia: vi.fn(async () => undefined), sendDingTalkProactiveText: mocks.dingProactive }));
vi.mock('./wechat/api', () => ({ sendWeChatText: mocks.wechatText, sendWeChatMedia: mocks.wechatMedia }));
vi.mock('./onebot/api', () => ({ sendOneBotText: mocks.oneText, sendOneBotMedia: mocks.oneMedia, sendOneBotProactiveText: mocks.oneProactive }));
vi.mock('./telegram/api', () => ({ sendTelegramText: mocks.teleText, sendTelegramMedia: mocks.teleMedia, sendTelegramProactiveText: mocks.teleProactive }));
vi.mock('./slack/api', () => ({ sendSlackText: mocks.slackText, sendSlackMedia: mocks.slackMedia, sendSlackProactiveText: mocks.slackProactive }));
vi.mock('./line/api', () => ({ sendLineText: mocks.lineText, sendLineMedia: mocks.lineMedia, sendLineProactiveText: mocks.lineProactive }));
vi.mock('./whatsapp/api', () => ({ sendWhatsAppText: mocks.waText, sendWhatsAppMedia: mocks.waMedia, sendWhatsAppProactiveText: mocks.waProactive }));
vi.mock('./mattermost/api', () => ({ sendMattermostText: mocks.mmText, sendMattermostMedia: mocks.mmMedia, sendMattermostProactiveText: mocks.mmProactive }));
vi.mock('./discord/api', () => ({ sendDiscordText: mocks.discordText, sendDiscordMedia: mocks.discordMedia, sendDiscordProactiveText: mocks.discordProactive }));
vi.mock('./satori/api', () => ({ sendSatoriText: mocks.satoriText, sendSatoriMedia: mocks.satoriMedia, sendSatoriProactiveText: mocks.satoriProactive }));

import { sendChatMedia, sendChatText, sendProactiveChatText } from './sender';

const protocols = ['qq', 'feishu', 'dingtalk', 'wechat', 'onebot', 'telegram', 'slack', 'line', 'whatsapp', 'mattermost', 'discord', 'satori'];
const mediaProtocols = ['qq', 'feishu', 'wechat', 'onebot', 'telegram', 'slack', 'line', 'whatsapp', 'mattermost', 'discord', 'satori'];

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
    for (const protocol of protocols) await sendChatText(account(protocol), 'target', 'message', 'hi', options);
    for (const protocol of mediaProtocols) await sendChatMedia(account(protocol), 'target', 'message', media, options);
    expect(mocks.qqText).toHaveBeenCalledTimes(1);
    expect(mocks.feishuText).toHaveBeenCalledTimes(1);
    expect(mocks.dingText).toHaveBeenCalledTimes(1);
    expect(mocks.wechatText).toHaveBeenCalledTimes(1);
    expect(mocks.oneText).toHaveBeenCalledTimes(1);
    expect(mocks.teleText).toHaveBeenCalledTimes(1);
    expect(mocks.slackText).toHaveBeenCalledTimes(1);
    expect(mocks.lineText).toHaveBeenCalledTimes(1);
    expect(mocks.waText).toHaveBeenCalledTimes(1);
    expect(mocks.mmText).toHaveBeenCalledTimes(1);
    expect(mocks.discordText).toHaveBeenCalledTimes(1);
    expect(mocks.satoriText).toHaveBeenCalledTimes(1);
    expect(mocks.qqMedia).toHaveBeenCalledTimes(1);
    expect(mocks.feishuMedia).toHaveBeenCalledTimes(1);
    expect(mocks.wechatMedia).toHaveBeenCalledTimes(1);
    expect(mocks.oneMedia).toHaveBeenCalledTimes(1);
    expect(mocks.teleMedia).toHaveBeenCalledTimes(1);
    expect(mocks.slackMedia).toHaveBeenCalledTimes(1);
    expect(mocks.lineMedia).toHaveBeenCalledTimes(1);
    expect(mocks.waMedia).toHaveBeenCalledTimes(1);
    expect(mocks.mmMedia).toHaveBeenCalledTimes(1);
    expect(mocks.discordMedia).toHaveBeenCalledTimes(1);
    expect(mocks.satoriMedia).toHaveBeenCalledTimes(1);
  });

  it('uses proactive sends for schedules', async () => {
    for (const protocol of protocols) await sendProactiveChatText(account(protocol), 'target', 'private', 'hi', 2);
    expect(mocks.qqProactive).toHaveBeenCalledWith(expect.anything(), 'target', '', 'hi', fetch, 2, 'private', true);
    expect(mocks.feishuText).toHaveBeenCalledWith(expect.anything(), 'target', 'hi', { seq: 1, conversationType: 'private' });
    expect(mocks.dingProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'private', 'hi');
    expect(mocks.wechatText).toHaveBeenCalledWith(expect.anything(), 'target', 'hi', { seq: 1, conversationType: 'private' });
    expect(mocks.oneProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'private', 'hi');
    expect(mocks.teleProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.slackProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.lineProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.waProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.mmProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.discordProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.satoriProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
  });

  it('rejects unknown protocols instead of silently dropping messages', async () => {
    await expect(sendChatText(account('matrix'), 'target', 'message', 'hi', options)).rejects.toThrow('Unsupported chat protocol');
  });
});
