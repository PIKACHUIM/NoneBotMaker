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
  kookText: vi.fn(async () => undefined),
  kookMedia: vi.fn(async () => undefined),
  kookProactive: vi.fn(async () => undefined),
  wecomText: vi.fn(async () => undefined),
  wecomMedia: vi.fn(async () => undefined),
  wecomProactive: vi.fn(async () => undefined),
  messengerText: vi.fn(async () => undefined),
  messengerMedia: vi.fn(async () => undefined),
  messengerProactive: vi.fn(async () => undefined),
  vkText: vi.fn(async () => undefined),
  vkMedia: vi.fn(async () => undefined),
  vkProactive: vi.fn(async () => undefined),
  zulipText: vi.fn(async () => undefined),
  zulipMedia: vi.fn(async () => undefined),
  zulipProactive: vi.fn(async () => undefined),
  rcText: vi.fn(async () => undefined),
  rcMedia: vi.fn(async () => undefined),
  rcProactive: vi.fn(async () => undefined),
  dodoText: vi.fn(async () => undefined),
  dodoMedia: vi.fn(async () => undefined),
  dodoProactive: vi.fn(async () => undefined),
  matrixText: vi.fn(async () => undefined),
  matrixMedia: vi.fn(async () => undefined),
  matrixProactive: vi.fn(async () => undefined),
  revoltText: vi.fn(async () => undefined),
  revoltMedia: vi.fn(async () => undefined),
  revoltProactive: vi.fn(async () => undefined),
  mastodonText: vi.fn(async () => undefined),
  mastodonMedia: vi.fn(async () => undefined),
  mastodonProactive: vi.fn(async () => undefined),
  instagramText: vi.fn(async () => undefined),
  instagramMedia: vi.fn(async () => undefined),
  instagramProactive: vi.fn(async () => undefined),
  viberText: vi.fn(async () => undefined),
  viberMedia: vi.fn(async () => undefined),
  viberProactive: vi.fn(async () => undefined),
  misskeyText: vi.fn(async () => undefined),
  misskeyMedia: vi.fn(async () => undefined),
  misskeyProactive: vi.fn(async () => undefined),
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
vi.mock('./kook/api', () => ({ sendKookText: mocks.kookText, sendKookMedia: mocks.kookMedia, sendKookProactiveText: mocks.kookProactive }));
vi.mock('./wecom/api', () => ({ sendWeComText: mocks.wecomText, sendWeComMedia: mocks.wecomMedia, sendWeComProactiveText: mocks.wecomProactive }));
vi.mock('./messenger/api', () => ({ sendMessengerText: mocks.messengerText, sendMessengerMedia: mocks.messengerMedia, sendMessengerProactiveText: mocks.messengerProactive }));
vi.mock('./vk/api', () => ({ sendVkText: mocks.vkText, sendVkMedia: mocks.vkMedia, sendVkProactiveText: mocks.vkProactive }));
vi.mock('./zulip/api', () => ({ sendZulipText: mocks.zulipText, sendZulipMedia: mocks.zulipMedia, sendZulipProactiveText: mocks.zulipProactive }));
vi.mock('./rocketchat/api', () => ({ sendRocketChatText: mocks.rcText, sendRocketChatMedia: mocks.rcMedia, sendRocketChatProactiveText: mocks.rcProactive }));
vi.mock('./dodo/api', () => ({ sendDodoText: mocks.dodoText, sendDodoMedia: mocks.dodoMedia, sendDodoProactiveText: mocks.dodoProactive }));
vi.mock('./matrix/api', () => ({ sendMatrixText: mocks.matrixText, sendMatrixMedia: mocks.matrixMedia, sendMatrixProactiveText: mocks.matrixProactive }));
vi.mock('./revolt/api', () => ({ sendRevoltText: mocks.revoltText, sendRevoltMedia: mocks.revoltMedia, sendRevoltProactiveText: mocks.revoltProactive }));
vi.mock('./mastodon/api', () => ({ sendMastodonText: mocks.mastodonText, sendMastodonMedia: mocks.mastodonMedia, sendMastodonProactiveText: mocks.mastodonProactive }));
vi.mock('./instagram/api', () => ({ sendInstagramText: mocks.instagramText, sendInstagramMedia: mocks.instagramMedia, sendInstagramProactiveText: mocks.instagramProactive }));
vi.mock('./viber/api', () => ({ sendViberText: mocks.viberText, sendViberMedia: mocks.viberMedia, sendViberProactiveText: mocks.viberProactive }));
vi.mock('./misskey/api', () => ({ sendMisskeyText: mocks.misskeyText, sendMisskeyMedia: mocks.misskeyMedia, sendMisskeyProactiveText: mocks.misskeyProactive }));

