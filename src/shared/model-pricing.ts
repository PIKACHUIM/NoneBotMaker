import type { ModelPriceRecord } from './types';

export const MODEL_PRICE_CHECKED_AT = '2026-11-12';

/** Used for budget accounting when a model has no enabled price record. */
export const DEFAULT_MODEL_PRICE = {
  inputCostPerMillion: 3,
  outputCostPerMillion: 15,
} as const;

const OPENAI_PRICING = 'https://openai.com/api/pricing/';
const ANTHROPIC_PRICING = 'https://www.anthropic.com/pricing';
const GOOGLE_PRICING = 'https://ai.google.dev/gemini-api/docs/pricing';
const DEEPSEEK_PRICING = 'https://api-docs.deepseek.com/quick_start/pricing';
const ZHIPU_PRICING = 'https://open.bigmodel.cn/pricing';
const MOONSHOT_PRICING = 'https://platform.moonshot.cn/docs/pricing';
const MINIMAX_PRICING = 'https://www.minimaxi.com/document/price';
const ALIBABA_PRICING = 'https://help.aliyun.com/zh/model-studio/models';
const XAI_PRICING = 'https://docs.x.ai/docs/models';
const HUNYUAN_PRICING = 'https://cloud.tencent.com/document/product/1729/97731';
const SENSENOVA_PRICING = 'https://platform.sensenova.cn/';

type PresetTuple = [
  id: string,
  name: string,
  model: string,
  input: number,
  output: number,
  cache: number | undefined,
  sourceUrl: string,
];

