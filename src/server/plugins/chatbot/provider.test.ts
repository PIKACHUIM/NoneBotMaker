import { describe, expect, it, vi } from 'vitest';
import type { ProviderChatRequest, ProviderRecord } from '../../../shared/types';
import { completeOpenAICompatible, estimateTokens } from './provider';

const provider: ProviderRecord = { id: 'provider', name: 'AI', enabled: true, baseUrl: 'https://api.vendor.example/v1', apiKey: 'test-secret', models: [], createdAt: '', updatedAt: '' };
const request: ProviderChatRequest = { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const mockFetch = (response: Response) => vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).includes('dns-query')
  ? json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }) : response);
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const choice = (delta: unknown, finishReason: string | null = null, index = 0) => ({ choices: [{ index, delta, finish_reason: finishReason }] });
const done = 'data: [DONE]\n\n';
const textStream = (text: string, headers: HeadersInit = {}) => byteStream([new TextEncoder().encode(text)], headers);
function byteStream(chunks: Uint8Array[], headers: HeadersInit = {}, cancel = vi.fn()) {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', ...headers } });
}
const streamed = (response: Response) => completeOpenAICompatible(provider, { ...request, stream: true }, mockFetch(response));

describe('OpenAI compatible JSON responses', () => {
  it('keeps non-stream requests and token usage compatible', async () => {
    const fetchImpl = mockFetch(json({ choices: [{ message: { content: 'hello back' } }], usage: { prompt_tokens: 100, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 40 } } }));
    await expect(completeOpenAICompatible(provider, request, fetchImpl)).resolves.toEqual({ content: 'hello back', toolCalls: [], promptTokens: 100, completionTokens: 3, cachedPromptTokens: 40 });
    const init = fetchImpl.mock.calls.find(([input]) => !String(input).includes('dns-query'))![1]!;
    expect(JSON.parse(String(init.body))).toEqual({ model: request.model, messages: request.messages });
    expect(init).toMatchObject({ redirect: 'manual', headers: { authorization: 'Bearer test-secret' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('supports JSON fallback when streaming was requested and estimates missing usage', async () => {
    const toolCalls = [{ id: 'call', type: 'function', function: { name: 'echo', arguments: '{}' } }];
    const result = await streamed(json({ choices: [{ message: { content: null, tool_calls: toolCalls } }] }));
    expect(result).toMatchObject({ content: '', toolCalls, cachedPromptTokens: 0 });
    expect(result.promptTokens).toBe(estimateTokens({ messages: request.messages, tools: request.tools }));
    expect(result.completionTokens).toBe(estimateTokens({ content: '', toolCalls }));
  });

  it.each([null, {}, { choices: 'bad' }, { choices: [{ message: { content: {} } }] }, { choices: [{ message: { content: '' } }] }])('rejects invalid or empty JSON %j', async (value) => {
    await expect(completeOpenAICompatible(provider, request, mockFetch(json(value)))).rejects.toThrow();
  });

  it.each([
    [{ id: '', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    [{ id: 'call', type: 'function', function: { name: '', arguments: '{}' } }],
    [{ id: 'call', type: 'function', function: { name: 'echo', arguments: {} } }],
    Array.from({ length: 2 }, () => ({ id: 'same', type: 'function', function: { name: 'echo', arguments: '{}' } })),
  ].map((toolCalls) => ({ toolCalls })))('rejects malformed and duplicate JSON tool metadata %j', async ({ toolCalls }) => {
    await expect(completeOpenAICompatible(provider, request, mockFetch(json({ choices: [{ message: { content: null, tool_calls: toolCalls } }] })))).rejects.toThrow('tool call');
  });
});

describe('OpenAI compatible SSE responses', () => {
  it('requests real streaming, collects content, finish reason and final usage-only chunk', async () => {
    const text = event(choice({ role: 'assistant', content: '' })) + event(choice({ content: 'hello ' })) + event(choice({ content: 'world' }))
      + event(choice({}, 'stop')) + event({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 30 } } }) + done;
    const fetchImpl = mockFetch(textStream(text));
    const result = await completeOpenAICompatible(provider, { ...request, stream: true, temperature: 0.5, maxTokens: 100, reasoningEffort: 'low' }, fetchImpl);
    expect(result).toEqual({ content: 'hello world', toolCalls: [], promptTokens: 100, completionTokens: 2, cachedPromptTokens: 30, finishReason: 'stop' });
    const body = JSON.parse(String(fetchImpl.mock.calls.find(([input]) => !String(input).includes('dns-query'))![1]!.body));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true }, temperature: 0.5, max_completion_tokens: 100, reasoning_effort: 'low' });
  });

  it('handles UTF-8 byte splits, CRLF, comments, unknown fields and multi-line data', async () => {
    const first = JSON.stringify(choice({ content: '你好🙂' })).replace(',"delta"', ',\n"delta"');
    const text = ': keepalive\r\nid: first\r\nevent: message\r\n' + first.split('\n').map((line) => `data: ${line}\r\n`).join('')
      + '\r\n' + event(choice({}, 'stop')).replaceAll('\n', '\r\n') + done.replaceAll('\n', '\r\n');
    const bytes = new TextEncoder().encode(text);
    const result = await streamed(byteStream(Array.from(bytes, (byte) => new Uint8Array([byte]))));
    expect(result.content).toBe('你好🙂');
    expect(result.finishReason).toBe('stop');
  });

  it('handles CR-only lines, including a final CR at EOF', async () => {
    const text = (event(choice({ content: 'ok' }, 'stop')) + done).replaceAll('\n', '\r');
    expect((await streamed(textStream(text))).content).toBe('ok');
  });

  it('retains a long data line split into small chunks', async () => {
    const content = 'x'.repeat(8192);
    const bytes = new TextEncoder().encode(event(choice({ content }, 'stop')) + done);
    expect((await streamed(byteStream(Array.from(bytes, (byte) => new Uint8Array([byte]))))).content).toBe(content);
  });

  it('aggregates interleaved arguments by tool index without granting argument-based authority', async () => {
    const text = event(choice({ content: 'checking', tool_calls: [
      { index: 0, id: 'first', type: 'function', function: { name: 'echo', arguments: '{"text":' } },
      { index: 1, id: 'second', type: 'function', function: { name: 'read', arguments: '{"owner_authorized":' } },
    ] })) + event(choice({ tool_calls: [
      { index: 1, function: { arguments: 'true}' } }, { index: 0, function: { arguments: '"你好"}' } },
    ] })) + event(choice({}, 'tool_calls')) + done;
    const result = await streamed(textStream(text));
    expect(result.toolCalls).toEqual([
      { id: 'first', type: 'function', function: { name: 'echo', arguments: '{"text":"你好"}' } },
      { id: 'second', type: 'function', function: { name: 'read', arguments: '{"owner_authorized":true}' } },
    ]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('ignores all choices except index zero even if they appear first', async () => {
    const text = event({ choices: [
      { index: 1, delta: { content: 'ignored', tool_calls: 'invalid' }, finish_reason: 'tool_calls' },
      { index: 0, delta: { content: 'selected' }, finish_reason: null },
    ] }) + event(choice({}, 'stop', 1)) + event(choice({}, 'stop')) + done;
    expect((await streamed(textStream(text))).content).toBe('selected');
  });

  it('reads SSE based on response content type even when streaming was not requested', async () => {
    const result = await completeOpenAICompatible(provider, request, mockFetch(textStream(event(choice({ content: 'ok' }, 'stop')) + done)));
    expect(result.content).toBe('ok');
  });

  it.each(['stop', 'length', 'content_filter'])('returns completed text with finish reason %s', async (reason) => {
    expect((await streamed(textStream(event(choice({ content: 'text' }, reason)) + done))).finishReason).toBe(reason);
  });

  it('clamps cached tokens and falls back on invalid usage counts', async () => {
    const text = event(choice({ content: 'answer' }, 'stop')) + event({ choices: [], usage: { prompt_tokens: 5, completion_tokens: -1, prompt_tokens_details: { cached_tokens: 50 } } }) + done;
    const result = await streamed(textStream(text));
    expect(result.cachedPromptTokens).toBe(5);
    expect(result.completionTokens).toBe(estimateTokens({ content: 'answer', toolCalls: [] }));
  });

  it.each([
    event(choice({ content: 'partial' })) + done,
    event(choice({ content: 'partial' }, 'stop')),
    event(choice({ content: 'partial' })),
    done,
    event(choice({ content: 'partial' }, 'stop')) + 'data: [DONE]',
  ])('rejects streams missing a complete final choice or DONE event', async (text) => {
    await expect(streamed(textStream(text))).rejects.toThrow('incomplete');
  });

  it('rejects transport failures before DONE even after a finish chunk', async () => {
    let count = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (!count++) controller.enqueue(new TextEncoder().encode(event(choice({ content: 'partial' }, 'stop'))));
      else controller.error(new Error('transport interrupted'));
    } }), { headers: { 'content-type': 'text/event-stream' } });
    await expect(streamed(response)).rejects.toThrow('transport interrupted');
  });

  it('cancels a still-open body immediately after DONE', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event(choice({ content: 'ok' }, 'stop')) + done));
    }, cancel }), { headers: { 'content-type': 'text/event-stream' } });
    expect((await streamed(response)).content).toBe('ok');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    'data: invalid-json\n\n',
    event({ error: { message: 'test-secret' } }),
    event({ choices: 'invalid' }),
    event(choice({ content: 1 })),
    event(choice({ tool_calls: 'invalid' })),
    event(choice({ content: 'ok' }, 'unexpected')),
    event(choice({ content: 'first' }, 'stop')) + event(choice({ content: 'late' })),
    event({ choices: [{ index: 0, delta: { content: 'a' } }, { index: 0, delta: { content: 'b' } }] }),
  ])('rejects malformed data and protocol errors without returning partial content', async (text) => {
    await expect(streamed(textStream(text + event(choice({}, 'stop')) + done))).rejects.toThrow('invalid');
  });

  it.each([
    [{ index: -1, id: 'call', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    [{ index: 32, id: 'call', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    [{ index: 0, id: 'call', type: 'other', function: { name: 'echo', arguments: '{}' } }],
    [{ index: 0, id: 'call', type: 'function', function: { name: 'echo', arguments: {} } }],
    [{ index: 0, function: { arguments: '{}' } }],
    [{ index: 1, id: 'call', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    [{ index: 0, id: 'same', type: 'function', function: { name: 'echo', arguments: '{}' } }, { index: 1, id: 'same', type: 'function', function: { name: 'echo', arguments: '{}' } }],
    [{ index: 0, id: 'a', type: 'function', function: { name: 'echo', arguments: '{}' } }, { index: 0, id: 'a', type: 'function', function: { name: 'echo', arguments: '{}' } }],
  ].map((calls) => ({ calls })))('rejects malformed, missing and duplicate streamed tool metadata %j', async ({ calls }) => {
    await expect(streamed(textStream(event(choice({ tool_calls: calls })) + event(choice({}, 'tool_calls')) + done))).rejects.toThrow('tool call');
  });

  it('accepts 32 complete calls and rejects a 33rd call', async () => {
    const calls = Array.from({ length: 32 }, (_, index) => ({ index, id: `call-${index}`, type: 'function', function: { name: 'echo', arguments: '{}' } }));
    const text = event(choice({ tool_calls: calls })) + event(choice({}, 'tool_calls')) + done;
    expect((await streamed(textStream(text))).toolCalls).toHaveLength(32);
    await expect(streamed(textStream(event(choice({ tool_calls: [...calls, { ...calls[0], index: 32, id: 'extra' }] })) + done))).rejects.toThrow('tool calls');
  });

  it('rejects changed tool identity across chunks', async () => {
    const text = event(choice({ tool_calls: [{ index: 0, id: 'first', type: 'function', function: { name: 'echo', arguments: '{' } }] }))
      + event(choice({ tool_calls: [{ index: 0, id: 'second', function: { arguments: '}' } }] })) + event(choice({}, 'tool_calls')) + done;
    await expect(streamed(textStream(text))).rejects.toThrow('tool call');
  });

  it('rejects unfinished tool arguments when finish reason is length', async () => {
    const text = event(choice({ tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'echo', arguments: '{' } }] }, 'length')) + done;
    await expect(streamed(textStream(text))).rejects.toThrow('tool call');
  });

  it('limits accumulated tool arguments to 65536 characters', async () => {
    const text = event(choice({ tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'echo', arguments: 'a'.repeat(40_000) } }] }))
      + event(choice({ tool_calls: [{ index: 0, function: { arguments: 'b'.repeat(30_000) } }] })) + event(choice({}, 'tool_calls')) + done;
    await expect(streamed(textStream(text))).rejects.toThrow('tool call');
  });

  it.each([true, false])('enforces the two-MiB body limit with content-length=%s', async (declared) => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(': ' + 'a'.repeat(2 * 1024 * 1024));
    const response = byteStream([bytes, new Uint8Array([10])], declared ? { 'content-length': String(bytes.byteLength) } : {}, cancel);
    await expect(streamed(response)).rejects.toThrow('size limit');
    expect(cancel).toHaveBeenCalled();
  });

  it('accepts an exactly two-MiB stream and counts bytes across multiple chunks', async () => {
    const ending = event(choice({ content: 'ok' }, 'stop')) + done;
    const text = ': ' + 'a'.repeat(2 * 1024 * 1024 - 4 - ending.length) + '\n\n' + ending;
    const bytes = new TextEncoder().encode(text);
    expect(bytes.byteLength).toBe(2 * 1024 * 1024);
    expect((await streamed(byteStream([bytes.subarray(0, 1024 * 1024), bytes.subarray(1024 * 1024)]))).content).toBe('ok');
    const prefix = new TextEncoder().encode(': ' + 'a'.repeat(1024 * 1024));
    await expect(streamed(byteStream([prefix, prefix]))).rejects.toThrow('size limit');
  });

  it('never includes remote error payloads in protocol errors', async () => {
    try {
      await streamed(textStream(event({ choices: [], error: { message: 'test-secret confidential' } }) + done));
      throw new Error('Expected a protocol error');
    } catch (error) {
      expect(String(error)).toContain('invalid');
      expect(String(error)).not.toContain('test-secret');
      expect(String(error)).not.toContain('confidential');
    }
  });

  it('rejects invalid UTF-8 instead of silently replacing corrupted text', async () => {
    const prefix = new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"');
    const suffix = new TextEncoder().encode('"},"finish_reason":"stop"}]}\n\n' + done);
    await expect(streamed(byteStream([prefix, new Uint8Array([0xc3, 0x28]), suffix]))).rejects.toThrow();
  });

  it('preserves DNS and public HTTPS protections before sending API credentials', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] }));
    await expect(completeOpenAICompatible(provider, { ...request, stream: true }, fetchImpl)).rejects.toThrow('non-public');
    expect(fetchImpl.mock.calls.every(([input]) => String(input).includes('dns-query'))).toBe(true);
    await expect(completeOpenAICompatible({ ...provider, baseUrl: 'http://api.vendor.example' }, request, vi.fn())).rejects.toThrow('HTTPS');
  });
});
