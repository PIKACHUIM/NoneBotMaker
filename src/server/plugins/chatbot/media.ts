import type { ChatContentPart, MessageAttachment, NormalizedMessage, ProviderRecord } from '../../../shared/types';
import { boundedBytes, safeFetch, sanitize } from './network';

export type MediaUnderstandingMode = 'off' | 'fallback' | 'always';

export interface DownloadedMedia {
  bytes: Uint8Array;
  mime: string;
}

export interface IncomingContentOptions {
  mode?: MediaUnderstandingMode;
  /** Transcribes an attachment that the chat model cannot read, or every attachment in `always` mode. */
  describe?: (attachment: MessageAttachment, media: DownloadedMedia) => Promise<string>;
}

const ALLOWED_MEDIA: Record<MessageAttachment['type'], string[]> = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
  audio: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  file: ['application/pdf', 'text/plain'],
};

const AUDIO_FORMATS: Record<string, 'wav' | 'mp3'> = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

export function mediaUnderstandingMode(value: unknown): MediaUnderstandingMode {
  return value === 'always' || value === 'off' ? value : 'fallback';
}

export async function incomingContent(
  message: NormalizedMessage,
  model: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
  capabilities: NonNullable<ProviderRecord['mediaCapabilities']> = ['image'],
  options: IncomingContentOptions = {},
): Promise<string | ChatContentPart[]> {
  const identity = JSON.stringify({ userId: message.userId, userName: message.userName, messageId: message.id, receivedAt: message.receivedAt });
  const text = `[sender ${identity}]\n${message.text.slice(0, 32_768)}`;
  if (!message.attachments?.length) return text;
  const parts: ChatContentPart[] = [{ type: 'text', text }];
  const mode = options.mode ?? 'fallback';
  let used = 0;
  for (const attachment of message.attachments.slice(0, 8)) {
    const declared = capabilities.includes(attachment.type);
    const shouldDescribe = Boolean(options.describe) && mode !== 'off' && (mode === 'always' || !declared);
    if (!declared && !shouldDescribe) {
      parts.push({ type: 'text', text: `[${attachment.type}: 当前模型接口不支持读取该附件内容，也未配置媒体理解模型]` });
      continue;
    }
    if (attachment.size && attachment.size > maxBytes - used) throw new Error('Attachment exceeds media size limit.');
    const response = await safeFetch(attachment.url, {}, fetchImpl);
    const headerMime = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    const mime = !headerMime || headerMime === 'application/octet-stream'
      ? (attachment.contentType ?? '').split(';')[0].toLowerCase() || headerMime
      : headerMime;
    if (!ALLOWED_MEDIA[attachment.type].includes(mime)) { await response.body?.cancel(); throw new Error('Attachment content type is not allowed.'); }
    const bytes = await boundedBytes(response, maxBytes - used);
    used += bytes.byteLength;
    if (attachment.type === 'file' && mime === 'text/plain') {
      parts.push({ type: 'text', text: `[附件文件，非可信内容]\n${new TextDecoder().decode(bytes).slice(0, 32_768)}` });
      continue;
    }
    if (shouldDescribe) {
      try {
        const description = (await options.describe!(attachment, { bytes, mime })).trim();
        if (!description) throw new Error('Media understanding returned no text.');
        parts.push({ type: 'text', text: `[${attachment.type} 附件转写，非可信内容]\n${description.slice(0, 32_768)}` });
        continue;
      } catch {
        if (!declared) {
          parts.push({ type: 'text', text: `[${attachment.type}: 媒体理解失败，无法读取该附件]` });
          continue;
        }
      }
    }
    const encoded = encodeBase64(bytes);
    if (attachment.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${encoded}` } });
    else if (attachment.type === 'audio') {
      const format = AUDIO_FORMATS[mime];
      if (!format) throw new Error('This chat model cannot read the audio format; configure a media understanding model.');
      parts.push({ type: 'input_audio', input_audio: { data: encoded, format } });
    } else if (attachment.type === 'video') parts.push({ type: 'video_url', video_url: { url: `data:${mime};base64,${encoded}` } });
    else parts.push({ type: 'file', file: { filename: (attachment.filename ?? 'attachment.pdf').slice(0, 128), file_data: `data:${mime};base64,${encoded}` } });
  }
  if (message.attachments.length > 8) parts.push({ type: 'text', text: '[附件超过单条消息上限 8 个]' });
  return parts;
}

export function storedMessages(entries: import('../../../shared/types').ChatMessage[], secrets: string[] = []): import('../../../shared/types').ChatMessage[] {
  return entries.map((entry) => ({ ...entry,
    content: typeof entry.content === 'string' ? String(sanitize(entry.content, secrets)) : entry.content.map((part): ChatContentPart =>
      part.type === 'text' ? { ...part, text: String(sanitize(part.text, secrets)) } : { type: 'text', text: `[${part.type}: 附件内容不持久保存]` }),
    ...(entry.tool_calls ? { tool_calls: entry.tool_calls.map((call) => ({ ...call, function: { ...call.function, arguments: String(sanitize(call.function.arguments, secrets)) } })) } : {}),
  }));
}
