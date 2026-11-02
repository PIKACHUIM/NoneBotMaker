import type { RuntimeBindings } from '../shared/types';

export const SESSION_COOKIE = 'nbm_session';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}

async function hmacKey(bindings: RuntimeBindings): Promise<CryptoKey> {
  const secret = bindings.DB_SECRET;
  if (!secret) throw new Error('DB_SECRET must be configured.');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`nonebotmaker/session/v1:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function constantTimePasswordMatches(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = candidateBytes.length ^ expectedBytes.length;
  for (let index = 0; index < candidateBytes.length; index += 1) difference |= candidateBytes[index] ^ expectedBytes[index];
  return difference === 0;
}

export async function createSessionToken(bindings: RuntimeBindings, now = Date.now()): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ sub: 'admin', iat: now, exp: now + SESSION_MAX_AGE_SECONDS * 1000 })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(bindings), encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(bindings: RuntimeBindings, token: string | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as { sub?: unknown; exp?: unknown };
    if (payload.sub !== 'admin' || typeof payload.exp !== 'number' || payload.exp <= now) return false;
    return await crypto.subtle.verify('HMAC', await hmacKey(bindings), toArrayBuffer(base64UrlDecode(parts[1])), encoder.encode(parts[0]));
  } catch {
    return false;
  }
}

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    return !fetchSite || fetchSite === 'same-origin';
  } catch {
    return false;
  }
}
