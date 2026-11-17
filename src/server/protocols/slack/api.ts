import type { ChatAccountContext } from '../types';
import type { OutboundMedia, ReplyOptions } from '../../plugins/chatbot/handler';

type FetchLike = typeof fetch;

const SLACK_API = 'https://slack.com/api';

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function botToken(account: ChatAccountContext): string {
  const token = credential(account, 'botToken');
  if (!token || token.length > 512) throw new Error('Slack Bot Token is not configured.');
  return token;
}

interface SlackCall {
  json?: unknown;
  form?: URLSearchParams;
  body?: BodyInit;
  contentType?: string;
}

async function callSlack(
  account: ChatAccountContext,
  method: string,
  call: SlackCall,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { authorization: `Bearer ${botToken(account)}` };
  let body: BodyInit;
  if (call.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = call.form.toString();
  } else if (call.body) {
    if (call.contentType) headers['content-type'] = call.contentType;
    body = call.body;
  } else {
    headers['content-type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(call.json ?? {});
  }
  let response: Response;
  try {
    response = await fetchImpl(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Slack ${method} request failed.`);
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.ok !== true) {
    const error = typeof result.error === 'string' ? result.error : String(response.status);
    throw new Error(`Slack ${method} failed: ${error}.`);
  }
  return result;
}

export async function sendSlackText(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  content: string,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('Slack channel id is invalid.');
  await callSlack(account, 'chat.postMessage', {
    json: {
      channel: channelId,
      text: content.slice(0, 12_000),
      unfurl_links: false,
      unfurl_media: false,
    },
  }, fetchImpl);
}

export async function sendSlackMedia(
  account: ChatAccountContext,
  channelId: string,
  _messageId: string,
  media: OutboundMedia,
  _options: ReplyOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!channelId || channelId.length > 64) throw new Error('Slack channel id is invalid.');
  const upload = await callSlack(account, 'files.getUploadURLExternal', {
    form: new URLSearchParams({ filename: media.filename, length: String(media.bytes.byteLength) }),
  }, fetchImpl);
  const uploadUrl = typeof upload.upload_url === 'string' ? upload.upload_url : '';
  const fileId = typeof upload.file_id === 'string' ? upload.file_id : '';
  if (!uploadUrl || !fileId) throw new Error('Slack upload URL request failed.');

  let target: URL;
  try {
    target = new URL(uploadUrl);
  } catch {
    throw new Error('Slack upload URL is invalid.');
  }
  if (target.protocol !== 'https:' || !(target.hostname === 'slack.com' || target.hostname.endsWith('.slack.com'))) {
    throw new Error('Slack upload URL is not trusted.');
  }

  const form = new FormData();
  form.append('file', new Blob([media.bytes as unknown as BlobPart], { type: media.contentType || 'application/octet-stream' }), media.filename);
  const response = await fetchImpl(target.toString(), { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Slack file upload failed.');

  await callSlack(account, 'files.completeUploadExternal', {
    json: { files: [{ id: fileId, title: media.filename }], channel_id: channelId },
  }, fetchImpl);
}

export async function sendSlackProactiveText(
  account: ChatAccountContext,
  channelId: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await sendSlackText(account, channelId, '', content, { seq: 1, conversationType: 'group' }, fetchImpl);
}
