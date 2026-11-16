/** Shared request helpers for webhook adapters. */

export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export class WebhookBodyError extends Error {
  constructor(readonly status: 400 | 413, readonly code: string) {
    super(code);
    this.name = 'WebhookBodyError';
  }
}

export async function readWebhookBody(request: Request, maxBytes = MAX_WEBHOOK_BODY_BYTES): Promise<string> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) throw new WebhookBodyError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookBodyError(400, 'empty_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new WebhookBodyError(413, 'body_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new WebhookBodyError(400, 'empty_body');
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new WebhookBodyError(400, 'invalid_encoding');
  }
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let size = 0;
  for (const character of value) {
    const bytes = encoder.encode(character).byteLength;
    if (size + bytes > maxBytes) break;
    result += character;
    size += bytes;
  }
  return result;
}

/** Reads a CDATA or plain XML element without pulling in a full XML parser. */
export function xmlValue(xml: string, tag: string): string {
  const cdata = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`).exec(xml);
  if (cdata) return cdata[1];
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return plain ? plain[1] : '';
}
