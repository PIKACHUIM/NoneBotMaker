import type { ProviderRecord } from '../../../shared/types';
import { boundedBytes, boundedText, geminiEndpoint, isMissingModelError, publicHttpsUrl, safeFetch } from './network';

/** QQ rich-media upload rejects anything above 5 MiB, so larger videos fail before sending. */
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 6_000;
const DEFAULT_MAX_POLLS = 30;
const VEO_FALLBACKS = ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];

export type VideoProtocol = 'minimax' | 'openai' | 'veo';
export type VideoResolution = '768P' | '1080P';

export interface VideoGenerationRequest {
  model: string;
  prompt: string;
  duration: number;
  resolution: VideoResolution;
  protocol: VideoProtocol;
  /** Administrator-configured USD charge per second when no per-second price is configured. */
  fallbackCostPerSecond: number;
}

export interface VideoGenerationPrice {
  id: string;
  videoCostPerSecond?: number;
  videoCostPerSecondHd?: number;
}

export interface VideoGenerationResult {
  bytes: Uint8Array;
  contentType: 'video/mp4';
  filename: 'generated.mp4';
  duration: number;
  resolution: VideoResolution;
  cost: number;
  pricingSource: 'price' | 'per_second_fallback';
  estimated: boolean;
  priceId?: string;
  model: string;
}

