const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * OpenAI兼容服务通常要求 /v1 前缀。只填主机（或误填完整接口地址）时自动补全，
 * 已带版本段或自定义路径的保持原样，避免把 /api/v1 之类写成 /api/v1/v1。
 */
export function openAiEndpoint(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl);
  const suffix = `/${endpoint.replace(/^\/+/, '')}`;
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.toLowerCase().endsWith(suffix.toLowerCase())) pathname = pathname.slice(0, -suffix.length);
  pathname = pathname.replace(/\/chat\/completions$/i, '');
  if (!pathname) pathname = '/v1';
  url.pathname = `${pathname}${suffix}`;
  return url.toString();
}

export function publicHttpsUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host) && !publicIPv4(host)) {
    throw new Error('Only public HTTPS endpoints without credentials are allowed.');
  }
  return url;
}

function publicIPv4(value: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  const octets = value.split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113);
}

async function verifyPublicDns(url: URL, fetchImpl: typeof fetch): Promise<void> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return;
  // 边缘运行时缺少通用 DNS API，先拒绝解析结果中的非公网地址。
  const answers = await Promise.all(['A', 'AAAA'].map(async (type) => {
    const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(url.hostname)}&type=${type}`, {
      headers: { accept: 'application/dns-json' }, redirect: 'manual', signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('Public DNS verification failed.');
    const result = JSON.parse(await boundedText(response, 64 * 1024)) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (result.Status !== 0) throw new Error('Public DNS verification failed.');
    return (result.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28).map((answer) => answer.data);
  }));
  const addresses = answers.flat();
  if (!addresses.length || addresses.some((address) => address.includes(':')
    ? !/^[23][0-9a-f]{3}:/i.test(address) || /^2001:(db8|0):/i.test(address)
    : !publicIPv4(address))) throw new Error('Endpoint resolves to a non-public address.');
}

export async function boundedBytes(response: Response, limit = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) { await response.body?.cancel(); throw new Error('Response exceeds size limit.'); }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Response exceeds size limit.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function boundedText(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  return new TextDecoder().decode(await boundedBytes(response, limit));
}

export async function safeFetch(value: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid request timeout.');
  const url = publicHttpsUrl(value);
  await verifyPublicDns(url, fetchImpl);
  // Workers边缘不支持redirect:'error'，只支持follow/manual；3xx手动判定为失败。
  const response = await fetchImpl(url.toString(), { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (response.redirected || response.status >= 300 && response.status < 400) throw new Error('Redirects are not allowed.');
  if (!response.ok) {
    let detail = '';
    try {
      const text = (await boundedText(response, 4_096)).replace(/\s+/g, ' ').trim();
      if (text) detail = text.replace(/((?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*)[^\s,}]+/gi, '$1[redacted]').slice(0, 500);
    } catch { /* response body is optional diagnostics */ }
    throw new Error(`Remote request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }
  return response;
}

export function sanitize(value: unknown, secrets: string[] = [], depth = 0, bounded = true): unknown {
  if (depth > 12) return '[truncated]';
  if (typeof value === 'string') {
    let text = value.replace(/data:[^\s"']+;base64,[A-Za-z0-9+/=]+/gi, '[media omitted]')
      .replace(/("?(?:authorization|api[_-]?key|auth[_-]?token|password|secret)"?\s*[:=]\s*)[^\s,}\n]+/gi, '$1[redacted]')
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]');
    for (const secret of secrets.filter((item) => item.length > 0)) text = text.split(secret).join('[redacted]');
    return bounded ? text.slice(0, 32_768) : text;
  }
  if (Array.isArray(value)) return (bounded ? value.slice(0, 100) : value).map((item) => sanitize(item, secrets, depth + 1, bounded));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /secret|password|credential|authorization|api.?key|auth.?token|base64|file_data|input_audio/i.test(key)
      ? '[redacted]' : sanitize(item, secrets, depth + 1, bounded)]));
  return value;
}
