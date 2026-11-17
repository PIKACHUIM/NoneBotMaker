import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const QYAPI = 'https://qyapi.weixin.qq.com';
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function corpId(account: ChatAccountContext): string {
  const value = credential(account, 'corpId') || account.appId;
  if (!value) throw new Error('WeCom CorpID is not configured.');
  return value;
}

function agentId(account: ChatAccountContext): number {
  const value = credential(account, 'agentId');
  const parsed = Number(value);
  if (!/^\d{1,12}$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('WeCom AgentID is invalid.');
  }
  return parsed;
}

export async function getWeComAccessToken(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const secret = credential(account, 'secret');
  if (!secret) throw new Error('WeCom AppSecret is not configured.');
  const cacheKey = `${corpId(account)}:${secret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const response = await fetchImpl(
    `${QYAPI}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId(account))}&corpsecret=${encodeURIComponent(secret)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const result = await response.json().catch(() => ({})) as { errcode?: unknown; errmsg?: unknown; access_token?: unknown; expires_in?: unknown };
  if (!response.ok || result.errcode !== 0 || typeof result.access_token !== 'string' || !result.access_token) {
    const reason = typeof result.errmsg === 'string' ? result.errmsg : String(response.status);
    throw new Error(`WeCom access token request failed: ${reason}.`);
  }
  const expiresIn = typeof result.expires_in === 'number' && result.expires_in > 0 ? result.expires_in : 7200;
  if (tokenCache.size >= 200) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(cacheKey, { value: result.access_token, expiresAt: now() + expiresIn * 1000 });
  return result.access_token;
}

async function sendMessage(
  account: ChatAccountContext,
  touser: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!touser || touser.length > 128) throw new Error('WeCom recipient is invalid.');
  const token = await getWeComAccessToken(account, fetchImpl);
  const response = await fetchImpl(`${QYAPI}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ touser, agentid: agentId(account), safe: 0, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({})) as { errcode?: unknown; errmsg?: unknown };
  if (!response.ok || result.errcode !== 0) {
    const reason = typeof result.errmsg === 'string' ? result.errmsg : String(response.status);
    throw new Error(`WeCom message send failed: ${reason}.`);
  }
}

export async function sendWeComText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, targetId, {
    msgtype: 'text',
    text: { content: content.slice(0, 2000) },
  }, fetchImpl);
}

export async function sendWeComMedia(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const token = await getWeComAccessToken(account, fetchImpl);
  const type = media.type === 'image' ? 'image' : media.type === 'audio' ? 'voice' : media.type === 'video' ? 'video' : 'file';
  const form = new FormData();
  form.append('media', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(`${QYAPI}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${type}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json().catch(() => ({})) as { errcode?: unknown; errmsg?: unknown; media_id?: unknown };
  const mediaId = typeof result.media_id === 'string' ? result.media_id : '';
  if (!response.ok || result.errcode !== 0 || !mediaId) {
    const reason = typeof result.errmsg === 'string' ? result.errmsg : String(response.status);
    throw new Error(`WeCom media upload failed: ${reason}.`);
  }
  const payload = type === 'video'
    ? { msgtype: 'video', video: { media_id: mediaId, title: media.filename, description: '' } }
    : type === 'voice'
      ? { msgtype: 'voice', voice: { media_id: mediaId } }
      : type === 'image'
        ? { msgtype: 'image', image: { media_id: mediaId } }
        : { msgtype: 'file', file: { media_id: mediaId } };
  await sendMessage(account, targetId, payload, fetchImpl);
}

export async function sendWeComProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendWeComText(account, targetId, '', content, { seq: 1, conversationType: 'private' }, fetchImpl);
}
