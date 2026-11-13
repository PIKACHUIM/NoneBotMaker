import type { ProviderRecord } from '../../../shared/types';
import { boundedText, openAiEndpoint, publicHttpsUrl, safeFetch } from './network';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  size?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Administrator-configured USD charge for one image when usage is absent/incomplete. Required even for priced models. */
  fallbackCostPerImage: number;
}

export interface ImageGenerationPrice {
  id: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  imageTextInputCostPerMillion?: number;
  imageInputCostPerMillion?: number;
  imageCachedInputCostPerMillion?: number;
  imageOutputCostPerMillion?: number;
}

export class ImageGenerationAttemptError extends Error {
  readonly estimatedCost: number;
  readonly pricingSource = 'per_image_fallback' as const;
  readonly estimated = true;
  constructor(message: string, estimatedCost: number) {
    super(message);
    this.name = 'ImageGenerationAttemptError';
    this.estimatedCost = estimatedCost;
  }
}

export interface ImageGenerationResult {
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  filename: string;
  usage: { textInputTokens?: number; imageInputTokens?: number; cachedImageInputTokens?: number; imageOutputTokens?: number; totalTokens?: number };
  /** USD; never silently zero-priced. Provider multiplier, if present, is already included. */
  cost: number;
  pricingSource: 'modalities' | 'total_estimate' | 'per_image_fallback';
  estimated: boolean;
  priceId?: string;
}

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function token(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Image provider usage is invalid.');
  return value;
}

function imageMime(bytes: Uint8Array): ImageGenerationResult['contentType'] {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('Image provider returned an unsupported image format.');
}

