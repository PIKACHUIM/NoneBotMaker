import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

interface CachedToken { value: string; expiresAt: number }

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const tokenCache = new Map<string, CachedToken>();
const botOpenIdCache = new Map<string, string>();

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export async function getFeishuTenantToken(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const appSecret = credential(account, 'appSecret');
  if (!appSecret) throw new Error('Feishu App Secret is not configured.');
  const cacheKey = `${account.appId}:${appSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const response = await fetchImpl(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: account.appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { code?: unknown; tenant_access_token?: unknown; expire?: unknown };
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0) ||
      typeof result.tenant_access_token !== 'string' || !result.tenant_access_token) {
    throw new Error('Feishu tenant access token request failed.');
  }
  const expiresIn = typeof result.expire === 'number' && result.expire > 0 ? result.expire : 7200;
  if (tokenCache.size >= 200) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(cacheKey, { value: result.tenant_access_token, expiresAt: now() + expiresIn * 1000 });
  return result.tenant_access_token;
}

/** The bot's own open_id is needed to tell an @bot mention from an @someone else. */
export async function getFeishuBotOpenId(account: ChatAccountContext, fetchImpl: FetchLike = fetch): Promise<string> {
  const cached = botOpenIdCache.get(account.appId);
  if (cached) return cached;
  const token = await getFeishuTenantToken(account, fetchImpl);
  const response = await fetchImpl(`${FEISHU_API}/bot/v3/info`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { code?: unknown; bot?: { open_id?: unknown } };
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0) || typeof result.bot?.open_id !== 'string') {
    throw new Error('Feishu bot info request failed.');
  }
  if (botOpenIdCache.size >= 200) botOpenIdCache.delete(botOpenIdCache.keys().next().value!);
  botOpenIdCache.set(account.appId, result.bot.open_id);
  return result.bot.open_id;
}

async function feishuSend(
  account: ChatAccountContext,
  chatId: string,
  msgType: 'text' | 'image' | 'file',
  content: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!chatId || chatId.length > 256) throw new Error('Feishu chat id is invalid.');
  const token = await getFeishuTenantToken(account, fetchImpl);
  const response = await fetchImpl(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as { code?: unknown };
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0)) throw new Error('Feishu message send failed.');
}

export async function sendFeishuText(
  account: ChatAccountContext,
  chatId: string,
  content: string,
  _options: ReplyOptions = { seq: 1, conversationType: 'group' },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await feishuSend(account, chatId, 'text', JSON.stringify({ text: content.slice(0, 30_000) }), fetchImpl);
}

async function uploadFeishuImage(account: ChatAccountContext, media: OutboundMedia, fetchImpl: FetchLike): Promise<string> {
  const token = await getFeishuTenantToken(account, fetchImpl);
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'image/png' }), media.filename);
  const response = await fetchImpl(`${FEISHU_API}/im/v1/images`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as { code?: unknown; data?: { image_key?: unknown } };
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0) || typeof result.data?.image_key !== 'string') {
    throw new Error('Feishu image upload failed.');
  }
  return result.data.image_key;
}

async function uploadFeishuFile(account: ChatAccountContext, media: OutboundMedia, fetchImpl: FetchLike): Promise<string> {
  const token = await getFeishuTenantToken(account, fetchImpl);
  const fileType = media.type === 'video' ? 'mp4' : media.type === 'audio' ? 'opus' : 'stream';
  const form = new FormData();
  form.append('file_type', fileType);
  form.append('file_name', media.filename);
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(`${FEISHU_API}/im/v1/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as { code?: unknown; data?: { file_key?: unknown } };
  if (!response.ok || (typeof result.code === 'number' && result.code !== 0) || typeof result.data?.file_key !== 'string') {
    throw new Error('Feishu file upload failed.');
  }
  return result.data.file_key;
}

export async function sendFeishuMedia(
  account: ChatAccountContext,
  chatId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (media.type === 'image') {
    const imageKey = await uploadFeishuImage(account, media, fetchImpl);
    await feishuSend(account, chatId, 'image', JSON.stringify({ image_key: imageKey }), fetchImpl);
    return;
  }
  const fileKey = await uploadFeishuFile(account, media, fetchImpl);
  await feishuSend(account, chatId, 'file', JSON.stringify({ file_key: fileKey }), fetchImpl);
}
