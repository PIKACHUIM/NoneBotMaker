import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

interface CachedToken { value: string; expiresAt: number }

const DINGTALK_API = 'https://api.dingtalk.com';
const tokenCache = new Map<string, CachedToken>();

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export async function getDingTalkAccessToken(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const appKey = credential(account, 'appKey') || account.appId;
  const appSecret = credential(account, 'appSecret');
  if (!appKey || !appSecret) throw new Error('DingTalk AppKey and AppSecret are required.');
  const cacheKey = `${appKey}:${appSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now() > 60_000) return cached.value;

  const response = await fetchImpl(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ appKey, appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { accessToken?: unknown; expireIn?: unknown };
  if (!response.ok || typeof result.accessToken !== 'string' || !result.accessToken) {
    throw new Error('DingTalk access token request failed.');
  }
  const expiresIn = typeof result.expireIn === 'number' && result.expireIn > 0 ? result.expireIn : 7200;
  if (tokenCache.size >= 200) tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(cacheKey, { value: result.accessToken, expiresAt: now() + expiresIn * 1000 });
  return result.accessToken;
}

/** sessionWebhook is short-lived and must only point at DingTalk-controlled hosts. */
export function isSafeSessionWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dingtalk.com' || url.hostname.endsWith('.dingtalk.com'));
  } catch {
    return false;
  }
}

export async function replyToDingTalkSession(
  sessionWebhook: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!isSafeSessionWebhook(sessionWebhook)) throw new Error('DingTalk sessionWebhook is invalid.');
  const response = await fetchImpl(sessionWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ msgtype: 'text', text: { content: content.slice(0, 20_000) } }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({})) as { errcode?: unknown; errmsg?: unknown };
  if (!response.ok || (typeof result.errcode === 'number' && result.errcode !== 0)) {
    throw new Error('DingTalk session reply failed.');
  }
}

export async function sendDingTalkProactiveText(
  account: ChatAccountContext,
  targetId: string,
  conversationType: 'group' | 'private',
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const robotCode = credential(account, 'robotCode');
  if (!robotCode) throw new Error('DingTalk RobotCode is required for proactive messages.');
  const token = await getDingTalkAccessToken(account, fetchImpl);
  const messageParam = JSON.stringify({ content: content.slice(0, 20_000) });
  const endpoint = conversationType === 'private'
    ? `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`
    : `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
  const body = conversationType === 'private'
    ? { robotCode, userIds: [targetId], msgKey: 'sampleText', msgParam: messageParam }
    : { robotCode, openConversationId: targetId, msgKey: 'sampleText', msgParam: messageParam };
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'x-acs-dingtalk-access-token': token, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('DingTalk proactive message send failed.');
}

export async function sendDingTalkText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (options.replyToken) {
    await replyToDingTalkSession(options.replyToken, content, fetchImpl);
    return;
  }
  await sendDingTalkProactiveText(account, targetId, options.conversationType, content, fetchImpl);
}

export async function sendDingTalkMedia(
  _account: ChatAccountContext,
  _targetId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('DingTalk robot callbacks do not support outbound media.');
}
