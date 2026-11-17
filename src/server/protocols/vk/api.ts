import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';
import { randomBytes } from '../crypto';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token || token.length > 4096) throw new Error('VK access token is not configured.');
  return token;
}

function randomId(): number {
  const bytes = randomBytes(4);
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

async function sendMessage(
  account: ChatAccountContext,
  peerId: string,
  message: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!/^\d{1,32}$/.test(peerId)) throw new Error('VK peer id is invalid.');
  const body = new URLSearchParams({
    access_token: accessToken(account),
    v: '5.199',
    peer_id: peerId,
    random_id: String(randomId()),
    message: message.slice(0, 4000),
  });
  const response = await fetchImpl('https://api.vk.com/method/messages.send', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({})) as { error?: { error_msg?: unknown } };
  if (!response.ok || result.error) throw new Error(`VK send failed: ${response.status}.`);
}

export async function sendVkText(
  account: ChatAccountContext,
  peerId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, peerId, content, fetchImpl);
}

export async function sendVkMedia(
  _account: ChatAccountContext,
  _peerId: string,
  _messageId: string,
  _media: OutboundMedia,
  _options: ReplyOptions,
): Promise<void> {
  throw new Error('VK media sending requires a prior attachment upload and is not supported.');
}

export async function sendVkProactiveText(
  account: ChatAccountContext,
  peerId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, peerId, content, fetchImpl);
}
