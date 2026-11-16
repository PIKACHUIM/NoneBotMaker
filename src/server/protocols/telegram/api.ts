import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

export interface TelegramBotIdentity {
  id: string;
  username: string;
  name: string;
}

const botCache = new Map<string, TelegramBotIdentity>();

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function botToken(account: ChatAccountContext): string {
  const token = credential(account, 'botToken');
  if (!token || token.length > 256) throw new Error('Telegram Bot Token is not configured.');
  return token;
}

async function callTelegram(
  account: ChatAccountContext,
  method: string,
  init: { body?: unknown; form?: FormData },
  fetchImpl: FetchLike = fetch,
): Promise<unknown> {
  const token = botToken(account);
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      ...(init.form ? { body: init.form } : { headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(init.body ?? {}) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`Telegram ${method} request failed.`);
  }
  const result = await response.json().catch(() => ({})) as { ok?: unknown; result?: unknown };
  if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed.`);
  return result.result;
}

export async function getTelegramBotIdentity(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
): Promise<TelegramBotIdentity> {
  const cached = botCache.get(account.appId);
  if (cached) return cached;
  const result = await callTelegram(account, 'getMe', {}, fetchImpl) as {
    id?: unknown; username?: unknown; first_name?: unknown;
  };
  const id = typeof result?.id === 'number' || typeof result?.id === 'string' ? String(result.id) : account.appId;
  const identity: TelegramBotIdentity = {
    id,
    username: typeof result?.username === 'string' ? result.username : '',
    name: typeof result?.first_name === 'string' ? result.first_name : '',
  };
  if (botCache.size >= 200) botCache.delete(botCache.keys().next().value!);
  botCache.set(account.appId, identity);
  return identity;
}

function replyParameters(messageId: string): Record<string, unknown> | undefined {
  if (!/^\d{1,20}$/.test(messageId)) return undefined;
  return { message_id: Number(messageId), allow_sending_without_reply: true };
}

export async function sendTelegramText(
  account: ChatAccountContext,
  chatId: string,
  messageId: string,
  content: string,
  options: ReplyOptions = { seq: 1, conversationType: 'group' },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!chatId || chatId.length > 64) throw new Error('Telegram chat id is invalid.');
  const reply = replyParameters(messageId);
  await callTelegram(account, 'sendMessage', {
    body: {
      chat_id: chatId,
      text: content.slice(0, 4096),
      ...(reply ? { reply_parameters: reply } : {}),
      ...(options.conversationType === 'group' ? { link_preview_options: { is_disabled: true } } : {}),
    },
  }, fetchImpl);
}

export async function sendTelegramMedia(
  account: ChatAccountContext,
  chatId: string,
  messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!chatId || chatId.length > 64) throw new Error('Telegram chat id is invalid.');
  const method = media.type === 'image' ? 'sendPhoto' : media.type === 'audio' ? 'sendAudio' : media.type === 'video' ? 'sendVideo' : 'sendDocument';
  const field = media.type === 'image' ? 'photo' : media.type === 'audio' ? 'audio' : media.type === 'video' ? 'video' : 'document';
  const form = new FormData();
  form.append('chat_id', chatId);
  const reply = replyParameters(messageId);
  if (reply) form.append('reply_parameters', JSON.stringify(reply));
  form.append(field, new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  await callTelegram(account, method, { form }, fetchImpl);
}

export async function sendTelegramProactiveText(
  account: ChatAccountContext,
  chatId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendTelegramText(account, chatId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
