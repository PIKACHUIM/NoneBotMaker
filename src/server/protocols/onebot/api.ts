import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';
import { base64Encode } from '../crypto';

type FetchLike = typeof fetch;

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function apiBase(account: ChatAccountContext): string {
  const value = credential(account, 'apiBaseUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OneBot API base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OneBot API base URL is invalid.');
  }
  return value;
}

async function callOneBot(
  account: ChatAccountContext,
  action: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const token = credential(account, 'accessToken');
  const response = await fetchImpl(`${apiBase(account)}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as { status?: unknown; retcode?: unknown };
  if (!response.ok || result.status === 'failed' || (typeof result.retcode === 'number' && result.retcode !== 0)) {
    throw new Error(`OneBot ${action} failed.`);
  }
}

function targetBody(targetId: string, conversationType: 'group' | 'private'): { action: string; body: Record<string, unknown> } {
  return conversationType === 'private'
    ? { action: 'send_private_msg', body: { user_id: targetId } }
    : { action: 'send_group_msg', body: { group_id: targetId } };
}

export async function sendOneBotText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const { action, body } = targetBody(targetId, options.conversationType);
  await callOneBot(account, action, {
    ...body,
    message: [{ type: 'text', data: { text: content.slice(0, 10_000) } }],
  }, fetchImpl);
}

export async function sendOneBotMedia(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const { action, body } = targetBody(targetId, options.conversationType);
  const file = `base64://${base64Encode(media.bytes)}`;
  const segment = media.type === 'image'
    ? { type: 'image', data: { file } }
    : media.type === 'audio'
      ? { type: 'record', data: { file } }
      : media.type === 'video'
        ? { type: 'video', data: { file } }
        : { type: 'file', data: { file, name: media.filename } };
  await callOneBot(account, action, { ...body, message: [segment] }, fetchImpl);
}

export async function sendOneBotProactiveText(
  account: ChatAccountContext,
  targetId: string,
  conversationType: 'group' | 'private',
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendOneBotText(account, targetId, '', content, { seq: 1, conversationType }, fetchImpl);
}
