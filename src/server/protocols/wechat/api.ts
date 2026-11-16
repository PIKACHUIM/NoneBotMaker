import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';
import { truncateUtf8 } from '../http';

type FetchLike = typeof fetch;

interface CachedToken { value: string; expiresAt: number }

const WECHAT_API = 'https://api.weixin.qq.com';
const tokenCache = new Map<string, CachedToken>();

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export async function getWeChatAccessToken(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const secret = credential(account, 'appSecret');
  if (!secret) throw new Error('WeChat AppSecret is not configured.');
  const cacheKey = `${account.appId}:${secret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const url = `${WECHAT_API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(account.appId)}&secret=${encodeURIComponent(secret)}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  const result = await response.json() as { access_token?: unknown; expires_in?: unknown; errcode?: unknown; errmsg?: unknown };
  if (!response.ok || typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('WeChat access token request failed.');
  }
  const expiresIn = typeof result.expires_in === 'number' && result.expires_in > 0 ? result.expires_in : 7200;
  if (tokenCache.size >= 200) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(cacheKey, { value: result.access_token, expiresAt: now() + expiresIn * 1000 });
  return result.access_token;
}

async function wechatCustomSend(account: ChatAccountContext, body: Record<string, unknown>, fetchImpl: FetchLike): Promise<void> {
  const token = await getWeChatAccessToken(account, fetchImpl);
  const response = await fetchImpl(`${WECHAT_API}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({})) as { errcode?: unknown };
  if (!response.ok || (typeof result.errcode === 'number' && result.errcode !== 0)) {
    throw new Error('WeChat customer-service message failed.');
  }
}

export async function sendWeChatText(
  account: ChatAccountContext,
  openId: string,
  content: string,
  _options: ReplyOptions = { seq: 1, conversationType: 'private' },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!openId || openId.length > 256) throw new Error('WeChat openid is invalid.');
  await wechatCustomSend(account, { touser: openId, msgtype: 'text', text: { content: truncateUtf8(content, 2048) } }, fetchImpl);
}

async function uploadWeChatMedia(
  account: ChatAccountContext,
  media: OutboundMedia,
  fetchImpl: FetchLike,
): Promise<string> {
  const type = media.type === 'image' ? 'image' : media.type === 'audio' ? 'voice' : media.type === 'video' ? 'video' : 'file';
  const token = await getWeChatAccessToken(account, fetchImpl);
  const form = new FormData();
  form.append('media', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(`${WECHAT_API}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${type}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as { media_id?: unknown; errcode?: unknown };
  if (!response.ok || typeof result.media_id !== 'string' || !result.media_id) {
    throw new Error('WeChat media upload failed.');
  }
  return result.media_id;
}

export async function sendWeChatMedia(
  account: ChatAccountContext,
  openId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (media.type === 'file') throw new Error('WeChat customer-service messages do not support files.');
  const mediaId = await uploadWeChatMedia(account, media, fetchImpl);
  const body = media.type === 'image'
    ? { touser: openId, msgtype: 'image', image: { media_id: mediaId } }
    : media.type === 'audio'
      ? { touser: openId, msgtype: 'voice', voice: { media_id: mediaId } }
      : { touser: openId, msgtype: 'video', video: { media_id: mediaId, title: media.filename, description: '' } };
  await wechatCustomSend(account, body, fetchImpl);
}
