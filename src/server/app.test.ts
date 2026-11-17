import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('app runtime routing', () => {
  it('mounts the QQ webhook at /webhook/qq', async () => {
    const response = await createApp().request('/webhook/qq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid callback' });
  });

  it('mounts the Feishu, DingTalk, and WeChat webhooks', async () => {
    const feishu = await createApp().request('/webhook/feishu', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(feishu.status).toBe(503);
    const dingtalk = await createApp().request('/webhook/dingtalk', { method: 'POST' });
    expect(dingtalk.status).toBe(401);
    const wechat = await createApp().request('/webhook/wechat');
    expect(wechat.status).toBe(503);
  });

  it('mounts the OneBot and Telegram webhooks', async () => {
    const onebot = await createApp().request('/webhook/onebot', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ post_type: 'meta_event' }),
    });
    expect(onebot.status).toBe(200);
    expect(await onebot.json()).toEqual({ status: 'ok', retcode: 0 });
    const telegram = await createApp().request('/webhook/telegram', { method: 'POST' });
    expect(telegram.status).toBe(401);
  });

  it('mounts the Slack, LINE, WhatsApp and Mattermost webhooks', async () => {
    const slack = await createApp().request('/webhook/slack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(slack.status).toBe(401);
    const line = await createApp().request('/webhook/line', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(line.status).toBe(401);
    const whatsapp = await createApp().request('/webhook/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(whatsapp.status).toBe(401);
    const whatsappVerify = await createApp().request('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y');
    expect(whatsappVerify.status).toBe(503);
    const mattermost = await createApp().request('/webhook/mattermost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(mattermost.status).toBe(401);
    const wecom = await createApp().request('/webhook/wecom', { method: 'POST', headers: { 'content-type': 'text/xml' }, body: '<xml></xml>' });
    expect(wecom.status).toBe(401);
    const wecomVerify = await createApp().request('/webhook/wecom');
    expect(wecomVerify.status).toBe(403);
  });

  it('mounts the Messenger, VK, Zulip and Rocket.Chat webhooks', async () => {
    const messenger = await createApp().request('/webhook/messenger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(messenger.status).toBe(200);
    const messengerVerify = await createApp().request('/webhook/messenger?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y');
    expect(messengerVerify.status).toBe(503);
    const vk = await createApp().request('/webhook/vk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(vk.status).toBe(401);
    const zulip = await createApp().request('/webhook/zulip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(zulip.status).toBe(401);
    const rocketchat = await createApp().request('/webhook/rocketchat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(rocketchat.status).toBe(401);
    const instagram = await createApp().request('/webhook/instagram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(instagram.status).toBe(200);
    const instagramVerify = await createApp().request('/webhook/instagram?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y');
    expect(instagramVerify.status).toBe(503);
    const viber = await createApp().request('/webhook/viber', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(viber.status).toBe(401);
  });

  it('rejects websocket mode outside Cloudflare before routing', async () => {
    const response = await createApp().request('/api/health', {}, {
      API_METHOD: 'websocket',
      PLATFORM: 'edgeone',
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'websocket_unsupported' });
  });

  it('does not expose the webhook route in Cloudflare websocket mode', async () => {
    const response = await createApp().request('/webhook/qq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, {
      API_METHOD: 'websocket',
      PLATFORM: 'cloudflare',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'webhook_disabled' });
  });
});
