import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const GRAPH_VERSION = 'v21.0';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'pageAccessToken');
  if (!token || token.length > 4096) throw new Error('Messenger page access token is not configured.');
  return token;
}

async function graphRequest(
  account: ChatAccountContext,
  path: string,
  init: { body?: BodyInit; headers?: Record<string, string> },
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}${path}`, {
    method: 'POST',
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken(account)}` },
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof result.error === 'object') {
    throw new Error(`Messenger request failed: ${response.status}.`);
  }
  return result;
}

function sendBody(recipientId: string, message: Record<string, unknown>): string {
  return JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message });
}

export async function sendMessengerText(
  account: ChatAccountContext,
  recipientId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!recipientId || recipientId.length > 64) throw new Error('Messenger recipient id is invalid.');
  await graphRequest(account, '/me/messages', {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: sendBody(recipientId, { text: content.slice(0, 2000) }),
  }, fetchImpl);
}

export async function sendMessengerMedia(
  account: ChatAccountContext,
  recipientId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!recipientId || recipientId.length > 64) throw new Error('Messenger recipient id is invalid.');
  const type = media.contentType.startsWith('image/') ? 'image'
    : media.contentType.startsWith('audio/') ? 'audio'
      : media.contentType.startsWith('video/') ? 'video' : 'file';
  const form = new FormData();
  form.append('message', JSON.stringify({ attachment: { type, payload: { is_reusable: true } } }));
  form.append('filedata', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await graphRequest(account, '/me/message_attachments', { body: form }, fetchImpl);
  const attachmentId = typeof uploaded.attachment_id === 'string' ? uploaded.attachment_id : '';
  if (!attachmentId) throw new Error('Messenger attachment upload failed.');
  await graphRequest(account, '/me/messages', {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: sendBody(recipientId, { attachment: { type, payload: { attachment_id: attachmentId } } }),
  }, fetchImpl);
}

export async function sendMessengerProactiveText(
  account: ChatAccountContext,
  recipientId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessengerText(account, recipientId, '', content, { seq: 1, conversationType: 'private' }, fetchImpl);
}
