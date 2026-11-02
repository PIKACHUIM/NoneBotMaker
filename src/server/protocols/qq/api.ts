import type { QQAccountContext } from './types';

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedAccessToken>();
const TOKEN_ENDPOINT = 'https://api.bot.qq.com/app/getAppAccessToken';
const QQ_API_BASE_URL = 'https://api.bot.qq.com';

type FetchLike = typeof fetch;

export async function getQQAccessToken(
  account: Pick<QQAccountContext, 'appId' | 'clientSecret'>,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const cached = tokenCache.get(account.appId);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: account.appId, clientSecret: account.clientSecret }),
  });
  if (!response.ok) throw new Error('QQ access token request failed.');

  const result = (await response.json()) as { access_token?: unknown; expires_in?: unknown; code?: unknown };
  if (result.code !== undefined && result.code !== 0) throw new Error('QQ access token request failed.');
  if (typeof result.access_token !== 'string' || result.access_token.length === 0) {
    throw new Error('QQ access token response is invalid.');
  }
  const expiresIn = typeof result.expires_in === 'number'
    ? result.expires_in
    : typeof result.expires_in === 'string' && result.expires_in.trim() !== ''
      ? Number(result.expires_in)
      : 0;
  const validExpiresIn = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 0;
  tokenCache.set(account.appId, { value: result.access_token, expiresAt: now() + validExpiresIn * 1000 });
  return result.access_token;
}

export async function replyToQQGroup(
  account: QQAccountContext,
  groupOpenId: string,
  messageId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const accessToken = await getQQAccessToken(account, fetchImpl);
  const response = await fetchImpl(`${QQ_API_BASE_URL}/v2/groups/${encodeURIComponent(groupOpenId)}/messages`, {
    method: 'POST',
    headers: {
      authorization: `QQBot ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ msg_type: 0, content, msg_id: messageId, msg_seq: 1 }),
  });
  if (!response.ok) throw new Error('QQ group reply failed.');
  const result = (await response.json()) as { err_code?: unknown };
  if (typeof result.err_code === 'number' && result.err_code !== 0) throw new Error('QQ group reply failed.');
}
