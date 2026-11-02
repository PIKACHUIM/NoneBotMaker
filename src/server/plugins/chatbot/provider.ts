import type { ProviderChatRequest, ProviderRecord, ToolCall } from '../../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch } from './network';

export interface ProviderChatResult {
  content: string;
  toolCalls: ToolCall[];
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  finishReason?: string;
}

interface ProviderResponse {
  choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
}

const MAX_STREAM_BYTES = 2 * 1024 * 1024;

export async function completeOpenAICompatible(
  provider: ProviderRecord,
  request: ProviderChatRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderChatResult> {
  if (!provider.enabled || !provider.apiKey) throw new Error('Chat provider is unavailable.');
  const baseUrl = publicHttpsUrl(provider.baseUrl);
  if (baseUrl.search || baseUrl.hash) throw new Error('Chat provider URL must not contain query parameters.');
  const response = await safeFetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      ...(request.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
    }),
  }, fetchImpl);
  if (!response.ok || response.redirected) throw new Error(`Chat provider request failed (${response.status}).`);
  const result: ProviderResponse = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream'
    ? await readCompletionStream(response) : parseResponse(await boundedText(response));
  const message = result.choices?.[0]?.message;
  if (!Array.isArray(result.choices) || !message || message.content != null && typeof message.content !== 'string') throw new Error('Chat provider response is invalid.');
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls: ToolCall[] = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 32) throw new Error('Chat provider tool calls are invalid.');
    for (const call of message.tool_calls) {
      if (!call || typeof call.id !== 'string' || !call.id || call.type !== 'function' ||
          typeof call.function?.name !== 'string' || !call.function.name || typeof call.function?.arguments !== 'string' ||
          call.function.arguments.length > 65_536 || toolCalls.some((existing) => existing.id === call.id)) {
        throw new Error('Chat provider tool call is invalid.');
      }
      toolCalls.push({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } });
    }
  }
  if (!content && !toolCalls.length) throw new Error('Chat provider response is empty.');
  const promptTokens = tokenCount(result.usage?.prompt_tokens, estimateTokens({ messages: request.messages, tools: request.tools }));
  return {
    content, toolCalls, promptTokens,
    completionTokens: tokenCount(result.usage?.completion_tokens, estimateTokens({ content, toolCalls })),
    cachedPromptTokens: Math.min(promptTokens, tokenCount(result.usage?.prompt_tokens_details?.cached_tokens, 0)),
    ...(result.choices[0].finish_reason != null ? { finishReason: finishReason(result.choices[0].finish_reason) } : {}),
  };
}

function parseResponse(text: string): ProviderResponse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Chat provider response is invalid.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Chat provider response is invalid.');
  return value as ProviderResponse;
}

function finishReason(value: unknown): string {
  if (typeof value !== 'string' || !['stop', 'length', 'tool_calls', 'content_filter'].includes(value)) {
    throw new Error('Chat provider finish reason is invalid.');
  }
  return value;
}

