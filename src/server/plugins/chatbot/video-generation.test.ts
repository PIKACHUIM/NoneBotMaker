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

  it('normalizes versioned provider base URLs without duplicating /v1', () => {
    expect(videoApiUrl('https://api.minimax.io', 'video_generation')).toBe('https://api.minimax.io/v1/video_generation');
    expect(videoApiUrl('https://api.example.com/v1', 'videos')).toBe('https://api.example.com/v1/videos');
    expect(videoApiUrl('https://api.example.com/v1/video_generation', 'video_generation')).toBe('https://api.example.com/v1/video_generation');
    const query = new URL(videoApiUrl('https://api.example.com/v1', 'query/video_generation', { task_id: 'a b' }));
    expect(query.searchParams.get('task_id')).toBe('a b');
  });
});
