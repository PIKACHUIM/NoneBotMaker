import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

export function mattermostBaseUrl(account: ChatAccountContext): string {
  const value = (credential(account, 'baseUrl') || account.appId).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Mattermost server URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Mattermost server URL is invalid.');
  }
  return value;
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token || token.length > 4096) throw new Error('Mattermost access token is not configured.');
  return token;
}

async function createPost(
  account: ChatAccountContext,
  channelId: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('Mattermost channel id is invalid.');
  const response = await fetchImpl(`${mattermostBaseUrl(account)}/api/v4/posts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken(account)}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel_id: channelId, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Mattermost post failed: ${response.status}.`);
}

export async function sendMattermostText(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await createPost(account, channelId, { message: content.slice(0, 16_383) }, fetchImpl);
}

export async function sendMattermostMedia(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('Mattermost channel id is invalid.');
  const form = new FormData();
  form.append('channel_id', channelId);
  form.append('files', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(`${mattermostBaseUrl(account)}/api/v4/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken(account)}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json().catch(() => ({})) as { file_infos?: Array<{ id?: unknown }> };
  const fileId = Array.isArray(result.file_infos) ? result.file_infos[0]?.id : undefined;
  if (!response.ok || typeof fileId !== 'string' || !fileId) throw new Error('Mattermost file upload failed.');
  await createPost(account, channelId, { message: media.filename, file_ids: [fileId] }, fetchImpl);
}

export async function sendMattermostProactiveText(
  account: ChatAccountContext,
  channelId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMattermostText(account, channelId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
