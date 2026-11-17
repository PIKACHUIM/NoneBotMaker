import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export async function sendViberText(
  account: ChatAccountContext,
  receiverId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const token = credential(account, 'authToken');
  const botName = credential(account, 'botName');
  if (!token || !botName || !receiverId || receiverId.length > 64) {
    throw new Error('Viber credentials or receiver id are invalid.');
  }
  const response = await fetchImpl('https://chatapi.viber.com/pa/send_message', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-viber-auth-token': token },
    body: JSON.stringify({
      receiver: receiverId,
      min_api_version: 1,
      sender: { name: botName },
      type: 'text',
      text: content.slice(0, 7000),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({})) as { status?: unknown };
  if (!response.ok || result.status !== 0) throw new Error(`Viber send failed: ${response.status}.`);
}

export async function sendViberMedia(
  _account: ChatAccountContext,
  _receiverId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('Viber media sending requires a public HTTPS URL and is not supported.');
}

export async function sendViberProactiveText(
  account: ChatAccountContext,
  receiverId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendViberText(account, receiverId, '', content, { seq: 1, conversationType: 'private' }, fetchImpl);
}
