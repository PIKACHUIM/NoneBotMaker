import type { ProviderRecord } from '../../shared/types';
import { boundedBytes, boundedText, geminiEndpoint, isMissingModelError, openAiEndpoint, publicHttpsUrl, safeFetch } from './chatbot/network';

export type SpeechProtocol = 'openai' | 'gemini' | 'minimax';

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  speed?: number;
  protocol?: SpeechProtocol | 'auto';
  maxBytes?: number;
  maxTextChars?: number;
}

export interface SpeechResult {
  bytes: Uint8Array;
  contentType: 'audio/mpeg' | 'audio/wav';
  filename: 'speech.mp3' | 'speech.wav';
  inputCharacters: number;
  model: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_CHARS = 4096;
const DEFAULT_VOICES: Record<SpeechProtocol, string> = { openai: 'alloy', gemini: 'Kore', minimax: 'male-qn-qingse' };
/** Google renames TTS previews frequently; a model-id 404 falls through to a sibling. */
const GEMINI_TTS_FALLBACKS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts', 'gemini-3.8-flash-tts', 'gemini-4-argon-tts'];

/** Picks the speech protocol from an explicit setting or the model naming convention. */
export function speechProtocolFor(model: string, configured: unknown = 'auto'): SpeechProtocol {
  if (configured === 'openai' || configured === 'gemini' || configured === 'minimax') return configured;
  if (/gemini/i.test(model) && /tts/i.test(model)) return 'gemini';
  if (/^(?:speech-\d|minimax)/i.test(model)) return 'minimax';
  return 'openai';
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function decodeHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Speech provider returned invalid audio data.');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function isMp3(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 ||
    bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === 'WAVE';
}

/** Gemini TTS returns raw 16-bit PCM; QQ accepts WAV, so wrap it with a minimal RIFF header. */
function wavFromPcm(pcm: Uint8Array, sampleRate: number, channels = 1, bitsPerSample = 16): Uint8Array {
  const blockAlign = channels * bitsPerSample / 8;
  const buffer = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(buffer.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  write(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  buffer.set(pcm, 44);
  return buffer;
}

function pcmSampleRate(mime: string): number {
  const rate = /rate=(\d+)/i.exec(mime)?.[1];
  return rate ? Math.min(48_000, Math.max(8_000, Number(rate))) : 24_000;
}

function audioResult(bytes: Uint8Array, inputCharacters: number, model: string): SpeechResult {
  if (isMp3(bytes)) return { bytes, contentType: 'audio/mpeg', filename: 'speech.mp3', inputCharacters, model };
  if (isWav(bytes)) return { bytes, contentType: 'audio/wav', filename: 'speech.wav', inputCharacters, model };
  throw new Error('Speech provider returned invalid MP3 or WAV audio.');
}

async function openAiSpeech(provider: ProviderRecord, model: string, input: string, voice: string, speed: number, maxBytes: number, inputCharacters: number, fetchImpl: typeof fetch): Promise<SpeechResult> {
  const response = await safeFetch(openAiEndpoint(provider.baseUrl, 'audio/speech'), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ model, input, voice, speed, response_format: 'mp3' }),
  }, fetchImpl);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
  if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'application/octet-stream'].includes(mime)) {
    await response.body?.cancel();
    throw new Error('Speech provider did not return audio.');
  }
  const bytes = await boundedBytes(response, maxBytes);
  if (!bytes.length) throw new Error('Speech provider returned empty audio.');
  return audioResult(bytes, inputCharacters, model);
}