async function readCompletionStream(response: Response): Promise<ProviderResponse> {
  if (Number(response.headers.get('content-length')) > MAX_STREAM_BYTES) {
    await response.body?.cancel();
    throw new Error('Response exceeds size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Chat provider stream is incomplete.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const calls = new Map<number, { id?: string; type?: 'function'; function: { name?: string; arguments: string } }>();
  let content = '';
  let usage: ProviderResponse['usage'];
  let reason: string | undefined;
  let finished = false;
  let totalBytes = 0;
  let buffer = '';
  let scanOffset = 0;
  let data: string[] = [];

  function dispatch() {
    if (!data.length) return;
    const text = data.join('\n');
    data = [];
    if (text.trim() === '[DONE]') {
      if (!reason) throw new Error('Chat provider stream is incomplete.');
      finished = true;
      return;
    }
    const chunk = parseResponse(text) as Omit<ProviderResponse, 'choices'> & { error?: unknown; choices?: Array<{ index?: unknown; delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }> };
    if (chunk.error != null || !Array.isArray(chunk.choices)) throw new Error('Chat provider stream chunk is invalid.');
    if (chunk.usage != null) {
      if (typeof chunk.usage !== 'object' || Array.isArray(chunk.usage)) throw new Error('Chat provider usage is invalid.');
      usage = chunk.usage;
    }
    const selected = chunk.choices.filter((entry) => entry?.index === 0);
    if (selected.length > 1) throw new Error('Chat provider stream choice is invalid.');
    const selectedChoice = selected[0];
    if (!selectedChoice) return;
    if (reason || !selectedChoice.delta || typeof selectedChoice.delta !== 'object' || Array.isArray(selectedChoice.delta)) {
      throw new Error('Chat provider stream choice is invalid.');
    }
    const delta = selectedChoice.delta;
    if (delta.content != null) {
      if (typeof delta.content !== 'string') throw new Error('Chat provider content delta is invalid.');
      content += delta.content;
    }
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 32) throw new Error('Chat provider tool calls are invalid.');
      const seen = new Set<number>();
      for (const item of delta.tool_calls) {
        if (!item || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= 32 || seen.has(item.index)) {
          throw new Error('Chat provider tool call index is invalid.');
        }
        seen.add(item.index);
        const call = calls.get(item.index) ?? { function: { arguments: '' } };
        if (item.id !== undefined) {
          if (typeof item.id !== 'string' || !item.id || call.id !== undefined && call.id !== item.id ||
              [...calls.entries()].some(([index, existing]) => index !== item.index && existing.id === item.id)) {
            throw new Error('Chat provider tool call identity is invalid.');
          }
          call.id = item.id;
        }
        if (item.type !== undefined) {
          if (item.type !== 'function') throw new Error('Chat provider tool call type is invalid.');
          call.type = item.type;
        }
        if (item.function !== undefined) {
          if (!item.function || typeof item.function !== 'object' || Array.isArray(item.function)) throw new Error('Chat provider tool call function is invalid.');
          if (item.function.name !== undefined) {
            if (typeof item.function.name !== 'string' || !item.function.name || call.function.name !== undefined && call.function.name !== item.function.name) {
              throw new Error('Chat provider tool call name is invalid.');
            }
            call.function.name = item.function.name;
          }
          if (item.function.arguments !== undefined) {
            if (typeof item.function.arguments !== 'string') throw new Error('Chat provider tool call arguments are invalid.');
            call.function.arguments += item.function.arguments;
            if (call.function.arguments.length > 65_536) throw new Error('Chat provider tool call arguments are invalid.');
          }
        }
        calls.set(item.index, call);
      }
    }
    if (selectedChoice.finish_reason != null) reason = finishReason(selectedChoice.finish_reason);
  }

  function consumeLines(atEnd = false) {
    let start = 0;
    let index = scanOffset;
    for (; index < buffer.length && !finished; index++) {
      const character = buffer[index];
      if (character !== '\n' && character !== '\r') continue;
      // 等下一字节再判定 CRLF，避免把跨 chunk 的 CRLF 误判为两个换行。
      if (character === '\r' && index === buffer.length - 1 && !atEnd) break;
      const line = buffer.slice(start, index);
      if (character === '\r' && buffer[index + 1] === '\n') index++;
      start = index + 1;
      if (!line) dispatch();
      else if (line === 'data' || line.startsWith('data:')) data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
    }
    buffer = buffer.slice(start);
    scanOffset = index - start;
  }

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        consumeLines(true);
        if (!finished) throw new Error('Chat provider stream is incomplete.');
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_STREAM_BYTES) throw new Error('Response exceeds size limit.');
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }
    const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([index, call], expectedIndex) => {
      if (index !== expectedIndex || !call.id || !call.type || !call.function.name) throw new Error('Chat provider tool call is incomplete or invalid.');
      return call;
    });
    if (toolCalls.length && reason !== 'tool_calls' || reason === 'tool_calls' && !toolCalls.length) throw new Error('Chat provider tool call finish reason is invalid.');
    return { choices: [{ message: { content, tool_calls: toolCalls }, finish_reason: reason }], usage };
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function tokenCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