/** Performs one Images API call. Caller must gate tool enablement, identity authorization, approval, budget and media sending. */
export async function generateImage(
  provider: ProviderRecord,
  request: ImageGenerationRequest,
  price?: ImageGenerationPrice | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageGenerationResult> {
  if (!provider.enabled || !provider.apiKey) throw new Error('Image provider is unavailable.');
  const base = publicHttpsUrl(provider.baseUrl);
  if (base.search || base.hash) throw new Error('Image provider URL cannot contain query parameters or a fragment.');
  const model = request.model?.trim();
  const prompt = request.prompt?.trim();
  if (!model || model.length > 256 || !/^[\w./:-]+$/.test(model) || !provider.models.includes(model)) throw new Error('Image model is not configured for this provider.');
  if (!prompt || Array.from(prompt).length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt)) throw new Error('Invalid image prompt.');
  if (request.size !== undefined && !['auto', '1024x1024', '1536x1024', '1024x1536'].includes(request.size)) throw new Error('Invalid image size.');
  if (request.quality !== undefined && !['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(request.quality) ||
      ['xhigh', 'max'].includes(request.quality ?? '') && !/^gpt-image-2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) throw new Error('Invalid image quality for model.');
  if (!validMoney(request.fallbackCostPerImage) || request.fallbackCostPerImage <= 0) throw new Error('A positive per-image fallback price is required.');
  const multiplier = provider.priceMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1_000) throw new Error('Invalid provider price multiplier.');
  for (const value of [price?.inputCostPerMillion, price?.outputCostPerMillion, price?.imageTextInputCostPerMillion, price?.imageInputCostPerMillion, price?.imageCachedInputCostPerMillion, price?.imageOutputCostPerMillion]) {
    if (value !== undefined && !validMoney(value)) throw new Error('Invalid image model price.');
  }

  try {
  let response: Response;
  try {
    response = await safeFetch(openAiEndpoint(provider.baseUrl, 'images/generations'), {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model, prompt, n: 1, size: request.size ?? 'auto', quality: request.quality ?? 'auto', output_format: 'png' }),
    }, fetchImpl, 120_000);
  } catch { throw new Error('Image provider request failed.'); } // Remote errors may echo the credential.

  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel();
    throw new Error('Image provider response must be JSON.');
  }
  let payload: unknown;
  try { payload = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)); }
  catch { throw new Error('Image provider response is invalid or too large.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Image provider response is invalid.');
  const result = payload as Record<string, unknown>;
  if (!Array.isArray(result.data) || result.data.length !== 1 || !result.data[0] || typeof result.data[0] !== 'object') throw new Error('Image provider must return exactly one image.');
  const encoded = (result.data[0] as Record<string, unknown>).b64_json;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Image provider returned invalid image data.');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image provider image exceeds the size limit.');
  const contentType = imageMime(bytes);
  const details = result.usage;
  if (details !== undefined && (!details || typeof details !== 'object' || Array.isArray(details))) throw new Error('Image provider usage is invalid.');
  const usage = (details ?? {}) as Record<string, unknown>;
  if (usage.input_tokens_details !== undefined && (!usage.input_tokens_details || typeof usage.input_tokens_details !== 'object' || Array.isArray(usage.input_tokens_details))) throw new Error('Image provider usage is invalid.');
  const inputDetails = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
  const textInputTokens = token(inputDetails.text_tokens);
  const imageInputTokens = token(inputDetails.image_tokens);
  const cachedImageInputTokens = token(inputDetails.cached_image_tokens);
  const imageOutputTokens = token(usage.output_tokens);
  const inputTokens = token(usage.input_tokens);
  const totalTokens = token(usage.total_tokens);
  if (cachedImageInputTokens !== undefined && (imageInputTokens === undefined || cachedImageInputTokens > imageInputTokens) ||
      textInputTokens !== undefined && imageInputTokens !== undefined && inputTokens !== undefined && textInputTokens + imageInputTokens !== inputTokens ||
      textInputTokens !== undefined && inputTokens !== undefined && textInputTokens > inputTokens ||
      imageInputTokens !== undefined && inputTokens !== undefined && imageInputTokens > inputTokens ||
      totalTokens !== undefined && ((inputTokens !== undefined && inputTokens > totalTokens) || (imageOutputTokens !== undefined && imageOutputTokens > totalTokens) || (inputTokens !== undefined && imageOutputTokens !== undefined && inputTokens + imageOutputTokens !== totalTokens))) throw new Error('Image provider usage is inconsistent.');
  const inputImageCount = imageInputTokens ?? (inputTokens !== undefined && textInputTokens === inputTokens ? 0 : undefined);
  const textRate = price?.imageTextInputCostPerMillion ?? price?.inputCostPerMillion;
  const outputRate = price?.imageOutputCostPerMillion ?? price?.outputCostPerMillion;
  const imageRate = price?.imageInputCostPerMillion;
  const cachedRate = price?.imageCachedInputCostPerMillion;
  const modalCost = textInputTokens !== undefined && inputImageCount !== undefined && imageOutputTokens !== undefined &&
    textRate !== undefined && outputRate !== undefined && (inputImageCount === 0 || imageRate !== undefined) &&
    (cachedImageInputTokens === undefined || cachedRate !== undefined)
    ? (textInputTokens * textRate + (inputImageCount - (cachedImageInputTokens ?? 0)) * (imageRate ?? 0) +
      (cachedImageInputTokens ?? 0) * (cachedRate ?? 0) + imageOutputTokens * outputRate) / 1_000_000 : 0;
  // Total-only responses cannot reveal modality mix; this average may underestimate the bill.
  const averageCost = totalTokens !== undefined && textRate !== undefined && outputRate !== undefined
    ? totalTokens * ((textRate + outputRate) / 2) / 1_000_000 : 0;
  const pricingSource = modalCost > 0 ? 'modalities' : averageCost > 0 ? 'total_estimate' : 'per_image_fallback';
  // Zero tokens or zero-valued prices are not evidence that the image was free.
  const cost = (pricingSource === 'modalities' ? modalCost : pricingSource === 'total_estimate' ? averageCost : request.fallbackCostPerImage) * multiplier;
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('Image generation price cannot be calculated.');
  return {
    bytes, contentType, filename: contentType === 'image/jpeg' ? 'generated.jpg' : contentType === 'image/webp' ? 'generated.webp' : 'generated.png',
    usage: { ...(textInputTokens !== undefined ? { textInputTokens } : {}), ...(inputImageCount !== undefined ? { imageInputTokens: inputImageCount } : {}), ...(cachedImageInputTokens !== undefined ? { cachedImageInputTokens } : {}), ...(imageOutputTokens !== undefined ? { imageOutputTokens } : {}), ...(totalTokens !== undefined ? { totalTokens } : {}) },
    cost, pricingSource, estimated: pricingSource !== 'modalities', ...(price?.id && pricingSource !== 'per_image_fallback' ? { priceId: price.id } : {}),
  };
  } catch (error) {
    throw new ImageGenerationAttemptError(error instanceof Error ? error.message : 'Image generation failed.', request.fallbackCostPerImage * multiplier);
  }
}
