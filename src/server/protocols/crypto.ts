/** Small WebCrypto helpers shared by the webhook protocol adapters. */

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function base64Decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function hexEncode(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256Base64(secret: string, data: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await importHmacKey(secret), new TextEncoder().encode(data));
  return base64Encode(new Uint8Array(signature));
}

/** Slack and Meta sign webhooks with hex-encoded HMAC-SHA256. */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await importHmacKey(secret), new TextEncoder().encode(data));
  return hexEncode(new Uint8Array(signature));
}

/** OneBot v11 signs HTTP reports with HMAC-SHA1, usually prefixed with `sha1=`. */
export async function hmacSha1Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return hexEncode(new Uint8Array(signature));
}

export async function sha1Hex(data: string): Promise<string> {
  return hexEncode(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))));
}

export async function sha256Hex(data: string): Promise<string> {
  return hexEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))));
}

export async function sha256Bytes(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

/** Decrypts Feishu's AES-256-CBC payload where the first 16 bytes are the IV. */
export async function decryptAesCbc(encryptKey: string, payload: string): Promise<string> {
  const content = base64Decode(payload);
  if (content.length <= 16) throw new Error('Encrypted payload is too short.');
  const key = await importAesKey(await sha256Bytes(encryptKey));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(content.slice(0, 16)) },
    key,
    toArrayBuffer(content.slice(16)),
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

/** Encrypts a challenge response using the same Feishu envelope. */
export async function encryptAesCbc(encryptKey: string, plaintext: string): Promise<string> {
  const key = await importAesKey(await sha256Bytes(encryptKey));
  const iv = randomBytes(16);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(plaintext)),
  ));
  const envelope = new Uint8Array(iv.length + ciphertext.length);
  envelope.set(iv);
  envelope.set(ciphertext, iv.length);
  return base64Encode(envelope);
}

/** Constant-time comparison for signatures and tokens. */
export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
