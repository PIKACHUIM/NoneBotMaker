import { describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../../../shared/types';
import { generateVideo, videoApiUrl, VideoGenerationAttemptError, type VideoGenerationRequest } from './video-generation';

const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
const provider: ProviderRecord = {
  id: 'video-provider', name: 'MiniMax', baseUrl: 'https://api.minimax.io', apiKey: 'private-key',
  enabled: true, models: ['MiniMax-H3'], createdAt: '', updatedAt: '',
};
const request: VideoGenerationRequest = {
  model: 'MiniMax-H3', prompt: 'a slow camera pan over a lake', duration: 6,
  resolution: '768P', protocol: 'minimax', fallbackCostPerSecond: 0.2,
};
const dns = () => Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const json = (value: unknown) => Response.json(value);

describe('video generation', () => {
  it('runs the MiniMax create, poll and file-retrieve flow and prices per second', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url === 'https://api.minimax.io/v1/video_generation') return json({ task_id: 'task-1', base_resp: { status_code: 0 } });
      if (url.startsWith('https://api.minimax.io/v1/query/video_generation?')) return json({ status: 'Success', file_id: 'file-1' });
      if (url.startsWith('https://api.minimax.io/v1/files/retrieve?')) return json({ file: { download_url: 'https://cdn.example.com/out.mp4' } });
      if (url === 'https://cdn.example.com/out.mp4') return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await generateVideo(provider, request, { id: 'h3', videoCostPerSecond: 0.08, videoCostPerSecondHd: 0.13 }, fetchImpl, { pollIntervalMs: 0, maxPolls: 2 });
    expect(result).toMatchObject({ bytes: mp4, contentType: 'video/mp4', duration: 6, resolution: '768P', cost: 0.48, pricingSource: 'price', estimated: false, priceId: 'h3' });
    expect(calls.some((url) => url.includes('/v1/query/video_generation?'))).toBe(true);
    expect(calls.some((url) => url.includes('/v1/files/retrieve?'))).toBe(true);
    const create = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/v1/video_generation'));
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({ model: 'MiniMax-H3', duration: 6, resolution: '768P' });
  });

  it('supports OpenAI-style /videos tasks and falls back to the per-second price for HD', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url === 'https://video.example/v1/videos') return json({ id: 'task-2', status: 'queued' });
      if (url === 'https://video.example/v1/videos/task-2') return json({ status: 'completed', url: 'https://cdn.example.com/openai.mp4' });
      if (url === 'https://cdn.example.com/openai.mp4') return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await generateVideo({ ...provider, baseUrl: 'https://video.example', models: ['sora-compatible'] },
      { ...request, model: 'sora-compatible', resolution: '1080P', protocol: 'openai' },
      { id: 'sora', videoCostPerSecond: 0.05 }, fetchImpl, { pollIntervalMs: 0, maxPolls: 2 });
    expect(result).toMatchObject({ cost: 0.05 * 6, pricingSource: 'price', resolution: '1080P' });
  });

  it('runs a Google Veo long-running operation and downloads the signed video', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url === 'https://veo.example/v1beta/models/veo-3.1:predictLongRunning') return json({ name: 'models/veo-3.1/operations/op-1' });
      if (url === 'https://veo.example/v1beta/models/veo-3.1/operations/op-1') return json({
        done: true,
        response: { generateVideoResponse: { generatedVideos: [{ video: { uri: 'https://cdn.example.com/veo.mp4' } }] } },
      });
      if (url === 'https://cdn.example.com/veo.mp4') return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await generateVideo({ ...provider, baseUrl: 'https://veo.example/v1', models: ['veo-3.1'] },
      { ...request, model: 'veo-3.1', protocol: 'veo', resolution: '1080P', duration: 5 }, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 2 });
    expect(result.bytes).toEqual(mp4);
    const create = fetchImpl.mock.calls.find(([url]) => String(url).includes(':predictLongRunning'));
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      instances: [{ prompt: request.prompt }],
      parameters: { resolution: '1080p', durationSeconds: 6 },
    });
    const download = fetchImpl.mock.calls.find(([url]) => String(url) === 'https://cdn.example.com/veo.mp4');
    expect((download?.[1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('private-key');
  });

  it('falls back to the OpenAI /videos route when the relay key is not a Gemini platform', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url.includes(':predictLongRunning')) return new Response(JSON.stringify({ error: { code: 400, message: 'API key group platform is not gemini' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (url === 'https://relay.example/v1/models') return json({ data: [{ id: 'gpt-6-astra' }, { id: 'sora-2' }] });
      if (url === 'https://relay.example/v1/videos') return json({ id: 'task-video-1' });
      if (url === 'https://relay.example/v1/videos/task-video-1') return json({ status: 'completed', url: 'https://cdn.example.com/fallback.mp4' });
      if (url === 'https://cdn.example.com/fallback.mp4') return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await generateVideo({ ...provider, baseUrl: 'https://relay.example/v1', models: ['veo-configured'] },
      { ...request, model: 'veo-configured', protocol: 'veo' }, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 2 });
    expect(result).toMatchObject({ protocol: 'openai', model: 'sora-2', bytes: mp4 });
    const create = fetchImpl.mock.calls.find(([url]) => String(url) === 'https://relay.example/v1/videos');
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({ model: 'sora-2', seconds: '8' });
  });

  it('charges the configured fallback and reports failures', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url.endsWith('/v1/video_generation')) return json({ task_id: 'task-3' });
      return json({ status: 'Processing' });
    });
    const error = await generateVideo(provider, request, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 1 }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VideoGenerationAttemptError);
    expect((error as VideoGenerationAttemptError).estimatedCost).toBeCloseTo(1.2);
    expect((error as VideoGenerationAttemptError).billable).toBe(true);
  });

  it('does not mark a 4xx provider rejection as billable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('cloudflare-dns.com')) return dns();
      return new Response('404 page not found', { status: 404 });
    });
    const error = await generateVideo({ ...provider, baseUrl: 'https://video.example' },
      { ...request, protocol: 'openai' }, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 1 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VideoGenerationAttemptError);
    expect((error as VideoGenerationAttemptError).billable).toBe(false);
  });

  it('fails closed for invalid video requests before fetching', async () => {
    for (const invalid of [
      { ...request, model: 'unconfigured' },
      { ...request, prompt: ' ' },
      { ...request, duration: 0 },
      { ...request, resolution: '4K' as VideoGenerationRequest['resolution'] },
      { ...request, protocol: 'custom' as VideoGenerationRequest['protocol'] },
      { ...request, fallbackCostPerSecond: 0 },
    ]) {
      const fetchImpl = vi.fn();
      await expect(generateVideo(provider, invalid, null, fetchImpl)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('stops on a platform-level video rejection without charging the group', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url.endsWith('/v1/models')) return json({ data: [] });
      return new Response(JSON.stringify({ error: { message: 'Videos API is not supported for this platform', type: 'invalid_request_error' } }),
        { status: 404, headers: { 'content-type': 'application/json' } });
    });
    const error = await generateVideo({ ...provider, baseUrl: 'https://relay.example' },
      { ...request, protocol: 'openai' }, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 1 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(VideoGenerationAttemptError);
    expect((error as Error).message).toMatch(/not allowed to use the video API/);
    expect((error as VideoGenerationAttemptError).billable).toBe(false);
  });

  it('reports every candidate the relay rejected', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) return dns();
      if (url.endsWith('/v1/models')) return json({ data: [{ id: 'sora-2' }, { id: 'chat-model' }] });
      return new Response(JSON.stringify({ error: { message: 'model not found' } }),
        { status: 404, headers: { 'content-type': 'application/json' } });
    });
    const error = await generateVideo({ ...provider, baseUrl: 'https://relay.example', models: ['sora-2'] },
      { ...request, model: 'sora-2', protocol: 'openai' }, null, fetchImpl, { pollIntervalMs: 0, maxPolls: 1 })
      .catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/rejected every candidate \(sora-2, /);
  });

  it('normalizes versioned provider base URLs without duplicating /v1', () => {
    expect(videoApiUrl('https://api.minimax.io', 'video_generation')).toBe('https://api.minimax.io/v1/video_generation');
    expect(videoApiUrl('https://api.example.com/v1', 'videos')).toBe('https://api.example.com/v1/videos');
    expect(videoApiUrl('https://api.example.com/v1/video_generation', 'video_generation')).toBe('https://api.example.com/v1/video_generation');
    const query = new URL(videoApiUrl('https://api.example.com/v1', 'query/video_generation', { task_id: 'a b' }));
    expect(query.searchParams.get('task_id')).toBe('a b');
  });
});
