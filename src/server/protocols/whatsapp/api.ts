import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function phoneNumberId(account: ChatAccountContext): string {
  const id = credential(account, 'phoneNumberId') || account.appId;
  if (!/^\d{5,20}$/.test(id)) throw new Error('WhatsApp Phone Number ID is not configured.');
  return id;
}

function accessToken(account: ChatAccountContext): string {
  const token = credential(account, 'accessToken');
  if (!token || token.length > 4096) throw new Error('WhatsApp access token is not configured.');
  return token;
}

async function callGraph(
  account: ChatAccountContext,
  path: string,
  init: { json?: unknown; form?: FormData },
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken(account)}` };
  if (init.json !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  let response: Response;
  try {
    response = await fetchImpl(`${GRAPH_API}/${path}`, {
      method: 'POST',
      headers,
      body: init.form ?? JSON.stringify(init.json ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('WhatsApp Graph API request failed.');
  }
  const result = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
  if (!response.ok || result.error) {
    const reason = typeof result.error?.message === 'string' ? result.error.message : String(response.status);
    throw new Error(`WhatsApp request failed: ${reason}.`);
  }
  return result as Record<string, unknown>;
}

async function sendMessage(
  account: ChatAccountContext,
  to: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!to || to.length > 32) throw new Error('WhatsApp recipient is invalid.');
  await callGraph(account, `${phoneNumberId(account)}/messages`, {
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...body },
  }, fetchImpl);
}

export async function sendWhatsAppText(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendMessage(account, targetId, {
    type: 'text',
    text: { preview_url: false, body: content.slice(0, 4096) },
  }, fetchImpl);
}

export async function sendWhatsAppMedia(
  account: ChatAccountContext,
  targetId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', media.contentType || 'application/octet-stream');
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await callGraph(account, `${phoneNumberId(account)}/media`, { form }, fetchImpl);
  const mediaId = typeof uploaded.id === 'string' ? uploaded.id : '';
  if (!mediaId) throw new Error('WhatsApp media upload did not return an id.');

  const kind = media.type === 'file' ? 'document' : media.type;
  const payload: Record<string, unknown> = { id: mediaId };
  if (kind !== 'audio') payload.caption = media.filename;
  if (kind === 'document') payload.filename = media.filename;
  await sendMessage(account, targetId, { type: kind, [kind]: payload }, fetchImpl);
}

export async function sendWhatsAppProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendWhatsAppText(account, targetId, '', content, { seq: 1, conversationType: 'private' }, fetchImpl);
}