async function geminiSpeech(provider: ProviderRecord, model: string, input: string, voice: string, maxBytes: number, inputCharacters: number, fetchImpl: typeof fetch): Promise<SpeechResult> {
  const geminiModel = model.replace(/^models\//i, '');
  const response = await safeFetch(geminiEndpoint(provider.baseUrl, `models/${geminiModel}:generateContent`), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'x-goog-api-key': provider.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  }, fetchImpl);
  const payload = JSON.parse(await boundedText(response, 8 * 1024 * 1024)) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }>;
    error?: { message?: string };
  };
  if (payload.error?.message) throw new Error(`Speech provider rejected the request: ${payload.error.message.slice(0, 300)}`);
  const part = payload.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data || item.inline_data?.data);
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline?.data) throw new Error('Speech provider returned no audio part.');
  const mime = String((inline as { mimeType?: string; mime_type?: string }).mimeType ?? (inline as { mime_type?: string }).mime_type ?? '').toLowerCase();
  let bytes = decodeBase64(inline.data);
  if (bytes.byteLength > maxBytes) throw new Error('Response exceeds size limit.');
  if (!isMp3(bytes) && !isWav(bytes)) bytes = wavFromPcm(bytes, pcmSampleRate(mime));
  return audioResult(bytes, inputCharacters, model);
}

async function miniMaxSpeech(provider: ProviderRecord, model: string, input: string, voice: string, speed: number, maxBytes: number, inputCharacters: number, fetchImpl: typeof fetch): Promise<SpeechResult> {
  const response = await safeFetch(openAiEndpoint(provider.baseUrl, 't2a_v2'), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model, text: input, stream: false,
      voice_setting: { voice_id: voice, speed: Math.min(2, Math.max(0.5, speed)), vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 },
    }),
  }, fetchImpl);
  const payload = JSON.parse(await boundedText(response, 8 * 1024 * 1024)) as {
    data?: { audio?: unknown };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (payload.base_resp?.status_code) throw new Error(`Speech provider rejected the request: ${String(payload.base_resp.status_msg ?? payload.base_resp.status_code).slice(0, 300)}`);
  if (typeof payload.data?.audio !== 'string') throw new Error('Speech provider returned no audio data.');
  const bytes = decodeHex(payload.data.audio);
  if (!bytes.length) throw new Error('Speech provider returned empty audio.');
  if (bytes.byteLength > maxBytes) throw new Error('Response exceeds size limit.');
  return audioResult(bytes, inputCharacters, model);
}

export async function createSpeech(
  provider: ProviderRecord,
  request: SpeechRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SpeechResult> {
  if (!provider.enabled || !provider.apiKey) throw new Error('Speech provider is unavailable.');
  const url = publicHttpsUrl(provider.baseUrl);
  if (url.search || url.hash) throw new Error('Speech provider URL cannot contain query parameters or a fragment.');
  const model = request.model.trim();
  const input = request.input.trim();
  const protocol = speechProtocolFor(model, request.protocol);
  const voice = request.voice?.trim() || DEFAULT_VOICES[protocol];
  const speed = request.speed ?? 1;
  const maxTextChars = request.maxTextChars ?? MAX_INPUT_CHARS;
  const maxBytes = request.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!model || model.length > 256 || !/^[\w./:-]+$/.test(model)) throw new Error('Invalid speech model.');
  if (!voice || voice.length > 128 || !/^[\w-]+$/.test(voice)) throw new Error('Invalid speech voice.');
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error('Speech speed must be between 0.25 and 4.');
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars < 1 || maxTextChars > MAX_INPUT_CHARS) throw new Error('Invalid speech text limit.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_UPLOAD_BYTES) throw new Error('Invalid speech media limit.');
  const inputCharacters = Array.from(input).length;
  if (!inputCharacters || inputCharacters > maxTextChars) throw new Error('Speech text exceeds the configured limit.');
  if (protocol === 'gemini') {
    let lastError: unknown;
    for (const candidate of [model, ...GEMINI_TTS_FALLBACKS.filter((entry) => entry !== model)]) {
      try {
        return await geminiSpeech(provider, candidate, input, voice, maxBytes, inputCharacters, fetchImpl);
      } catch (error) {
        lastError = error;
        if (!isMissingModelError(error)) throw error;
      }
    }
    throw lastError;
  }
  return protocol === 'minimax'
    ? miniMaxSpeech(provider, model, input, voice, speed, maxBytes, inputCharacters, fetchImpl)
    : openAiSpeech(provider, model, input, voice, speed, maxBytes, inputCharacters, fetchImpl);
}
