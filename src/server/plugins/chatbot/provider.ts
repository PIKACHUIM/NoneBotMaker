import type { ProviderChatRequest, ProviderRecord } from '../../../shared/types';

export interface ProviderChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

type FetchLike = typeof fetch;

export async function completeOpenAICompatible(
  provider: ProviderRecord,
  request: ProviderChatRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderChatResult> {
  if (!provider.enabled || !provider.apiKey) throw new Error('Chat provider is unavailable.');

  const baseUrl = new URL(provider.baseUrl);
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('Chat provider URL must be an HTTPS endpoint without credentials or query parameters.');
  }
  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Chat provider request failed.');

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Chat provider response is invalid.');
  const estimatedPromptTokens = Math.ceil(request.messages.reduce((total, message) => total + message.content.length, 0) / 4);
  const estimatedCompletionTokens = Math.ceil(content.length / 4);
  return {
    content,
    promptTokens: tokenCount(result.usage?.prompt_tokens, estimatedPromptTokens),
    completionTokens: tokenCount(result.usage?.completion_tokens, estimatedCompletionTokens),
  };
}

function tokenCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
