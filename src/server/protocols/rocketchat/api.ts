import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function rocketChatBaseUrl(account: ChatAccountContext): string {
  const value = credential(account, 'serverUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Rocket.Chat server URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Rocket.Chat server URL is invalid.');
  }
  return value;
}

function authHeaders(account: ChatAccountContext): Record<string, string> {
  const userId = credential(account, 'userId');
  const token = credential(account, 'authToken');
  if (!userId || !token) throw new Error('Rocket.Chat credentials are not configured.');
  return { 'x-user-id': userId, 'x-auth-token': token };
}

async function postMessage(
  account: ChatAccountContext,
  roomId: string,
  text: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!roomId || roomId.length > 128) throw new Error('Rocket.Chat room id is invalid.');
  const response = await fetchImpl(`${rocketChatBaseUrl(account)}/api/v1/chat.postMessage`, {
    method: 'POST',
    headers: { ...authHeaders(account), 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ roomId, text: text.slice(0, 5000) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Rocket.Chat send failed: ${response.status}.`);
}

export async function sendRocketChatText(
  account: ChatAccountContext,
  roomId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await postMessage(account, roomId, content, fetchImpl);
}

export async function sendRocketChatMedia(
  account: ChatAccountContext,
  roomId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!roomId || roomId.length > 128) throw new Error('Rocket.Chat room id is invalid.');
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await fetchImpl(`${rocketChatBaseUrl(account)}/api/v1/rooms.media/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: authHeaders(account),
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await uploaded.json().catch(() => ({})) as { file?: { _id?: unknown } };
  const fileId = typeof result.file?._id === 'string' ? result.file._id : '';
  if (!uploaded.ok || !fileId) throw new Error('Rocket.Chat file upload failed.');
  const confirm = await fetchImpl(
    `${rocketChatBaseUrl(account)}/api/v1/rooms.mediaConfirm/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}`,
    {
      method: 'POST',
      headers: { ...authHeaders(account), 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ description: media.filename }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!confirm.ok) throw new Error(`Rocket.Chat media confirm failed: ${confirm.status}.`);
}

export async function sendRocketChatProactiveText(
  account: ChatAccountContext,
  roomId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await postMessage(account, roomId, content, fetchImpl);
}
