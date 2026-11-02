import { describe, expect, it, vi } from 'vitest';
import type { LibraryRecord, NormalizedMessage } from '../../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch, sanitize } from './network';
import { incomingContent, storedMessages } from './media';
import { completeRecentTurns, connectMcp, executeTool, tool, validateToolArguments, webTools } from './tools';

const json = (value: unknown, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } });
const dns = () => json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const library = (id: string): LibraryRecord => ({ id, name: id, description: '', enabled: true, config: { url: `https://${id}.example/mcp`, authToken: 'test-auth-token', allowedTools: ['echo'] }, createdAt: '', updatedAt: '' });
const incoming: NormalizedMessage = { id: 'message', accountId: 'account', botId: 'bot', groupId: 'group', userId: 'user', text: 'look', mentionsBot: true, receivedAt: 1000 };

describe('chatbot network boundaries', () => {
  it.each(['http://example.com', 'https://127.0.0.1', 'https://10.2.3.4', 'https://169.254.169.254', 'https://[::1]', 'https://user:pass@example.com', 'https://example.com:8443', 'https://x.internal'])('rejects non-public endpoint %s', (url) => {
    expect(() => publicHttpsUrl(url)).toThrow();
  });

  it('rejects hostnames resolving to private IPs before sending credentials', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }));
    await expect(safeFetch('https://remote.example', { headers: { authorization: 'secret' } }, fetchImpl)).rejects.toThrow('non-public');
    expect(fetchImpl.mock.calls.every(([input]) => String(input).includes('cloudflare-dns.com'))).toBe(true);
  });

  it('rejects redirect responses and limits streaming body size', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes('dns-query') ? dns() : new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } }));
    await expect(safeFetch('https://remote.example', {}, fetchImpl)).rejects.toThrow('Redirect');
    await expect(boundedText(new Response('A'.repeat(101)), 100)).rejects.toThrow('size');
  });

  it('removes structured credentials, inline keys and base64 attachments from logs', () => {
    const result = JSON.stringify(sanitize({ authToken: 'secret', nested: { file_data: 'base64' }, text: 'Bearer abcdef secret-value password=123 data:image/png;base64,AAA=' }, ['secret-value']));
    expect(result).not.toContain('abcdef');
    expect(result).not.toContain('secret-value');
    expect(result).not.toContain('AAA=');
    expect(result).not.toContain('123');
  });
});

describe('MCP streamable HTTP tools', () => {
  it('initializes multiple independent sessions, pages tools, enforces allowlists and calls tools', async () => {
    const requests: Array<{ url: string; body: any; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('dns-query')) return dns();
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(input), body, init: init! });
      if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, { 'mcp-session-id': String(input).includes('alpha') ? 'alpha-session' : 'beta-session' });
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'tools/list') return json({ jsonrpc: '2.0', id: body.id, result: body.params.cursor ? { tools: [{ name: 'forbidden', inputSchema: { type: 'object' } }] } : { tools: [{ name: 'echo', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }], nextCursor: 'next' } });
      return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: body.params.arguments.text }] } });
    });
    const alpha = await connectMcp(library('alpha'), fetchImpl);
    const beta = await connectMcp(library('beta'), fetchImpl);
    expect(alpha).toHaveLength(1);
    expect(beta).toHaveLength(1);
    expect(alpha[0].definition.function.name).not.toBe(beta[0].definition.function.name);
    expect(await alpha[0].execute({ text: 'hello' })).toContain('hello');
    const call = requests.at(-1)!;
    expect(call.body.params.name).toBe('echo');
    expect(call.init.headers).toMatchObject({ authorization: 'Bearer test-auth-token', 'mcp-session-id': 'alpha-session', 'mcp-protocol-version': '2025-06-18' });
  });

  it('blocks MCP side effects unless the current batch is owner-authorized with an explicit tool allowlist', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('dns-query')) return dns();
      const request = JSON.parse(String(init?.body));
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = request.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [
        { name: 'echo', inputSchema: { type: 'object' } },
        { name: 'read', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
      ] };
      return json({ jsonrpc: '2.0', id: request.id, result });
    });
    expect(await connectMcp(library('unsafe'), fetchImpl)).toEqual([]);
    expect(await connectMcp(library('safe'), fetchImpl, true)).toHaveLength(1);
    const empty = { ...library('readonly'), config: { ...library('readonly').config, allowedTools: [] } };
    expect((await connectMcp(empty, fetchImpl)).map((entry) => entry.definition.function.name)).toEqual(['mcp_readonly_read']);
    expect((await connectMcp(empty, fetchImpl, true)).map((entry) => entry.definition.function.name)).toEqual(['mcp_readonly_read']);
  });

  it('parses finite SSE JSON-RPC responses', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('dns-query')) return dns();
      const request = JSON.parse(String(init?.body));
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = request.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { tools: [] };
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    await expect(connectMcp(library('sse'), fetchImpl)).resolves.toEqual([]);
  });

  it('rejects MCP protocol errors without leaking remote error text', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes('dns-query') ? dns() : json({ jsonrpc: '2.0', id: JSON.parse(String(init?.body)).id, error: { message: 'secret test-auth-token' } }));
    await expect(connectMcp(library('broken'), fetchImpl)).rejects.toThrow('MCP request failed');
  });
});