const STANDARD_MODEL_PRESETS: PresetTuple[] = [
  ['openai-gpt-5.4', 'OpenAI GPT-5.4', 'gpt-5.4', 2.5, 15, 0.25, OPENAI_PRICING],
  ['openai-gpt-5.4-mini', 'OpenAI GPT-5.4 mini', 'gpt-5.4-mini', 0.75, 4.5, 0.075, OPENAI_PRICING],
  ['openai-gpt-5.5', 'OpenAI GPT-5.5', 'gpt-5.5', 5, 30, 0.5, OPENAI_PRICING],
  ['openai-gpt-5.6', 'OpenAI GPT-5.6', 'gpt-5.6', 5, 30, 0.5, OPENAI_PRICING],
  ['openai-gpt-5.6-luna', 'OpenAI GPT-5.6 Luna', 'gpt-5.6-luna', 0.2, 1.2, 0.02, OPENAI_PRICING],
  ['openai-gpt-5.6-sol', 'OpenAI GPT-5.6 Sol', 'gpt-5.6-sol', 5, 30, 0.5, OPENAI_PRICING],
  ['openai-gpt-5.6-terra', 'OpenAI GPT-5.6 Terra', 'gpt-5.6-terra', 2, 12, 0.2, OPENAI_PRICING],
  ['openai-gpt-6-astra', 'OpenAI GPT-6 Astra', 'gpt-6-astra', 10, 50, 1, OPENAI_PRICING],
  ['openai-gpt-6-luna', 'OpenAI GPT-6 Luna', 'gpt-6-luna', 0.1, 0.5, 0.01, OPENAI_PRICING],
  ['openai-gpt-6-sol', 'OpenAI GPT-6 Sol', 'gpt-6-sol', 2, 10, 0.1, OPENAI_PRICING],
  ['openai-gpt-6.1-sol', 'OpenAI GPT-6.1 Sol', 'gpt-6.1-sol', 2, 10, 0.1, OPENAI_PRICING],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek-v4-pro', 1.32, 3.96, 0.044, DEEPSEEK_PRICING],
  ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'deepseek-v4.1-flash', 0.3, 1.2, 0.006, DEEPSEEK_PRICING],
  ['google-gemini-3.8-flash', 'Google Gemini 3.8 Flash', 'gemini-3.8-flash', 0.75, 3.75, 0.075, GOOGLE_PRICING],
  ['google-gemini-3.8-flash-high', 'Google Gemini 3.8 Flash High', 'gemini-3.8-flash-high', 0.75, 3.75, 0.075, GOOGLE_PRICING],
  ['google-gemini-3.8-flash-low', 'Google Gemini 3.8 Flash Low', 'gemini-3.8-flash-low', 0.75, 3.75, 0.075, GOOGLE_PRICING],
  ['google-gemini-3.8-flash-medium', 'Google Gemini 3.8 Flash Medium', 'gemini-3.8-flash-medium', 0.75, 3.75, 0.075, GOOGLE_PRICING],
  ['google-gemini-4-argon', 'Google Gemini 4 Argon', 'gemini-4-argon', 2, 10, 0.1, GOOGLE_PRICING],
  ['google-gemini-4-argon-high', 'Google Gemini 4 Argon High', 'gemini-4-argon-high', 2, 10, 0.1, GOOGLE_PRICING],
  ['google-gemini-4-argon-low', 'Google Gemini 4 Argon Low', 'gemini-4-argon-low', 2, 10, 0.1, GOOGLE_PRICING],
  ['google-gemini-4-argon-medium', 'Google Gemini 4 Argon Medium', 'gemini-4-argon-medium', 2, 10, 0.1, GOOGLE_PRICING],
  ['zhipu-glm-5.3', 'Zhipu GLM-5.3', 'glm-5.3', 1.4, 4.4, undefined, ZHIPU_PRICING],
  ['zhipu-glm-5.3-flash', 'Zhipu GLM-5.3 Flash', 'glm-5.3-flash', 0.15, 0.5, 0.015, ZHIPU_PRICING],
  ['xai-grok-4.6', 'xAI Grok 4.6', 'grok-4.6', 2, 6, 0.5, XAI_PRICING],
  ['xai-grok-4.7', 'xAI Grok 4.7', 'grok-4.7', 2, 6, 0.5, XAI_PRICING],
  ['tencent-hy3-preview', 'Tencent Hunyuan HY3 Preview', 'hy3-preview', 0.3, 1.2, undefined, HUNYUAN_PRICING],
  ['tencent-hy4-preview', 'Tencent Hunyuan HY4 Preview', 'hy4-preview', 0.5, 2, undefined, HUNYUAN_PRICING],
  ['moonshot-kimi-k3', 'Moonshot Kimi K3', 'kimi-k3', 3, 15, undefined, MOONSHOT_PRICING],
  ['moonshot-kimi-k3-1', 'Moonshot Kimi K3.1', 'kimi-k3-1', 2, 10, undefined, MOONSHOT_PRICING],
  ['minimax-m2.7', 'MiniMax M2.7', 'minimax-m2.7', 0.3, 1.2, undefined, MINIMAX_PRICING],
  ['minimax-m3', 'MiniMax M3', 'minimax-m3', 0.6, 2.4, undefined, MINIMAX_PRICING],
  ['alibaba-qwen3.8-27b', 'Alibaba Qwen3.8 27B', 'qwen3.8-27b', 0.5, 3, undefined, ALIBABA_PRICING],
  ['alibaba-qwen3.8-a3b', 'Alibaba Qwen3.8 A3B', 'qwen3.8-a3b', 0.15, 0.47, undefined, ALIBABA_PRICING],
  ['sensenova-6.8-flash', 'SenseNova 6.8 Flash', 'sensenova-6.8-flash', 0.3, 1.2, undefined, SENSENOVA_PRICING],
  ['sensenova-6.8-flash-lite', 'SenseNova 6.8 Flash Lite', 'ssensenova-6.8-flash-lite', 0.1, 0.5, undefined, SENSENOVA_PRICING],
  ['anthropic-claude-fable-5', 'Anthropic Claude Fable 5', 'claude-fable-5', 10, 50, 0.25, ANTHROPIC_PRICING],
  ['anthropic-claude-fable-5-1', 'Anthropic Claude Fable 5.1', 'claude-fable-5-1', 10, 50, 0.25, ANTHROPIC_PRICING],
  ['anthropic-claude-haiku-4-5', 'Anthropic Claude Haiku 4.5', 'claude-haiku-4-5', 1, 5, 0.1, ANTHROPIC_PRICING],
  ['anthropic-claude-haiku-5-5', 'Anthropic Claude Haiku 5.5', 'claude-haiku-5-5', 0.1, 0.5, 0.01, ANTHROPIC_PRICING],
  ['anthropic-claude-opus-4-6', 'Anthropic Claude Opus 4.6', 'claude-opus-4-6', 15, 75, 1.5, ANTHROPIC_PRICING],
  ['anthropic-claude-opus-4-7', 'Anthropic Claude Opus 4.7', 'claude-opus-4-7', 15, 75, 1.5, ANTHROPIC_PRICING],
  ['anthropic-claude-opus-4-8', 'Anthropic Claude Opus 4.8', 'claude-opus-4-8', 15, 75, 1.5, ANTHROPIC_PRICING],
  ['anthropic-claude-opus-5', 'Anthropic Claude Opus 5', 'claude-opus-5', 5, 25, 0.5, ANTHROPIC_PRICING],
  ['anthropic-claude-opus-5-5', 'Anthropic Claude Opus 5.5', 'claude-opus-5-5', 4, 20, 0.2, ANTHROPIC_PRICING],
  ['anthropic-claude-sonnet-4-6', 'Anthropic Claude Sonnet 4.6', 'claude-sonnet-4-6', 3, 15, 0.3, ANTHROPIC_PRICING],
  ['anthropic-claude-sonnet-5', 'Anthropic Claude Sonnet 5', 'claude-sonnet-5', 2, 10, 0.2, ANTHROPIC_PRICING],
  ['anthropic-claude-sonnet-5-5', 'Anthropic Claude Sonnet 5.5', 'claude-sonnet-5-5', 2, 10, 0.1, ANTHROPIC_PRICING],
];

// 官方/公开价目快照；仅作为手动选择导入的预置，不会自动刷新。
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
  ...STANDARD_MODEL_PRESETS.map(([id, name, model, input, output, cache, sourceUrl]) => ({
    id,
    name,
    model,
    inputCostPerMillion: input,
    outputCostPerMillion: output,
    ...(cache === undefined ? {} : { cacheInputCostPerMillion: cache }),
    currency: 'USD' as const,
    unit: 'tokens' as const,
    sourceUrl,
    enabled: true,
    createdAt: MODEL_PRICE_CHECKED_AT,
    updatedAt: MODEL_PRICE_CHECKED_AT,
  })),
];

export function findModelPrice(prices: ModelPriceRecord[], model: string): ModelPriceRecord | undefined {
  const enabled = prices.filter((price) => price.enabled);
  return enabled.find((price) => price.model === model) ?? enabled
    .filter((price) => model.startsWith(`${price.model}-`))
    .sort((a, b) => b.model.length - a.model.length)[0];
}