import { sendChatMedia, sendChatText, sendProactiveChatText } from './sender';

const protocols = ['qq', 'feishu', 'dingtalk', 'wechat', 'onebot', 'telegram', 'slack', 'line', 'whatsapp', 'mattermost', 'discord', 'satori', 'kook', 'wecom', 'messenger', 'vk', 'zulip', 'rocketchat', 'dodo', 'matrix', 'revolt', 'mastodon', 'instagram', 'viber', 'misskey'];
const mediaProtocols = ['qq', 'feishu', 'wechat', 'onebot', 'telegram', 'slack', 'line', 'whatsapp', 'mattermost', 'discord', 'satori', 'kook', 'wecom', 'messenger', 'zulip', 'rocketchat', 'dodo', 'matrix', 'revolt', 'mastodon', 'instagram', 'viber', 'misskey'];

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
    expect(mocks.kookText).toHaveBeenCalledTimes(1);
    expect(mocks.wecomText).toHaveBeenCalledTimes(1);
    expect(mocks.messengerText).toHaveBeenCalledTimes(1);
    expect(mocks.vkText).toHaveBeenCalledTimes(1);
    expect(mocks.zulipText).toHaveBeenCalledTimes(1);
    expect(mocks.rcText).toHaveBeenCalledTimes(1);
    expect(mocks.dodoText).toHaveBeenCalledTimes(1);
    expect(mocks.matrixText).toHaveBeenCalledTimes(1);
    expect(mocks.revoltText).toHaveBeenCalledTimes(1);
    expect(mocks.mastodonText).toHaveBeenCalledTimes(1);
    expect(mocks.instagramText).toHaveBeenCalledTimes(1);
    expect(mocks.viberText).toHaveBeenCalledTimes(1);
    expect(mocks.misskeyText).toHaveBeenCalledTimes(1);
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
    expect(mocks.kookMedia).toHaveBeenCalledTimes(1);
    expect(mocks.wecomMedia).toHaveBeenCalledTimes(1);
    expect(mocks.messengerMedia).toHaveBeenCalledTimes(1);
    expect(mocks.zulipMedia).toHaveBeenCalledTimes(1);
    expect(mocks.rcMedia).toHaveBeenCalledTimes(1);
    expect(mocks.dodoMedia).toHaveBeenCalledTimes(1);
    expect(mocks.matrixMedia).toHaveBeenCalledTimes(1);
    expect(mocks.revoltMedia).toHaveBeenCalledTimes(1);
    expect(mocks.mastodonMedia).toHaveBeenCalledTimes(1);
    expect(mocks.misskeyMedia).toHaveBeenCalledTimes(1);
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
    expect(mocks.kookProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.wecomProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.messengerProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.vkProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.zulipProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.rcProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.dodoProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'private', 'hi');
    expect(mocks.matrixProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.revoltProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.mastodonProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.instagramProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.viberProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
    expect(mocks.misskeyProactive).toHaveBeenCalledWith(expect.anything(), 'target', 'hi');
  });

  it('rejects unknown protocols instead of silently dropping messages', async () => {
    await expect(sendChatText(account('irc'), 'target', 'message', 'hi', options)).rejects.toThrow('Unsupported chat protocol');
  });
});
