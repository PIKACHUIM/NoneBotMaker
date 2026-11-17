import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const DEFAULT_API_URL = 'https://api.revolt.chat';
const DEFAULT_AUTUMN_URL = 'https://autumn.revolt.chat';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function revoltApiUrl(account: ChatAccountContext): string {
  return (credential(account, 'apiUrl') || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function revoltGatewayUrl(account: ChatAccountContext): string {
  const value = credential(account, 'wsUrl') || 'wss://ws.revolt.chat';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Revolt WebSocket URL is invalid.');
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Revolt WebSocket URL is invalid.');
  }
  return url.toString();
}

function authHeaders(account: ChatAccountContext): Record<string, string> {
  const token = credential(account, 'botToken');
  if (!token || token.length > 4096) throw new Error('Revolt bot token is not configured.');
  return { 'x-bot-token': token };
}

async function sendMessage(
  account: ChatAccountContext,
  channelId: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('Revolt channel id is invalid.');
  const response = await fetchImpl(`${revoltApiUrl(account)}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: { ...authHeaders(account), 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Revolt send failed: ${response.status}.`);
}

async function autumnUrl(account: ChatAccountContext, fetchImpl: FetchLike): Promise<string> {
  try {
    const response = await fetchImpl(`${revoltApiUrl(account)}/`, { signal: AbortSignal.timeout(10_000) });
    const result = await response.json().catch(() => ({})) as { features?: { autumn?: { url?: unknown } } };
    const url = typeof result.features?.autumn?.url === 'string' ? result.features.autumn.url : '';
    if (url && /^https?:\/\//i.test(url)) return url.replace(/\/+$/, '');
  } catch {
    // Fall back to the public file server below.
  }
  return DEFAULT_AUTUMN_URL;
}

export async function sendRevoltText(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, channelId, { content: content.slice(0, 2000) }, fetchImpl);
}

export async function sendRevoltMedia(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(`${await autumnUrl(account, fetchImpl)}/attachments`, {
    method: 'POST',
    headers: authHeaders(account),
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json().catch(() => ({})) as { id?: unknown };
  const fileId = typeof result.id === 'string' ? result.id : '';
  if (!response.ok || !fileId) throw new Error('Revolt file upload failed.');
  await sendMessage(account, channelId, {
    content: '',
    attachments: [{ _id: fileId, tag: 'attachments', filename: media.filename }],
  }, fetchImpl);
}

export async function sendRevoltProactiveText(
  account: ChatAccountContext,
  channelId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, channelId, { content: content.slice(0, 2000) }, fetchImpl);
}
