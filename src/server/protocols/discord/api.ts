import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const DISCORD_API = 'https://discord.com/api/v10';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function botToken(account: ChatAccountContext): string {
  const token = credential(account, 'botToken');
  if (!token || token.length > 512) throw new Error('Discord Bot Token is not configured.');
  return token;
}

function snowflake(value: string): boolean {
  return /^\d{1,25}$/.test(value);
}

async function callDiscord(
  account: ChatAccountContext,
  path: string,
  init: { json?: unknown; form?: FormData },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const headers: Record<string, string> = { authorization: `Bot ${botToken(account)}` };
  if (init.json !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  let response: Response;
  try {
    response = await fetchImpl(`${DISCORD_API}${path}`, {
      method: 'POST',
      headers,
      body: init.form ?? JSON.stringify(init.json ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Discord API request failed.');
  }
  if (!response.ok) throw new Error(`Discord API request failed: ${response.status}.`);
}

function messagePayload(content: string, messageId: string): Record<string, unknown> {
  return {
    content: content.slice(0, 2000),
    allowed_mentions: { parse: [] },
    ...(snowflake(messageId) ? { message_reference: { message_id: messageId, fail_if_not_exists: false } } : {}),
  };
}

export async function sendDiscordText(
  account: ChatAccountContext,
  channelId: string,
  messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!snowflake(channelId)) throw new Error('Discord channel id is invalid.');
  await callDiscord(account, `/channels/${channelId}/messages`, { json: messagePayload(content, messageId) }, fetchImpl);
}

export async function sendDiscordMedia(
  account: ChatAccountContext,
  channelId: string,
  messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!snowflake(channelId)) throw new Error('Discord channel id is invalid.');
  const form = new FormData();
  form.append('payload_json', JSON.stringify(messagePayload('', messageId)));
  form.append('files[0]', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  await callDiscord(account, `/channels/${channelId}/messages`, { form }, fetchImpl);
}

export async function sendDiscordProactiveText(
  account: ChatAccountContext,
  channelId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendDiscordText(account, channelId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
