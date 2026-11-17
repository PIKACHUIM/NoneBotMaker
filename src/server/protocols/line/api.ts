import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const LINE_API = 'https://api.line.me';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'channelAccessToken');
  if (!token || token.length > 4096) throw new Error('LINE Channel Access Token is not configured.');
  return token;
}

async function pushMessages(
  account: ChatAccountContext,
  targetId: string,
  messages: unknown[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!targetId || targetId.length > 128) throw new Error('LINE target id is invalid.');
  let response: Response;
  try {
    response = await fetchImpl(`${LINE_API}/v2/bot/message/push`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken(account)}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ to: targetId, messages }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('LINE push request failed.');
  }
  if (!response.ok) throw new Error(`LINE push failed: ${response.status}.`);
}

export async function sendLineText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await pushMessages(account, targetId, [{ type: 'text', text: content.slice(0, 5000) }], fetchImpl);
}

export async function sendLineMedia(
  _account: ChatAccountContext,
  _targetId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('LINE media messages require public HTTPS URLs; only text is supported.');
}

export async function sendLineProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendLineText(account, targetId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
