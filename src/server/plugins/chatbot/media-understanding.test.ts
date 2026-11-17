import { describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../../../shared/types';
import { describeMedia, understandingProtocolFor } from './media-understanding';

const provider: ProviderRecord = {
  id: 'vision', name: 'Vision', baseUrl: 'https://vision.example/v1', apiKey: 'vision-secret',
  enabled: true, models: ['gemini-2.5-flash', 'gpt-6-astra'], createdAt: '', updatedAt: '',
};
const dns = () => Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const media = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' };

describe('media understanding', () => {
  it('detects Gemini models and calls the native generateContent endpoint', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).includes('dns-query')
      ? dns()
      : Response.json({ candidates: [{ content: { parts: [{ text: '图片里有一行文字。' }] } }] }));
    const text = await describeMedia(provider, 'gemini-2.5-flash', media, 'image', fetchImpl);
    expect(text).toBe('图片里有一行文字。');
    const call = fetchImpl.mock.calls.find(([url]) => String(url).includes(':generateContent'))!;
    expect(String(call[0])).toBe('https://vision.example/v1beta/models/gemini-2.5-flash:generateContent');
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: expect.stringContaining('不可信数据') }, { inline_data: { mime_type: 'image/png' } }] }],
    });
    expect((call[1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('vision-secret');
  });

  it('uses an OpenAI-compatible image_url part for non-Gemini models', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).includes('dns-query')
      ? dns()
      : Response.json({ choices: [{ message: { content: '一只猫。' } }] }));
    const text = await describeMedia(provider, 'gpt-6-astra', media, 'image', fetchImpl);
    expect(text).toBe('一只猫。');
    const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ model: 'gpt-6-astra', messages: [{ role: 'user', content: [{ type: 'text' }, { type: 'image_url' }] }] });
  });

  it('rejects audio formats the OpenAI-compatible protocol cannot carry', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes('dns-query') ? dns() : Response.json({}));
    await expect(describeMedia(provider, 'gpt-6-astra', { bytes: new Uint8Array([1]), mime: 'audio/ogg' }, 'audio', fetchImpl))
      .rejects.toThrow('MP3/WAV');
  });

  it('rejects unconfigured models and unavailable providers', async () => {
    await expect(describeMedia(provider, 'unlisted', media, 'image', vi.fn())).rejects.toThrow('not configured');
    await expect(describeMedia({ ...provider, enabled: false }, 'gpt-6-astra', media, 'image', vi.fn())).rejects.toThrow('unavailable');
    expect(understandingProtocolFor('gemini-2.5-pro')).toBe('gemini');
    expect(understandingProtocolFor('gpt-6-astra')).toBe('openai');
  });
});
