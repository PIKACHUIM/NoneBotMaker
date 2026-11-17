import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const DODO_API_BASE = 'https://botopen.imdodo.com/api/v2';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function authorization(account: ChatAccountContext): string {
  const clientId = credential(account, 'clientId');
  const token = credential(account, 'token');
  if (!clientId || !token) throw new Error('DoDo credentials are not configured.');
  return `Bot ${clientId}.${token}`;
}

async function dodoRequest(
  account: ChatAccountContext,
  path: string,
  init: { body?: BodyInit; contentType?: string },
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${DODO_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: authorization(account),
      ...(init.contentType ? { 'content-type': init.contentType } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as { status?: unknown; message?: unknown; data?: unknown };
  if (!response.ok || result.status !== 0) throw new Error(`DoDo request failed: ${response.status}.`);
  return (result.data ?? {}) as Record<string, unknown>;
}

export async function getDodoGatewayUrl(account: ChatAccountContext, fetchImpl: FetchLike = fetch): Promise<string> {
  const data = await dodoRequest(account, '/websocket/connection', {}, fetchImpl);
  const endpoint = typeof data.endpoint === 'string' ? data.endpoint : '';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('DoDo gateway URL is invalid.');
  }
  if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('DoDo gateway URL is invalid.');
  }
  return url.toString();
}

function jsonBody(value: unknown): { body: string; contentType: string } {
  return { body: JSON.stringify(value), contentType: 'application/json; charset=utf-8' };
}

async function sendChannel(
  account: ChatAccountContext,
  channelId: string,
  messageType: number,
  messageBody: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('DoDo channel id is invalid.');
  await dodoRequest(account, '/channel/message/send', jsonBody({ channelId, messageType, messageBody }), fetchImpl);
}

async function sendPersonal(
  account: ChatAccountContext,
  islandId: string,
  userId: string,
  messageType: number,
  messageBody: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!islandId || !userId) throw new Error('DoDo direct message target is invalid.');
  await dodoRequest(account, '/personal/message/send', jsonBody({
    islandSourceId: islandId,
    dodoSourceId: userId,
    messageType,
    messageBody,
  }), fetchImpl);
}

function directTarget(targetId: string): { islandId: string; userId: string } {
  const separator = targetId.indexOf('|');
  if (separator < 1) throw new Error('DoDo direct message target is missing the island id.');
  return { islandId: targetId.slice(0, separator), userId: targetId.slice(separator + 1) };
}

export async function sendDodoText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (options.conversationType === 'private') {
    const { islandId, userId } = directTarget(targetId);
    await sendPersonal(account, islandId, userId, 1, { content: content.slice(0, 2000) }, fetchImpl);
    return;
  }
  await sendChannel(account, targetId, 1, { content: content.slice(0, 2000) }, fetchImpl);
}

export async function sendDodoMedia(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!media.contentType.startsWith('image/')) {
    throw new Error('DoDo only supports image uploads; other media can be sent as a link.');
  }
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType }), media.filename);
  const uploaded = await dodoRequest(account, '/resource/picture/upload', { body: form }, fetchImpl);
  const url = typeof uploaded.url === 'string' ? uploaded.url : '';
  if (!url) throw new Error('DoDo image upload failed.');
  if (options.conversationType === 'private') {
    const { islandId, userId } = directTarget(targetId);
    await sendPersonal(account, islandId, userId, 2, { url }, fetchImpl);
    return;
  }
  await sendChannel(account, targetId, 2, { url }, fetchImpl);
}

export async function sendDodoProactiveText(
  account: ChatAccountContext,
  targetId: string,
  conversationType: 'group' | 'private',
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendDodoText(account, targetId, '', content, { seq: 1, conversationType }, fetchImpl);
}
