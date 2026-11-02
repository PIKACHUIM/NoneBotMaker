import type { ModelPriceRecord } from './types';

export const MODEL_PRICE_CHECKED_AT = '2026-11-02';

// 官方标准文本/语音价格快照；仅作为手动选择导入的预置，不会自动刷新。
export const MODEL_PRICE_PRESETS: ModelPriceRecord[] = [
  {
    id: 'openai-gpt-4.1-mini',
    name: 'OpenAI GPT-4.1 mini',
    model: 'gpt-4.1-mini',
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 1.6,
    cacheInputCostPerMillion: 0.1,
    currency: 'USD',
    unit: 'tokens',
    sourceUrl: 'https://platform.openai.com/docs/models/gpt-4.1-mini',
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  },
  {
    id: 'openai-gpt-4o-mini',
    name: 'OpenAI GPT-4o mini',
    model: 'gpt-4o-mini',
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    cacheInputCostPerMillion: 0.075,
    currency: 'USD',
    unit: 'tokens',
    sourceUrl: 'https://platform.openai.com/docs/models/gpt-4o-mini',
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  },
  {
    id: 'openai-gpt-5-mini',
    name: 'OpenAI GPT-5 mini',
    model: 'gpt-5-mini',
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 2,
    cacheInputCostPerMillion: 0.025,
    currency: 'USD',
    unit: 'tokens',
    sourceUrl: 'https://platform.openai.com/docs/models/gpt-5-mini',
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  },
  {
    id: 'openai-tts-1',
    name: 'OpenAI TTS-1',
    model: 'tts-1',
    inputCostPerMillion: 15,
    outputCostPerMillion: 0,
    currency: 'USD',
    unit: 'characters',
    sourceUrl: 'https://developers.openai.com/api/docs/models/tts-1',
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  },
  {
    id: 'openai-tts-1-hd',
    name: 'OpenAI TTS-1 HD',
    model: 'tts-1-hd',
    inputCostPerMillion: 30,
    outputCostPerMillion: 0,
    currency: 'USD',
    unit: 'characters',
    sourceUrl: 'https://developers.openai.com/api/docs/models/tts-1-hd',
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  },
];

export function findModelPrice(prices: ModelPriceRecord[], model: string): ModelPriceRecord | undefined {
  const enabled = prices.filter((price) => price.enabled);
  return enabled.find((price) => price.model === model) ?? enabled
    .filter((price) => model.startsWith(`${price.model}-`))
    .sort((a, b) => b.model.length - a.model.length)[0];
}