export class VideoGenerationAttemptError extends Error {
  readonly estimatedCost: number;
  readonly pricingSource = 'per_second_fallback' as const;
  readonly estimated = true;
  /** 4xx responses never created a provider task, so they must not consume budget. */
  readonly billable: boolean;
  constructor(message: string, estimatedCost: number) {
    super(message);
    this.name = 'VideoGenerationAttemptError';
    this.estimatedCost = estimatedCost;
    this.billable = !/Remote request failed \(4\d{2}\)/i.test(message);
  }
}

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function deepString(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    if (Array.isArray(current) && !/^\d+$/.test(key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current ? current : undefined;
}

function deepNumber(value: unknown, ...path: string[]): number | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    if (Array.isArray(current) && !/^\d+$/.test(key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined;
}

function apiEndpoint(baseUrl: string, path: string, query?: Record<string, string>): string {
  const url = publicHttpsUrl(baseUrl);
  if (url.search || url.hash) throw new Error('Video provider URL cannot contain query parameters or a fragment.');
  let pathname = url.pathname.replace(/\/+$/, '');
  const suffix = `/${path.replace(/^\/+/, '')}`;
  if (!pathname.toLowerCase().endsWith(suffix.toLowerCase())) {
    pathname = !pathname ? `/v1${suffix}` : /\/v\d+$/i.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  }
  url.pathname = pathname;
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

async function requestJson(response: Response, label: string): Promise<Record<string, unknown>> {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel();
    throw new Error(`${label} must return JSON.`);
  }
  let payload: unknown;
  try { payload = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)); }
  catch { throw new Error(`${label} response is invalid or too large.`); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${label} response is invalid.`);
  return payload as Record<string, unknown>;
}

function remoteStatusError(payload: Record<string, unknown>): string | undefined {
  const code = deepNumber(payload, 'base_resp', 'status_code');
  if (code !== undefined && code !== 0) return deepString(payload, 'base_resp', 'status_msg') ?? `Provider error ${code}`;
  return undefined;
}

function assertMp4(bytes: Uint8Array): void {
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(4, 8)) !== 'ftyp') {
    throw new Error('Video provider returned an unsupported video format; MP4 is required.');
  }
}

async function downloadVideo(url: string, fetchImpl: typeof fetch, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const response = await safeFetch(url, { headers: { accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.5', ...headers } }, fetchImpl, 120_000);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mime && !mime.startsWith('video/') && mime !== 'application/octet-stream') {
    await response.body?.cancel();
    throw new Error('Video download did not return a video file.');
  }
  const bytes = await boundedBytes(response, MAX_VIDEO_BYTES);
  if (!bytes.length) throw new Error('Video download was empty.');
  assertMp4(bytes);
  return bytes;
}

async function generateMiniMax(
  provider: ProviderRecord,
  request: VideoGenerationRequest,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<Uint8Array> {
  const created = await requestJson(await safeFetch(apiEndpoint(provider.baseUrl, 'video_generation'), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    // H3 exposes 768P/2K while Hailuo exposes 768P/1080P; the conversation tier stays 1080P.
    body: JSON.stringify({
      model: request.model, prompt: request.prompt, duration: request.duration,
      resolution: request.resolution === '1080P' && /(?:^|[-_])H3(?:[-_]|$)/i.test(request.model) ? '2K' : request.resolution,
    }),
  }, fetchImpl, 60_000), 'Video provider');
  const statusError = remoteStatusError(created);
  if (statusError) throw new Error(statusError);
  const taskId = deepString(created, 'task_id') ?? deepString(created, 'task', 'id');
  if (!taskId || !/^[\w.:-]{1,256}$/.test(taskId)) throw new Error('Video provider did not return a task id.');

  let fileId: string | undefined;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (poll > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const status = await requestJson(await safeFetch(apiEndpoint(provider.baseUrl, 'query/video_generation', { task_id: taskId }), {
      headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'application/json' },
    }, fetchImpl, 30_000), 'Video status');
    const error = remoteStatusError(status);
    if (error) throw new Error(error);
    const state = (deepString(status, 'status') ?? deepString(status, 'task', 'status') ?? '').toLowerCase();
    if (['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(state)) {
      throw new Error(deepString(status, 'base_resp', 'status_msg') ?? 'Video generation failed.');
    }
    if (['success', 'succeeded', 'completed', 'done'].includes(state)) {
      fileId = deepString(status, 'file_id') ?? deepString(status, 'task', 'file_id');
      break;
    }
  }
  if (!fileId) throw new Error('Video generation timed out before the provider returned a file.');

  const file = await requestJson(await safeFetch(apiEndpoint(provider.baseUrl, 'files/retrieve', { file_id: fileId }), {
    headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'application/json' },
  }, fetchImpl, 30_000), 'Video file');
  const error = remoteStatusError(file);
  if (error) throw new Error(error);
  const downloadUrl = deepString(file, 'file', 'download_url') ?? deepString(file, 'download_url');
  if (!downloadUrl) throw new Error('Video provider did not return a download URL.');
  return downloadVideo(downloadUrl, fetchImpl);
}

async function generateOpenAiStyle(
  provider: ProviderRecord,
  request: VideoGenerationRequest,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<Uint8Array> {
  const created = await requestJson(await safeFetch(apiEndpoint(provider.baseUrl, 'videos'), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      seconds: String(request.duration),
      size: request.resolution === '1080P' ? '1920x1080' : '1280x720',
    }),
  }, fetchImpl, 60_000), 'Video provider');
  const taskId = deepString(created, 'id') ?? deepString(created, 'task_id');
  if (!taskId || !/^[\w.:-]{1,256}$/.test(taskId)) throw new Error('Video provider did not return a task id.');

  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (poll > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const status = await requestJson(await safeFetch(apiEndpoint(provider.baseUrl, `videos/${encodeURIComponent(taskId)}`), {
      headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'application/json' },
    }, fetchImpl, 30_000), 'Video status');
    const state = (deepString(status, 'status') ?? '').toLowerCase();
    const error = deepString(status, 'error', 'message');
    if (state === 'failed' || error) throw new Error(error ?? 'Video generation failed.');
    const directUrl = deepString(status, 'url') ?? deepString(status, 'video', 'url');
    if (['completed', 'succeeded', 'success'].includes(state)) {
      if (directUrl) return downloadVideo(directUrl, fetchImpl);
      const content = await safeFetch(apiEndpoint(provider.baseUrl, `videos/${encodeURIComponent(taskId)}/content`), {
        headers: { authorization: `Bearer ${provider.apiKey}`, accept: 'video/mp4,video/*;q=0.9' },
      }, fetchImpl, 120_000);
      const mime = (content.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (mime === 'application/json') {
        const payload = await requestJson(content, 'Video content');
        const url = deepString(payload, 'url') ?? deepString(payload, 'video', 'url');
        if (!url) throw new Error('Video provider did not return video data.');
        return downloadVideo(url, fetchImpl);
      }
      const bytes = await boundedBytes(content, MAX_VIDEO_BYTES);
      assertMp4(bytes);
      return bytes;
    }
  }
  throw new Error('Video generation timed out before the provider returned a file.');
}

/** Google Veo long-running operation: create, poll the operation, then fetch the signed video URI. */
async function generateVeo(
  provider: ProviderRecord,
  request: VideoGenerationRequest,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<Uint8Array> {
  const headers = {
    authorization: `Bearer ${provider.apiKey}`,
    'x-goog-api-key': provider.apiKey,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  // Veo only accepts 4/6/8-second clips; snap the configured duration instead of failing.
  const seconds = request.duration <= 4 ? 4 : request.duration <= 6 ? 6 : 8;
  const created = await requestJson(await safeFetch(geminiEndpoint(provider.baseUrl, `models/${request.model.replace(/^models\//i, '')}:predictLongRunning`), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instances: [{ prompt: request.prompt }],
      parameters: { aspectRatio: '16:9', resolution: request.resolution === '1080P' ? '1080p' : '720p', durationSeconds: seconds },
    }),
  }, fetchImpl, 60_000), 'Video provider');
  const operation = deepString(created, 'name');
  if (!operation || !/^[\w./:-]{1,512}$/.test(operation)) throw new Error('Video provider did not return an operation name.');

  let downloadUrl: string | undefined;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (poll > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const status = await requestJson(await safeFetch(geminiEndpoint(provider.baseUrl, operation), { headers }, fetchImpl, 30_000), 'Video status');
    if (status.error && typeof status.error === 'object') {
      throw new Error(deepString(status, 'error', 'message') ?? 'Video generation failed.');
    }
    if (status.done === true) {
      downloadUrl = deepString(status, 'response', 'generateVideoResponse', 'generatedVideos', '0', 'video', 'uri')
        ?? deepString(status, 'response', 'generatedVideos', '0', 'video', 'uri')
        ?? deepString(status, 'response', 'predictions', '0', 'video', 'uri')
        ?? deepString(status, 'response', 'videos', '0', 'uri');
      break;
    }
  }
  if (!downloadUrl) throw new Error('Video generation timed out before the provider returned a file.');
  return downloadVideo(downloadUrl, fetchImpl, { authorization: `Bearer ${provider.apiKey}`, 'x-goog-api-key': provider.apiKey });
}

