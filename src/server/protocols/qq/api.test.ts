import { describe, expect, it, vi } from 'vitest';
import { getQQAccessToken } from './api';

function account(appId: string) {
  return { appId, clientSecret: 'client-secret' };
}

describe('QQ API access tokens', () => {
  it('accepts expires_in as a numeric string and caches until the refresh window', async () => {
    let now = 1_000;
    const fetch = vi.fn(async () => Response.json({ access_token: 'token', expires_in: '7200' }));
    const bot = account('string-expiry-test');

    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    now += 7_000_000;
    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    expect(fetch).toHaveBeenCalledOnce();

    now += 150_000;
    await expect(getQQAccessToken(bot, fetch, () => now)).resolves.toBe('token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
