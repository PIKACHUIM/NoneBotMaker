import type { ProviderRecord } from '../../shared/types';
import { boundedBytes, openAiEndpoint, publicHttpsUrl, safeFetch } from './chatbot/network';

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  speed?: number;
  maxBytes?: number;
  maxTextChars?: number;
}

export interface SpeechResult {
  bytes: Uint8Array;
  contentType: 'audio/mpeg';
  filename: 'speech.mp3';
  inputCharacters: number;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_CHARS = 4096;

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
  const voice = request.voice?.trim() || 'alloy';
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
  const response = await safeFetch(openAiEndpoint(provider.baseUrl, 'audio/speech'), {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ model, input, voice, speed, response_format: 'mp3' }),
  }, fetchImpl);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
  if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(mime)) {
    await response.body?.cancel();
    throw new Error('Speech provider did not return audio.');
  }
  const bytes = await boundedBytes(response, maxBytes);
  if (!bytes.length) throw new Error('Speech provider returned empty audio.');
  const validMp3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 ||
    bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!validMp3) throw new Error('Speech provider returned invalid MP3 audio.');
  return { bytes, contentType: 'audio/mpeg', filename: 'speech.mp3', inputCharacters };
}
