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