/** Prefer the configured Veo id, but fall back when the provider says that model does not exist. */
async function resolveVeoModel(provider: ProviderRecord, configured: string, fetchImpl: typeof fetch): Promise<string> {
  const headers = { authorization: `Bearer ${provider.apiKey}`, 'x-goog-api-key': provider.apiKey, accept: 'application/json' };
  for (const candidate of [configured, ...VEO_FALLBACKS.filter((entry) => entry !== configured)]) {
    try {
      const response = await safeFetch(geminiEndpoint(provider.baseUrl, `models/${candidate}`), { headers }, fetchImpl, 15_000);
      await response.body?.cancel();
      return candidate;
    } catch (error) {
      // A missing model returns 404; auth or gateway failures must not be masked by switching models.
      if (!isMissingModelError(error)) return configured;
    }
  }
  return configured;
}

/** Performs one video generation. Caller must gate tool enablement, approval, budget and media sending. */
export async function generateVideo(
  provider: ProviderRecord,
  request: VideoGenerationRequest,
  price?: VideoGenerationPrice | null,
  fetchImpl: typeof fetch = fetch,
  options: { pollIntervalMs?: number; maxPolls?: number } = {},
): Promise<VideoGenerationResult> {
  if (!provider.enabled || !provider.apiKey) throw new Error('Video provider is unavailable.');
  const model = request.model.trim();
  const prompt = request.prompt.trim();
  if (!model || model.length > 256 || !/^[\w./:-]+$/.test(model) || !provider.models.includes(model)) throw new Error('Video model is not configured for this provider.');
  if (!prompt || Array.from(prompt).length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt)) throw new Error('Invalid video prompt.');
  if (!Number.isSafeInteger(request.duration) || request.duration < 1 || request.duration > 30) throw new Error('Video duration must be 1–30 seconds.');
  if (!['768P', '1080P'].includes(request.resolution)) throw new Error('Invalid video resolution.');
  if (!['minimax', 'openai', 'veo'].includes(request.protocol)) throw new Error('Invalid video protocol.');
  if (!validMoney(request.fallbackCostPerSecond) || request.fallbackCostPerSecond <= 0) throw new Error('A positive per-second fallback price is required.');
  const multiplier = provider.priceMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1_000) throw new Error('Invalid provider price multiplier.');
  for (const value of [price?.videoCostPerSecond, price?.videoCostPerSecondHd]) if (value !== undefined && !validMoney(value)) throw new Error('Invalid video model price.');
  const rate = request.resolution === '1080P'
    ? price?.videoCostPerSecondHd ?? price?.videoCostPerSecond
    : price?.videoCostPerSecond;
  const priced = rate !== undefined && rate > 0;
  const estimatedCost = (priced ? rate! : request.fallbackCostPerSecond) * request.duration * multiplier;
  if (!Number.isFinite(estimatedCost) || estimatedCost <= 0) throw new Error('Video generation price cannot be calculated.');

  const pollIntervalMs = Number.isSafeInteger(options.pollIntervalMs) && options.pollIntervalMs! >= 0 ? options.pollIntervalMs! : DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = Number.isSafeInteger(options.maxPolls) && options.maxPolls! > 0 ? options.maxPolls! : DEFAULT_MAX_POLLS;
  try {
    const effectiveModel = request.protocol === 'veo' ? await resolveVeoModel(provider, model, fetchImpl) : model;
    const bytes = request.protocol === 'minimax'
      ? await generateMiniMax(provider, request, fetchImpl, pollIntervalMs, maxPolls)
      : request.protocol === 'veo'
        ? await generateVeo(provider, { ...request, model: effectiveModel }, fetchImpl, pollIntervalMs, maxPolls)
        : await generateOpenAiStyle(provider, request, fetchImpl, pollIntervalMs, maxPolls);
    return {
      bytes,
      contentType: 'video/mp4',
      filename: 'generated.mp4',
      duration: request.duration,
      resolution: request.resolution,
      cost: estimatedCost,
      pricingSource: priced ? 'price' : 'per_second_fallback',
      estimated: !priced,
      model: effectiveModel,
      ...(priced && price?.id ? { priceId: price.id } : {}),
    };
  } catch (error) {
    throw new VideoGenerationAttemptError(error instanceof Error ? error.message : 'Video generation failed.', estimatedCost);
  }
}

/** Exposed for unit tests. */
export function videoApiUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  return apiEndpoint(baseUrl, path, query);
}
