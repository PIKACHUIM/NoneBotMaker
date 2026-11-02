const SEED_SIZE = 32;
const SIGNATURE_SIZE = 64;
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const FIELD = (1n << 255n) - 19n;
const CURVE_D = mod(-121665n * inverse(121666n));
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
const BASE_Y = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const GROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;
const keyCache = new Map<string, Promise<{ privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }>>();

interface ExtendedPoint {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

function mod(value: bigint): bigint {
  const result = value % FIELD;
  return result < 0n ? result + FIELD : result;
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let current = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = mod(result * current);
    current = mod(current * current);
    remaining >>= 1n;
  }
  return result;
}

function inverse(value: bigint): bigint {
  return power(value, FIELD - 2n);
}

function addPoints(left: ExtendedPoint, right: ExtendedPoint): ExtendedPoint {
  const a = mod((left.y - left.x) * (right.y - right.x));
  const b = mod((left.y + left.x) * (right.y + right.x));
  const c = mod(2n * CURVE_D * left.t * right.t);
  const d = mod(2n * left.z * right.z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return {
    x: mod(e * f),
    y: mod(g * h),
    z: mod(f * g),
    t: mod(e * h),
  };
}

function scalarMultiplyBase(scalar: bigint): ExtendedPoint {
  let result: ExtendedPoint = { x: 0n, y: 1n, z: 1n, t: 0n };
  let addend: ExtendedPoint = { x: BASE_X, y: BASE_Y, z: 1n, t: mod(BASE_X * BASE_Y) };
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

function littleEndianToBigInt(bytes: Uint8Array<ArrayBuffer>): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

function bigIntToLittleEndian(value: bigint, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let remaining = value;
  for (let index = 0; index < size; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function deriveSeed(botSecret: string): Uint8Array<ArrayBuffer> {
  const secret = new TextEncoder().encode(botSecret);
  if (secret.length === 0) throw new Error('Bot Secret is empty.');
  const seed = new Uint8Array(SEED_SIZE);
  for (let index = 0; index < SEED_SIZE; index += 1) seed[index] = secret[index % secret.length];
  return seed;
}

async function derivePublicKey(seed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', seed));
  digest[0] &= 248;
  digest[31] &= 63;
  digest[31] |= 64;
  const point = scalarMultiplyBase(littleEndianToBigInt(digest.subarray(0, 32)));
  const zInverse = inverse(point.z);
  const x = mod(point.x * zInverse);
  const y = mod(point.y * zInverse);
  const encoded = bigIntToLittleEndian(y, 32);
  encoded[31] |= Number(x & 1n) << 7;
  return encoded;
}

async function importPrivateKey(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

function getKeyMaterial(botSecret: string): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }> {
  const cached = keyCache.get(botSecret);
  if (cached) return cached;

  const material = (async () => {
    const seed = deriveSeed(botSecret);
    const [privateKey, publicKey] = await Promise.all([importPrivateKey(seed), derivePublicKey(seed)]);
    return { privateKey, publicKey };
  })();
  if (keyCache.size >= 200) keyCache.delete(keyCache.keys().next().value!);
  keyCache.set(botSecret, material);
  void material.catch(() => keyCache.delete(botSecret));
  return material;
}

function decodeSignature(signatureHex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return null;
  const signature = new Uint8Array(SIGNATURE_SIZE);
  for (let index = 0; index < signature.length; index += 1) {
    signature[index] = Number.parseInt(signatureHex.slice(index * 2, index * 2 + 2), 16);
  }
  if ((signature[63] & 0xe0) !== 0 || littleEndianToBigInt(signature.subarray(32)) >= GROUP_ORDER) return null;
  return signature;
}

export async function signWebhookChallenge(botSecret: string, eventTimestamp: string, plainToken: string): Promise<string> {
  const { privateKey } = await getKeyMaterial(botSecret);
  const message = new TextEncoder().encode(`${eventTimestamp}${plainToken}`);
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, message));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyWebhookSignature(
  botSecret: string,
  timestamp: string,
  body: Uint8Array<ArrayBuffer>,
  signatureHex: string,
): Promise<boolean> {
  if (!/^\d{1,20}$/.test(timestamp)) return false;
  const signature = decodeSignature(signatureHex);
  if (!signature) return false;

  const { publicKey } = await getKeyMaterial(botSecret);
  const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
  const timestampBytes = new TextEncoder().encode(timestamp);
  const signedPayload = new Uint8Array(timestampBytes.length + body.length);
  signedPayload.set(timestampBytes);
  signedPayload.set(body, timestampBytes.length);
  return crypto.subtle.verify('Ed25519', key, signature, signedPayload);
}
