import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';
import { base64Encode } from '../crypto';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function zulipBaseUrl(account: ChatAccountContext): string {
  const value = credential(account, 'siteUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Zulip site URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Zulip site URL is invalid.');
  }
  return value;
}

function authorization(account: ChatAccountContext): string {
  const email = credential(account, 'botEmail');
  const key = credential(account, 'apiKey');
  if (!email || !key) throw new Error('Zulip bot credentials are not configured.');
  return `Basic ${base64Encode(new TextEncoder().encode(`${email}:${key}`))}`;
}

async function zulipPost(
  account: ChatAccountContext,
  path: string,
  init: { body: BodyInit; contentType?: string },
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${zulipBaseUrl(account)}${path}`, {
    method: 'POST',
    headers: { authorization: authorization(account), ...(init.contentType ? { 'content-type': init.contentType } : {}) },
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.result === 'error') throw new Error(`Zulip request failed: ${response.status}.`);
  return result;
}

function target(account: ChatAccountContext, targetId: string): Record<string, unknown> {
  if (targetId.startsWith('stream:')) {
    const [, streamId, ...rest] = targetId.split(':');
    if (!/^\d{1,32}$/.test(streamId)) throw new Error('Zulip stream id is invalid.');
    return { type: 'stream', to: streamId, topic: rest.join(':').slice(0, 256) || 'general' };
  }
  if (targetId.startsWith('dm:')) {
    const userId = targetId.slice(3);
    if (!/^\d{1,32}$/.test(userId)) throw new Error('Zulip user id is invalid.');
    return { type: 'private', to: [Number(userId)] };
  }
  throw new Error('Zulip conversation id is invalid.');
}

async function sendMessage(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike,
): Promise<void> {
  await zulipPost(account, '/api/v1/messages', {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ...target(account, targetId), content: content.slice(0, 10_000) }),
  }, fetchImpl);
}

export async function sendZulipText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, targetId, content, fetchImpl);
}

export async function sendZulipMedia(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await zulipPost(account, '/api/v1/user_uploads', { body: form }, fetchImpl);
  const uri = typeof uploaded.uri === 'string' ? uploaded.uri : '';
  if (!uri) throw new Error('Zulip file upload failed.');
  await sendMessage(account, targetId, `[${media.filename}](${zulipBaseUrl(account)}${uri})`, fetchImpl);
}

export async function sendZulipProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, targetId, content, fetchImpl);
}
