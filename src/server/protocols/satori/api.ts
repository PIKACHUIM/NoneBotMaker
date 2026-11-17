import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function satoriEndpoint(account: ChatAccountContext): string {
  const value = (credential(account, 'endpoint') || '').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Satori endpoint is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Satori endpoint is invalid.');
  }
  return value;
}

/** Converts the configured HTTP endpoint into the Satori events WebSocket URL. */
export function satoriEventsUrl(account: ChatAccountContext): string {
  const url = new URL(`${satoriEndpoint(account)}/v1/events`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function sendSatoriText(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!channelId || channelId.length > 128) throw new Error('Satori channel id is invalid.');
  const token = credential(account, 'token');
  const platform = credential(account, 'platform');
  const selfId = credential(account, 'selfId') || account.appId;
  if (!platform) throw new Error('Satori platform is not configured.');
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'satori-platform': platform,
    'satori-user-id': selfId,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(`${satoriEndpoint(account)}/v1/message.create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel_id: channelId, content: content.slice(0, 20_000) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Satori message request failed.');
  }
  if (!response.ok) throw new Error(`Satori message request failed: ${response.status}.`);
}

export async function sendSatoriMedia(
  _account: ChatAccountContext,
  _channelId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('Satori media messages are not supported; only text is sent.');
}

export async function sendSatoriProactiveText(
  account: ChatAccountContext,
  channelId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendSatoriText(account, channelId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
