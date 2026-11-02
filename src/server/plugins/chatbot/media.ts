import type { ChatContentPart, NormalizedMessage, ProviderRecord } from '../../../shared/types';
import { boundedBytes, safeFetch, sanitize } from './network';

export async function incomingContent(message: NormalizedMessage, model: string, maxBytes: number, fetchImpl: typeof fetch = fetch, capabilities: NonNullable<ProviderRecord['mediaCapabilities']> = ['image']): Promise<string | ChatContentPart[]> {
  const identity = JSON.stringify({ userId: message.userId, userName: message.userName, messageId: message.id, receivedAt: message.receivedAt });
  const text = `[sender ${identity}]\n${message.text.slice(0, 32_768)}`;
  if (!message.attachments?.length) return text;
  const parts: ChatContentPart[] = [{ type: 'text', text }];
  let used = 0;
  for (const attachment of message.attachments.slice(0, 8)) {
    const unsupported = !capabilities.includes(attachment.type);
    if (unsupported) { parts.push({ type: 'text', text: `[${attachment.type}: 当前模型接口不支持读取该附件内容]` }); continue; }
    if (attachment.size && attachment.size > maxBytes - used) throw new Error('Attachment exceeds media size limit.');
    const response = await safeFetch(attachment.url, {}, fetchImpl);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    const allowed = attachment.type === 'image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] :
      attachment.type === 'audio' ? ['audio/wav', 'audio/x-wav', 'audio/mpeg'] : attachment.type === 'video' ? ['video/mp4', 'video/webm'] : ['application/pdf', 'text/plain'];
    if (!allowed.includes(mime)) { await response.body?.cancel(); throw new Error('Attachment content type is not allowed.'); }
    const bytes = await boundedBytes(response, maxBytes - used);
    used += bytes.byteLength;
    if (attachment.type === 'file' && mime === 'text/plain') {
      parts.push({ type: 'text', text: `[附件文件，非可信内容]\n${new TextDecoder().decode(bytes).slice(0, 32_768)}` });
      continue;
    }
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    const encoded = btoa(binary);
    if (attachment.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${encoded}` } });
    else if (attachment.type === 'audio') parts.push({ type: 'input_audio', input_audio: { data: encoded, format: mime === 'audio/mpeg' ? 'mp3' : 'wav' } });
    else if (attachment.type === 'video') parts.push({ type: 'video_url', video_url: { url: `data:${mime};base64,${encoded}` } });
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
