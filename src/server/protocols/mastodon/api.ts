import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function mastodonInstanceUrl(account: ChatAccountContext): string {
  const value = credential(account, 'instanceUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Mastodon instance URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Mastodon instance URL is invalid.');
  }
  return value;
}

export function mastodonStreamUrl(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token) throw new Error('Mastodon access token is not configured.');
  const url = new URL(`${mastodonInstanceUrl(account)}/api/v1/streaming`);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('stream', 'user');
  url.searchParams.set('access_token', token);
  return url.toString();
}

function authorization(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token) throw new Error('Mastodon access token is not configured.');
  return `Bearer ${token}`;
}

function handle(value: string): string {
  return value.startsWith('acct:') ? value.slice(5) : value;
}

async function createStatus(
  account: ChatAccountContext,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  const response = await fetchImpl(`${mastodonInstanceUrl(account)}/api/v1/statuses`, {
    method: 'POST',
    headers: { authorization: authorization(account), 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Mastodon post failed: ${response.status}.`);
}

export async function sendMastodonText(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  content: string,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const acct = handle(targetId);
  const mention = acct ? `@${acct} ` : '';
  const inReplyTo = /^\d{1,32}$/.test(messageId) ? messageId : undefined;
  await createStatus(account, {
    status: `${mention}${content}`.slice(0, 500),
    visibility: options.conversationType === 'private' ? 'direct' : 'unlisted',
    ...(inReplyTo ? { in_reply_to_id: inReplyTo } : {}),
  }, fetchImpl);
}

export async function sendMastodonMedia(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  form.append('description', media.filename);
  const uploaded = await fetchImpl(`${mastodonInstanceUrl(account)}/api/v2/media`, {
    method: 'POST',
    headers: { authorization: authorization(account) },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await uploaded.json().catch(() => ({})) as { id?: unknown };
  const mediaId = typeof result.id === 'string' ? result.id : '';
  if (!uploaded.ok || !mediaId) throw new Error('Mastodon media upload failed.');
  const acct = handle(targetId);
  const mention = acct ? `@${acct} ` : '';
  const inReplyTo = /^\d{1,32}$/.test(messageId) ? messageId : undefined;
  await createStatus(account, {
    status: `${mention}${media.filename}`.slice(0, 500),
    visibility: options.conversationType === 'private' ? 'direct' : 'unlisted',
    media_ids: [mediaId],
    ...(inReplyTo ? { in_reply_to_id: inReplyTo } : {}),
  }, fetchImpl);
}

export async function sendMastodonProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const acct = handle(targetId);
  await createStatus(account, {
    status: `${acct ? `@${acct} ` : ''}${content}`.slice(0, 500),
    visibility: 'unlisted',
  }, fetchImpl);
}