describe('runtime tool argument validation', () => {
  it('validates nested schemas, required properties, enums and ranges', () => {
    const schema = { type: 'object', properties: { values: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 5 } }, choice: { enum: ['a', 'b'] } }, required: ['values'], additionalProperties: false };
    expect(() => validateToolArguments({ values: [1, 5], choice: 'a' }, schema)).not.toThrow();
    for (const invalid of [{}, { values: [0] }, { values: [1.5] }, { values: [1, 2, 3] }, { values: [], choice: 'x' }, { values: [], extra: true }]) expect(() => validateToolArguments(invalid, schema)).toThrow();
  });

  it('fails closed on remote schema references and unsupported regex constraints', () => {
    expect(() => validateToolArguments({}, { $ref: 'https://remote.example/schema' })).toThrow();
    expect(() => validateToolArguments('text', { type: 'string', pattern: '^(a+)+$' })).toThrow('unsupported');
  });

  it('never executes unknown tools or schema-invalid calls', async () => {
    const execute = vi.fn(async () => 'done');
    const selected = tool('allowed', '', { count: { type: 'integer', maximum: 2 } }, ['count'], execute);
    const registry = new Map([['allowed', selected]]);
    expect((await executeTool('Shell', '{}', registry, [])).allowed).toBe(false);
    expect((await executeTool('allowed', '{"count":3}', registry, [])).isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect((await executeTool('allowed', '{"count":2}', registry, [])).content).toBe('done');
  });

  it('registers Brave only when configured and restricts WebFetch to text', async () => {
    expect(webTools({}).map((entry) => entry.definition.function.name)).toEqual(['WebFetch']);
    expect(webTools({ brave_api_key: 'key' }).map((entry) => entry.definition.function.name)).toContain('WebSearch');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes('dns-query') ? dns() : new Response('binary', { headers: { 'content-type': 'application/octet-stream' } }));
    await expect(webTools({}, fetchImpl)[0].execute({ url: 'https://web.example' })).rejects.toThrow('text content');
  });

  it('retains complete user-to-tool turns instead of slicing tool responses in half', () => {
    const entries = [{ role: 'user' as const, content: 'start' }, { role: 'assistant' as const, content: '', tool_calls: [{ id: 'call', type: 'function' as const, function: { name: 'tool', arguments: '{}' } }] }, { role: 'tool' as const, content: 'result', tool_call_id: 'call' }, { role: 'assistant' as const, content: 'done' }];
    expect(completeRecentTurns(entries, 2)).toEqual(entries);
  });
});

describe('actual media content blocks', () => {
  it('passes supported images/audio/PDF bytes and removes base64 from persisted history', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('dns-query')) return dns();
      return new Response('media-bytes', { headers: { 'content-type': String(input).endsWith('pdf') ? 'application/pdf' : String(input).endsWith('wav') ? 'audio/wav' : 'image/png' } });
    });
    const images = await incomingContent({ ...incoming, attachments: [{ type: 'image', url: 'https://media.example/image' }, { type: 'file', url: 'https://media.example/pdf' }] }, 'custom-compatible', 1024, fetchImpl, ['image', 'file']);
    expect(Array.isArray(images) && images[1].type).toBe('image_url');
    expect(JSON.stringify(images)).toContain('base64');
    const audio = await incomingContent({ ...incoming, attachments: [{ type: 'audio', url: 'https://media.example/wav' }] }, 'gpt-4o-audio-preview', 1024, fetchImpl, ['audio']);
    expect(Array.isArray(audio) && audio[1].type).toBe('input_audio');
    expect(JSON.stringify(storedMessages([{ role: 'user', content: images }]))).not.toContain('base64');
  });

  it('does not pretend unsupported video content was read and does not download it', async () => {
    const fetchImpl = vi.fn();
    const parts = await incomingContent({ ...incoming, attachments: [{ type: 'video', url: 'https://media.example/video' }] }, 'gpt-4o', 1024, fetchImpl);
    expect(JSON.stringify(parts)).toContain('不支持');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes video bytes only when the provider explicitly declares a compatible video API', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes('dns-query') ? dns() : new Response('video-bytes', { headers: { 'content-type': 'video/mp4' } }));
    const parts = await incomingContent({ ...incoming, attachments: [{ type: 'video', url: 'https://media.example/video' }] }, 'custom-compatible', 1024, fetchImpl, ['video']);
    expect(Array.isArray(parts) && parts[1].type).toBe('video_url');
    expect(JSON.stringify(parts)).toContain('data:video/mp4;base64,');
  });

  it('rejects private media URLs and oversized attachments', async () => {
    await expect(incomingContent({ ...incoming, attachments: [{ type: 'image', url: 'https://127.0.0.1/pic' }] }, 'gpt-4o', 1024, vi.fn())).rejects.toThrow();
    await expect(incomingContent({ ...incoming, attachments: [{ type: 'image', url: 'https://media.example/pic', size: 2048 }] }, 'gpt-4o', 1024, vi.fn())).rejects.toThrow('size');
  });
});
