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
