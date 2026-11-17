import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function misskeyBaseUrl(account: ChatAccountContext): string {
  const value = credential(account, 'host').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Misskey host is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Misskey host is invalid.');
  }
  return value;
}

export function misskeyStreamUrl(account: ChatAccountContext): string {
  const token = credential(account, 'token');
  if (!token) throw new Error('Misskey token is not configured.');
  const url = new URL(`${misskeyBaseUrl(account)}/streaming`);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('i', token);
  return url.toString();
}

async function createNote(
  account: ChatAccountContext,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  const token = credential(account, 'token');
  if (!token) throw new Error('Misskey token is not configured.');
  const response = await fetchImpl(`${misskeyBaseUrl(account)}/api/notes/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ i: token, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Misskey note failed: ${response.status}.`);
}

function target(targetId: string): { kind: 'channel'; id: string } | { kind: 'user'; id: string } {
  if (targetId.startsWith('channel:')) return { kind: 'channel', id: targetId.slice(8) };
  if (targetId.startsWith('user:')) return { kind: 'user', id: targetId.slice(5) };
  throw new Error('Misskey conversation id is invalid.');
}

export async function sendMisskeyText(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  content: string,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const destination = target(targetId);
  const text = content.slice(0, 3000);
  if (destination.kind === 'channel') {
    await createNote(account, { text, channelId: destination.id, visibility: 'public' }, fetchImpl);
    return;
  }
  if (options.conversationType === 'private') {
    await createNote(account, { text, visibility: 'specified', toUserIds: [destination.id] }, fetchImpl);
    return;
  }
  await createNote(account, {
    text,
    visibility: 'public',
    ...(/^[A-Za-z0-9]{8,32}$/.test(messageId) ? { replyId: messageId } : {}),
  }, fetchImpl);
}

export async function sendMisskeyMedia(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const token = credential(account, 'token');
  if (!token) throw new Error('Misskey token is not configured.');
  const form = new FormData();
  form.append('i', token);
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await fetchImpl(`${misskeyBaseUrl(account)}/api/drive/files/create`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await uploaded.json().catch(() => ({})) as { id?: unknown };
  const fileId = typeof result.id === 'string' ? result.id : '';
  if (!uploaded.ok || !fileId) throw new Error('Misskey file upload failed.');
  const destination = target(targetId);
  if (destination.kind === 'channel') {
    await createNote(account, { text: '', channelId: destination.id, visibility: 'public', fileIds: [fileId] }, fetchImpl);
    return;
  }
  if (options.conversationType === 'private') {
    await createNote(account, { text: '', visibility: 'specified', toUserIds: [destination.id], fileIds: [fileId] }, fetchImpl);
    return;
  }
  await createNote(account, {
    text: '',
    visibility: 'public',
    fileIds: [fileId],
    ...(/^[A-Za-z0-9]{8,32}$/.test(messageId) ? { replyId: messageId } : {}),
  }, fetchImpl);
}

export async function sendMisskeyProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMisskeyText(account, targetId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
