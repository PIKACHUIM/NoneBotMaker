import { describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../../shared/types';
import { createSpeech } from './ai-media';

const provider: ProviderRecord = { id: 'api', name: 'AI', enabled: true, baseUrl: 'https://api.vendor.dev/v1', apiKey: 'speech-test-secret', models: [], createdAt: '', updatedAt: '' };
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0]);
function mockFetch(response?: () => Response) {
  return vi.fn<typeof fetch>(async (url) => String(url).startsWith('https://cloudflare-dns.com/')
    ? Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] })
    : response?.() ?? new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } }));
}

describe('AI API speech generation', () => {
  it('requests MP3 from the selected provider without a local filesystem', async () => {
    const fetchImpl = mockFetch();
    const result = await createSpeech(provider, { model: 'custom-tts', input: '你好', voice: 'alloy', speed: 1.2 }, fetchImpl);
    expect(result.inputCharacters).toBe(2);
    expect(result.bytes).toEqual(mp3);
    const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/audio/speech'))!;
    expect(call[1]?.redirect).toBe('manual');
    expect(JSON.parse(String(call[1]?.body))).toEqual({ model: 'custom-tts', input: '你好', voice: 'alloy', speed: 1.2, response_format: 'mp3' });
  });

  it.each([
    { model: '', input: 'hello' },
    { model: 'tts', input: '' },
    { model: 'tts', input: 'hello', maxTextChars: 4 },
    { model: 'tts', input: 'hello', speed: 5 },
    { model: 'tts', input: 'hello', maxBytes: 6 * 1024 * 1024 },
  ])('validates input before invoking a billed API', async (request) => {
    const fetchImpl = mockFetch();
    await expect(createSpeech(provider, request, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a private provider endpoint before invoking it', async () => {
    const fetchImpl = mockFetch();
    await expect(createSpeech({ ...provider, baseUrl: 'https://127.0.0.1/v1' }, { model: 'tts', input: 'hello' }, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-audio, empty and oversized responses', async () => {
    await expect(createSpeech(provider, { model: 'tts', input: 'hello' }, mockFetch(() => Response.json({ error: 'not audio' })))).rejects.toThrow('did not return audio');
    await expect(createSpeech(provider, { model: 'tts', input: 'hello' }, mockFetch(() => new Response('', { headers: { 'content-type': 'audio/mpeg' } })))).rejects.toThrow('empty');
    await expect(createSpeech(provider, { model: 'tts', input: 'hello', maxBytes: 2 }, mockFetch())).rejects.toThrow('size limit');
  });

  it('rejects invalid audio and never follows a redirect', async () => {
    await expect(createSpeech(provider, { model: 'tts', input: 'hello' }, mockFetch(() => new Response('not mp3', { headers: { 'content-type': 'application/octet-stream' } })))).rejects.toThrow('invalid MP3');
    await expect(createSpeech(provider, { model: 'tts', input: 'hello' }, mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://private.dev' } })))).rejects.toThrow('Redirects');
  });

  it('wraps Gemini TTS PCM into WAV and calls the native v1beta endpoint', async () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
    const data = btoa(String.fromCharCode(...pcm));
    const fetchImpl = mockFetch(() => Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data } }] } }],
    }));
    const result = await createSpeech({ ...provider, models: ['gemini-2.5-flash-preview-tts'] },
      { model: 'gemini-2.5-flash-preview-tts', input: '你好' }, fetchImpl);
    expect(result).toMatchObject({ contentType: 'audio/wav', filename: 'speech.wav', inputCharacters: 2 });
    expect(new TextDecoder().decode(result.bytes.subarray(0, 4))).toBe('RIFF');
    expect(result.bytes.byteLength).toBe(44 + pcm.byteLength);
    const call = fetchImpl.mock.calls.find(([url]) => String(url).includes(':generateContent'))!;
    expect(String(call[0])).toBe('https://api.vendor.dev/v1beta/models/gemini-2.5-flash-preview-tts:generateContent');
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    });
  });

  it('decodes MiniMax hex audio and uses its default voice', async () => {
    const fetchImpl = mockFetch(() => Response.json({ data: { audio: '494433040000' }, base_resp: { status_code: 0 } }));
    const result = await createSpeech({ ...provider, models: ['speech-02-hd'] }, { model: 'speech-02-hd', input: '你好' }, fetchImpl);
    expect(result).toMatchObject({ contentType: 'audio/mpeg', filename: 'speech.mp3', inputCharacters: 2 });
    const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/t2a_v2'))!;
    expect(String(call[0])).toBe('https://api.vendor.dev/v1/t2a_v2');
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ model: 'speech-02-hd', text: '你好', voice_setting: { voice_id: 'male-qn-qingse' } });
  });

  it('honors an explicit speech protocol even when the model name looks like another vendor', async () => {
    const fetchImpl = mockFetch(() => Response.json({ data: { audio: '494433040000' }, base_resp: { status_code: 0 } }));
    const result = await createSpeech(provider, { model: 'custom-tts', input: 'hi', protocol: 'minimax' }, fetchImpl);
    expect(result.contentType).toBe('audio/mpeg');
  });
});
