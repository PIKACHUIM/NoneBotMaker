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
  account: Pick<QQAccountContext, 'appId' | 'appSecret' | 'clientSecret'>,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const secret = account.appSecret ?? account.clientSecret;
  if (!secret) throw new Error('QQ AppSecret is not configured.');
  const cacheKey = `${account.appId}:${secret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: account.appId, clientSecret: secret }),
    signal: AbortSignal.timeout(10_000),
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
  if (tokenCache.size >= 200) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(cacheKey, { value: result.access_token, expiresAt: now() + validExpiresIn * 1000 });
  return result.access_token;
}

export async function replyToQQGroup(
  account: QQAccountContext,
  groupOpenId: string,
  messageId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
  seq = 1,
  conversationType: 'group' | 'private' = 'group',
  active = false,
): Promise<void> {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('QQ message sequence is invalid.');
  const accessToken = await getQQAccessToken(account, fetchImpl);
  const scope = conversationType === 'private' ? 'users' : 'groups';
  const response = await fetchImpl(`${QQ_API_BASE_URL}/v2/${scope}/${encodeURIComponent(groupOpenId)}/messages`, {
    method: 'POST',
    headers: {
      authorization: `QQBot ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
      'X-Union-Appid': account.appId,
    },
    body: JSON.stringify({ msg_type: 0, content, ...(!active ? { msg_id: messageId } : {}), msg_seq: seq }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('QQ group reply failed.');
  const result = (await response.json()) as { err_code?: unknown; code?: unknown };
  if ((typeof result.err_code === 'number' && result.err_code !== 0) || (typeof result.code === 'number' && result.code !== 0)) throw new Error('QQ message reply failed.');
}

export interface QQOutboundMedia {
  type: 'image' | 'audio' | 'video' | 'file';
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export async function sendQQMedia(
  account: QQAccountContext,
  targetId: string,
  messageId: string,
  media: QQOutboundMedia,
  options: { seq: number; conversationType: 'group' | 'private' },
  fetchImpl: FetchLike = fetch,
  active = false,
): Promise<void> {
  if (!Number.isSafeInteger(options.seq) || options.seq < 1) throw new Error('QQ message sequence is invalid.');
  const fileType = { image: 1, video: 2, audio: 3, file: 4 }[media.type];
  if (!fileType || !(media.bytes instanceof Uint8Array) || media.bytes.byteLength < 1 || media.bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error('QQ outbound media is invalid or exceeds the 5 MB limit.');
  }
  if (!media.filename || media.filename.length > 256 || /[\\/\x00-\x1f]/.test(media.filename)) throw new Error('QQ media filename is invalid.');
  const token = await getQQAccessToken(account, fetchImpl);
  const scope = options.conversationType === 'private' ? 'users' : 'groups';
  const base = `${QQ_API_BASE_URL}/v2/${scope}/${encodeURIComponent(targetId)}`;
  const headers = { authorization: `QQBot ${token}`, 'X-Union-Appid': account.appId, 'content-type': 'application/json; charset=utf-8' };
  let binary = '';
  for (let offset = 0; offset < media.bytes.length; offset += 32768) binary += String.fromCharCode(...media.bytes.subarray(offset, offset + 32768));
  const uploaded = await fetchImpl(`${base}/files`, {
    method: 'POST', headers,
    body: JSON.stringify({ file_type: fileType, srv_send_msg: false, file_data: btoa(binary), file_name: media.filename }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploaded.ok) throw new Error('QQ media upload failed.');
  const file = await uploaded.json() as { file_info?: unknown; err_code?: unknown; code?: unknown };
  if ((typeof file.err_code === 'number' && file.err_code !== 0) || (typeof file.code === 'number' && file.code !== 0) || typeof file.file_info !== 'string' || !file.file_info || file.file_info.length > 8192) {
    throw new Error('QQ media upload response is invalid.');
  }
  const response = await fetchImpl(`${base}/messages`, {
    method: 'POST', headers,
    body: JSON.stringify({ msg_type: 7, content: ' ', media: { file_info: file.file_info }, ...(!active ? { msg_id: messageId } : {}), msg_seq: options.seq }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('QQ media message send failed.');
  const result = await response.json() as { err_code?: unknown; code?: unknown };
  if ((typeof result.err_code === 'number' && result.err_code !== 0) || (typeof result.code === 'number' && result.code !== 0)) throw new Error('QQ media message send failed.');
}

export function replyToQQMessage(
  account: QQAccountContext,
  targetId: string,
  messageId: string,
  content: string,
  options: { seq: number; conversationType: 'group' | 'private' } = { seq: 1, conversationType: 'group' },
): Promise<void> {
  return replyToQQGroup(account, targetId, messageId, content, fetch, options.seq, options.conversationType);
}
