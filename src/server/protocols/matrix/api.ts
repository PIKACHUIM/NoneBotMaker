import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';
import { randomBytes } from '../crypto';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function matrixBaseUrl(account: ChatAccountContext): string {
  const value = credential(account, 'homeserverUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Matrix homeserver URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Matrix homeserver URL is invalid.');
  }
  return value;
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token || token.length > 4096) throw new Error('Matrix access token is not configured.');
  return token;
}

function headers(account: ChatAccountContext): Record<string, string> {
  return { authorization: `Bearer ${accessToken(account)}` };
}

function txnId(): string {
  return `nb${Date.now()}${[...randomBytes(6)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sendEvent(
  account: ChatAccountContext,
  roomId: string,
  content: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!roomId || roomId.length > 256) throw new Error('Matrix room id is invalid.');
  const response = await fetchImpl(
    `${matrixBaseUrl(account)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId()}`,
    {
      method: 'PUT',
      headers: { ...headers(account), 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(content),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`Matrix send failed: ${response.status}.`);
}

export async function sendMatrixText(
  account: ChatAccountContext,
  roomId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendEvent(account, roomId, { msgtype: 'm.text', body: content.slice(0, 16_000) }, fetchImpl);
}

export async function sendMatrixMedia(
  account: ChatAccountContext,
  roomId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const uploaded = await fetchImpl(
    `${matrixBaseUrl(account)}/_matrix/media/v3/upload?filename=${encodeURIComponent(media.filename)}`,
    {
      method: 'POST',
      headers: { ...headers(account), 'content-type': media.contentType || 'application/octet-stream' },
      body: media.bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(60_000),
    },
  );
  const result = await uploaded.json().catch(() => ({})) as { content_uri?: unknown };
  const contentUri = typeof result.content_uri === 'string' ? result.content_uri : '';
  if (!uploaded.ok || !contentUri) throw new Error('Matrix media upload failed.');
  const msgtype = media.contentType.startsWith('image/') ? 'm.image'
    : media.contentType.startsWith('audio/') ? 'm.audio'
      : media.contentType.startsWith('video/') ? 'm.video' : 'm.file';
  await sendEvent(account, roomId, {
    msgtype,
    body: media.filename,
    url: contentUri,
    info: { mimetype: media.contentType || 'application/octet-stream', size: media.bytes.byteLength },
  }, fetchImpl);
}

export async function sendMatrixProactiveText(
  account: ChatAccountContext,
  roomId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMatrixText(account, roomId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
