import { describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../../../shared/types';
import { generateImage, ImageGenerationAttemptError, type ImageGenerationRequest } from './image-generation';
import { safeFetch } from './network';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const provider: ProviderRecord = { id: 'provider', name: 'test', baseUrl: 'https://images.example/v1', apiKey: 'private-key', enabled: true, models: ['image-model'], createdAt: '', updatedAt: '' };
const request: ImageGenerationRequest = { model: 'image-model', prompt: 'a sunflower', size: '1024x1024', quality: 'medium', fallbackCostPerImage: 0.08 };
const price = { id: 'price', inputCostPerMillion: 5, outputCostPerMillion: 20, imageTextInputCostPerMillion: 5, imageInputCostPerMillion: 3, imageCachedInputCostPerMillion: 1, imageOutputCostPerMillion: 20 };
const payload = (usage?: unknown, data: unknown = [{ b64_json: btoa(String.fromCharCode(...png)) }]) => new Response(JSON.stringify({ data, ...(usage === undefined ? {} : { usage }) }), { headers: { 'content-type': 'application/json' } });
const dns = () => Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const stub = (response: Response) => vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).includes('cloudflare-dns.com') ? dns() : response);

describe('Images API generation', () => {
  it('posts only one image, uses the stored provider credential and itemizes modal usage', async () => {
    const fetchImpl = stub(payload({ input_tokens: 100, input_tokens_details: { text_tokens: 80, image_tokens: 20 }, output_tokens: 1000, total_tokens: 1100 }));
    const result = await generateImage({ ...provider, priceMultiplier: 1.5 }, request, price, fetchImpl);
    expect(result).toMatchObject({ bytes: png, filename: 'generated.png', contentType: 'image/png', cost: (80 * 5 + 20 * 3 + 1000 * 20) / 1e6 * 1.5, estimated: false, pricingSource: 'modalities', priceId: 'price', usage: { textInputTokens: 80, imageInputTokens: 20, imageOutputTokens: 1000, totalTokens: 1100 } });
    const [url, init] = fetchImpl.mock.calls.at(-1)!;
    expect(url).toBe('https://images.example/v1/images/generations');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer private-key' });
    expect(init?.signal?.aborted).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'image-model', n: 1, output_format: 'png', size: '1024x1024', quality: 'medium' });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('response_format');
  });

  it('flags total-only prices as estimates, never mislabels input image tokens as prompt text', async () => {
    const onlyTotal = await generateImage(provider, request, price, stub(payload({ total_tokens: 2000 })));
    expect(onlyTotal).toMatchObject({ cost: 0.025, pricingSource: 'total_estimate', estimated: true, usage: { totalTokens: 2000 } });
    const incomplete = await generateImage(provider, request, price, stub(payload({ input_tokens: 100, output_tokens: 300 })));
    expect(incomplete).toMatchObject({ cost: 0.08, pricingSource: 'per_image_fallback', estimated: true, usage: { imageOutputTokens: 300 } });
    expect(incomplete.usage).not.toHaveProperty('textInputTokens');
    const unpricedImageInput = await generateImage(provider, request, { ...price, imageInputCostPerMillion: undefined }, stub(payload({ input_tokens: 100, input_tokens_details: { text_tokens: 80, image_tokens: 20 }, output_tokens: 300, total_tokens: 400 })));
    expect(unpricedImageInput).toMatchObject({ cost: 0.005, pricingSource: 'total_estimate', estimated: true });
    const legacy = await generateImage(provider, request, { id: 'legacy', inputCostPerMillion: 5, outputCostPerMillion: 30 }, stub(payload({ total_tokens: 1000 })));
    expect(legacy).toMatchObject({ cost: 0.0175, pricingSource: 'total_estimate', estimated: true });
    const cached = await generateImage(provider, request, price, stub(payload({ input_tokens: 100, input_tokens_details: { text_tokens: 80, image_tokens: 20, cached_image_tokens: 12 }, output_tokens: 1000, total_tokens: 1100 })));
    expect(cached).toMatchObject({ cost: (80 * 5 + 8 * 3 + 12 + 1000 * 20) / 1e6, pricingSource: 'modalities', usage: { cachedImageInputTokens: 12 } });
  });

  it('requires a positive fallback even if a model has a price, and charges it when usage is absent', async () => {
    await expect(generateImage(provider, { ...request, fallbackCostPerImage: 0 }, price, vi.fn())).rejects.toThrow('fallback');
    const result = await generateImage(provider, request, price, stub(payload()));
    expect(result).toMatchObject({ cost: 0.08, pricingSource: 'per_image_fallback', estimated: true });
    expect(result).not.toHaveProperty('priceId');
  });

  it('allows xhigh/max only for configured GPT image 2.5 Flare/Sunburst models', async () => {
    const configured = { ...provider, models: ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-2.5'] };
    for (const [model, quality] of [['gpt-image-2.5-flare', 'xhigh'], ['gpt-image-2.5-sunburst-2026-09-08', 'max']] as const) {
      const fetchImpl = stub(payload());
      await generateImage(configured, { ...request, model, quality }, price, fetchImpl);
      expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)![1]?.body)).quality).toBe(quality);
    }
    for (const model of ['gpt-image-2', 'gpt-image-2.5']) {
      const fetchImpl = vi.fn();
      await expect(generateImage(configured, { ...request, model, quality: 'max' }, price, fetchImpl)).rejects.toThrow('quality');
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('fails closed before fetching for invalid model, prompt, size, quality, provider or URL', async () => {
    for (const invalid of [{ ...request, model: 'unconfigured' }, { ...request, prompt: '  ' }, { ...request, size: '1x1' as ImageGenerationRequest['size'] }, { ...request, quality: 'ultra' as ImageGenerationRequest['quality'] }]) {
      const fetchImpl = vi.fn();
      await expect(generateImage(provider, invalid, price, fetchImpl)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    await expect(generateImage({ ...provider, enabled: false }, request)).rejects.toThrow('unavailable');
    await expect(generateImage({ ...provider, baseUrl: 'https://127.0.0.1/v1' }, request)).rejects.toThrow();
  });

  it('rejects malformed JSON/media, multiple outputs, malformed and inconsistent usage', async () => {
    const badResponses = [
      new Response('no', { headers: { 'content-type': 'text/plain' } }),
      payload({}, []), payload({}, [{ b64_json: 'SGVsbG8=' }]), payload({}, [{ b64_json: '???' }]),
      payload({}, [{ b64_json: btoa(String.fromCharCode(...png)) }, { b64_json: btoa(String.fromCharCode(...png)) }]),
      payload({ total_tokens: -1 }), payload({ input_tokens: 15, input_tokens_details: { text_tokens: 16 } }),
      payload({ input_tokens: 5, output_tokens: 5, total_tokens: 9 }), payload('unknown'),
    ];
    for (const response of badResponses) await expect(generateImage(provider, request, price, stub(response))).rejects.toThrow();
    const oversized = new Response('x'.repeat(12 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
    await expect(generateImage(provider, request, price, stub(oversized))).rejects.toThrow();
  });

  it('keeps the 20s common network timeout and bounds only image requests to 120s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const fetchImpl = stub(payload());
      await safeFetch('https://images.example/public', {}, fetchImpl);
      expect(timeout).toHaveBeenCalledWith(20_000);
      await generateImage(provider, request, price, stub(payload()));
      expect(timeout).toHaveBeenCalledWith(120_000);
      await expect(safeFetch('https://images.example', {}, fetchImpl, 120_001)).rejects.toThrow('timeout');
    } finally { timeout.mockRestore(); }
  });

  it('exposes estimated fallback cost after attempted requests fail, without leaking credentials', async () => {
    const attempt = generateImage({ ...provider, priceMultiplier: 2 }, request, price, stub(new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/image' } })));
    await expect(attempt).rejects.toMatchObject({ name: 'ImageGenerationAttemptError', estimatedCost: 0.16, estimated: true, pricingSource: 'per_image_fallback' });
    await expect(attempt).rejects.toBeInstanceOf(ImageGenerationAttemptError);
    await expect(generateImage(provider, request, price, stub(new Response('private-key', { status: 500 })))).rejects.toThrow('Image provider request failed.');
    const zeroUsage = await generateImage(provider, request, price, stub(payload({ input_tokens: 0, input_tokens_details: { text_tokens: 0 }, output_tokens: 0, total_tokens: 0 })));
    expect(zeroUsage).toMatchObject({ cost: 0.08, pricingSource: 'per_image_fallback', estimated: true });
  });
});
