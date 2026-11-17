import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const KOOK_API = 'https://www.kookapp.cn/api/v3';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function botToken(account: ChatAccountContext): string {
  const token = credential(account, 'token');
  if (!token || token.length > 512) throw new Error('KOOK Bot Token is not configured.');
  return token;
}

async function callKook(
  account: ChatAccountContext,
  path: string,
  init: { json?: unknown; form?: FormData; method?: string },
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { authorization: `Bot ${botToken(account)}` };
  if (init.json !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  let response: Response;
  try {
    response = await fetchImpl(`${KOOK_API}${path}`, {
      method: init.method ?? 'POST',
      headers,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('KOOK API request failed.');
  }
  const result = await response.json().catch(() => ({})) as { code?: unknown; message?: unknown; data?: unknown };
  if (!response.ok || result.code !== 0) {
    const reason = typeof result.message === 'string' ? result.message : String(response.status);
    throw new Error(`KOOK request failed: ${reason}.`);
  }
  return (result.data ?? {}) as Record<string, unknown>;
}

/** Resolves the current WebSocket gateway URL for the bot. */
export async function getKookGatewayUrl(account: ChatAccountContext, fetchImpl: FetchLike = fetch): Promise<string> {
  const data = await callKook(account, '/gateway/index?compress=0', { method: 'GET', json: undefined }, fetchImpl);
  const url = typeof data.url === 'string' ? data.url : '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('KOOK gateway URL is invalid.');
  }
  if (parsed.protocol !== 'wss:' || !(parsed.hostname === 'kookapp.cn' || parsed.hostname.endsWith('.kookapp.cn'))) {
    throw new Error('KOOK gateway URL is not trusted.');
  }
  return url;
}

export async function sendKookText(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!targetId || targetId.length > 128) throw new Error('KOOK target id is invalid.');
  await callKook(account, '/message/create', {
    json: {
      type: 9,
      target_id: targetId,
      content: content.slice(0, 4000),
      ...(messageId ? { quote: messageId } : {}),
    },
  }, fetchImpl);
}

export async function sendKookMedia(
  account: ChatAccountContext,
  targetId: string,
  messageId: string,
  media: OutboundMedia,
  options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const uploaded = await callKook(account, '/asset/create', { form }, fetchImpl);
  const url = typeof uploaded.url === 'string' ? uploaded.url : '';
  if (!url) throw new Error('KOOK asset upload did not return a URL.');
  const markdown = media.type === 'image' ? `![${media.filename}](${url})` : `[${media.filename}](${url})`;
  await sendKookText(account, targetId, messageId, markdown, options, fetchImpl);
}

export async function sendKookProactiveText(
  account: ChatAccountContext,
  targetId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendKookText(account, targetId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
