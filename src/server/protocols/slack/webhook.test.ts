import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAccountContext } from '../types';
import { hmacSha256Hex } from '../crypto';

const state = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  account: {
    appId: 'A0123456789',
    protocol: 'slack',
    credentials: { appId: 'A0123456789', botToken: 'xoxb-test', signingSecret: 'signing-secret' },
    appSecret: 'signing-secret',
    pluginEnabled: true,
    account: { id: 'account-1', pluginId: 'plugin-1', protocol: 'slack', name: 'Slack', enabled: true, credentials: {}, config: {}, createdAt: '', updatedAt: '' },
  } as unknown as ChatAccountContext,
  handleMessage: vi.fn(async () => undefined),
}));

vi.mock('../accounts', () => ({ listChatAccounts: vi.fn(async () => [state.account]) }));

import { createSlackWebhookRouter } from './webhook';

async function request(body: unknown, options: { secret?: string; timestamp?: number } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor((options.timestamp ?? state.now) / 1000));
  const signature = `v0=${await hmacSha256Hex(options.secret ?? 'signing-secret', `v0:${timestamp}:${raw}`)}`;
  return createSlackWebhookRouter({ handleMessage: state.handleMessage, now: () => state.now }).request('/webhook/slack', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Slack-Signature': signature, 'X-Slack-Request-Timestamp': timestamp },
    body: raw,
  });
}

function eventPayload(text = '<@UBOT> 你好') {
  return {
    type: 'event_callback',
    api_app_id: 'A0123456789',
    event_id: 'Ev123',
    event_time: 1_800_000_000,
    authorizations: [{ user_id: 'UBOT', is_bot: true }],
    event: { type: 'message', channel: 'C123', channel_type: 'channel', user: 'U42', text, ts: '1800000000.000100' },
  };
}

describe('Slack webhook', () => {
  beforeEach(() => state.handleMessage.mockClear());

  it('answers url_verification challenges', async () => {
    const response = await request({ type: 'url_verification', challenge: 'challenge-value' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: 'challenge-value' });
  });

  it('verifies the signature and normalizes a channel mention', async () => {
    const response = await request(eventPayload());
    expect(response.status).toBe(200);
    expect(state.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'slack' }),
      expect.objectContaining({
        id: '1800000000.000100', groupId: 'C123', userId: 'U42',
        text: '你好', mentionsBot: true, conversationType: 'group', eventType: 'slack.channel', eventId: 'slack:Ev123',
      }),
      expect.anything(),
    );
  });

  it('treats direct messages as private conversations', async () => {
    const payload = eventPayload('hello');
    payload.event.channel_type = 'im';
    await request(payload);
    expect(state.handleMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      text: 'hello', mentionsBot: true, conversationType: 'private',
    }), expect.anything());
  });

  it('rejects stale timestamps and bad signatures', async () => {
    expect((await request(eventPayload(), { timestamp: state.now - 10 * 60_000 })).status).toBe(401);
    expect((await request(eventPayload(), { secret: 'wrong' })).status).toBe(401);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });

  it('ignores messages posted by other bots', async () => {
    const payload = eventPayload('bot output');
    (payload.event as Record<string, unknown>).bot_id = 'B999';
    const response = await request(payload);
    expect(response.status).toBe(200);
    expect(state.handleMessage).not.toHaveBeenCalled();
  });
});
