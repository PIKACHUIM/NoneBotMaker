import type { ChatAccountContext } from '../types';
import type { ReplyOptions } from '../../plugins/chatbot/handler';
import type { OutboundMedia } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'pageAccessToken');
  if (!token || token.length > 4096) throw new Error('Instagram page access token is not configured.');
  return token;
}

export async function sendInstagramText(
  account: ChatAccountContext,
  recipientId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const igUserId = credential(account, 'igUserId');
  if (!igUserId || !recipientId || recipientId.length > 64) throw new Error('Instagram recipient id is invalid.');
  const response = await fetchImpl(`https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${accessToken(account)}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: content.slice(0, 1000) } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Instagram send failed: ${response.status}.`);
}

export async function sendInstagramMedia(
  _account: ChatAccountContext,
  _recipientId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('Instagram media sending requires a public HTTPS URL and is not supported.');
}

export async function sendInstagramProactiveText(
  account: ChatAccountContext,
  recipientId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendInstagramText(account, recipientId, '', content, { seq: 1, conversationType: 'private' }, fetchImpl);
}
