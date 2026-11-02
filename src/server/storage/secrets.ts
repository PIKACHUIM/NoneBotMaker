import type { JsonObject, RuntimeBindings } from '../../shared/types';

const SECRET_MARKER = '__nonebotmaker_aes_gcm_v1__';
const REDACTED = '********';
const SENSITIVE_NAME = /(secret|token|password|passwd|api.?key|credential|private.?key|access.?key|client.?secret)/i;
const TOKEN_COUNT_NAME = /^(?:(?:agent_)?max_output_tokens|maxTokens|(?:input|output|prompt|completion|cached(?:_?prompt)?|total)_?tokens)$/i;

function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name) && !TOKEN_COUNT_NAME.test(name);
}

type EncryptedSecret = { [SECRET_MARKER]: true; iv: string; ciphertext: string };

export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[SECRET_MARKER] === true;
}

function isCredentialsMask(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).configured === true &&
    (value as Record<string, unknown>).masked === true;
}

async function encryptionKey(bindings: RuntimeBindings): Promise<CryptoKey> {
  if (!bindings.SYS_SECRET) throw new Error('SYS_SECRET is not configured.');
  const material = new TextEncoder().encode(bindings.SYS_SECRET);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encryptValue(value: unknown, key: CryptoKey): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cleartext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, cleartext);
  return { [SECRET_MARKER]: true, iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) };
}

async function transformSecrets(
  value: unknown,
  previous: unknown,
  bindings: RuntimeBindings,
  action: 'encrypt' | 'decrypt' | 'redact',
  key: CryptoKey | null,
  propertyName = '',
): Promise<unknown> {
  if (action === 'redact' && isSensitiveName(propertyName) && value !== null && value !== undefined) {
    return propertyName.toLowerCase() === 'credentials' ? { configured: true, masked: true } : REDACTED;
  }
  if (isEncryptedSecret(value)) {
    if (action === 'redact') return propertyName.toLowerCase() === 'credentials'
      ? { configured: true, masked: true }
      : REDACTED;
    if (!key) return value;
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(decodeBase64(value.iv)) }, key, toArrayBuffer(decodeBase64(value.ciphertext)));
    const decoded: unknown = JSON.parse(new TextDecoder().decode(clear));
    return action === 'decrypt' ? decoded : value;
  }

  if (action === 'encrypt' && isSensitiveName(propertyName)) {
    if ((value === '' || value === REDACTED || isCredentialsMask(value)) && isEncryptedSecret(previous)) return previous;
    if (value === null || value === undefined) return value;
    if (!key) key = await encryptionKey(bindings);
    return encryptValue(value, key);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => transformSecrets(item, Array.isArray(previous) ? previous[index] : undefined, bindings, action, key, String(index))));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) {
      const oldChild = typeof previous === 'object' && previous !== null ? (previous as Record<string, unknown>)[name] : undefined;
      result[name] = await transformSecrets(child, oldChild, bindings, action, key, name);
    }
    return result;
  }
  return value;
}

export async function encryptSecrets<T extends JsonObject>(value: T, previous: T | undefined, bindings: RuntimeBindings): Promise<T> {
  return await transformSecrets(value, previous, bindings, 'encrypt', null) as T;
}

export async function redactSecrets<T extends JsonObject>(value: T): Promise<T> {
  return await transformSecrets(value, undefined, {}, 'redact', null) as T;
}

export async function decryptSecrets<T extends JsonObject>(value: T, bindings: RuntimeBindings): Promise<T> {
  return await transformSecrets(value, undefined, bindings, 'decrypt', await encryptionKey(bindings)) as T;
}
