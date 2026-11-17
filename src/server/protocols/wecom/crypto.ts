import { base64Decode, base64Encode, sha1Hex, safeEqual } from '../crypto';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** WeCom AES keys are the 43-character EncodingAESKey plus one `=` padding. */
export function wecomKey(encodingAESKey: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]{43}$/.test(encodingAESKey)) throw new Error('WeCom EncodingAESKey is invalid.');
  return base64Decode(`${encodingAESKey}=`);
}

export async function wecomSignature(token: string, timestamp: string, nonce: string, encrypt: string): Promise<string> {
  return sha1Hex([token, timestamp, nonce, encrypt].sort().join(''));
}

export async function verifyWeComSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string,
): Promise<boolean> {
  return safeEqual(await wecomSignature(token, timestamp, nonce, encrypt), signature);
}

/** Decrypts a WeCom envelope: random(16) + msg_len(4) + msg + receive_id. */
export async function decryptWeCom(encodingAESKey: string, encrypted: string, corpId: string): Promise<string> {
  const key = wecomKey(encodingAESKey);
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-CBC' }, false, ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: toArrayBuffer(key.slice(0, 16)) },
      cryptoKey,
      toArrayBuffer(base64Decode(encrypted)),
    );
  } catch {
    throw new Error('WeCom payload decryption failed.');
  }
  const view = new Uint8Array(plaintext);
  if (view.byteLength < 20) throw new Error('WeCom payload is too short.');
  const length = new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(16);
  if (length < 0 || 20 + length > view.byteLength) throw new Error('WeCom payload length is invalid.');
  const message = new TextDecoder('utf-8', { fatal: true }).decode(view.slice(20, 20 + length));
  const receiveId = new TextDecoder('utf-8', { fatal: true }).decode(view.slice(20 + length));
  if (receiveId !== corpId) throw new Error('WeCom receive id mismatch.');
  return message;
}

/** Builds a WeCom envelope, used for tests and passive replies. */
export async function encryptWeCom(encodingAESKey: string, message: string, corpId: string): Promise<string> {
  const key = wecomKey(encodingAESKey);
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'AES-CBC' }, false, ['encrypt']);
  const messageBytes = new TextEncoder().encode(message);
  const corpBytes = new TextEncoder().encode(corpId);
  const plaintext = new Uint8Array(16 + 4 + messageBytes.length + corpBytes.length);
  crypto.getRandomValues(plaintext.subarray(0, 16));
  new DataView(plaintext.buffer).setUint32(16, messageBytes.length);
  plaintext.set(messageBytes, 20);
  plaintext.set(corpBytes, 20 + messageBytes.length);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(key.slice(0, 16)) },
    cryptoKey,
    toArrayBuffer(plaintext),
  );
  return base64Encode(new Uint8Array(ciphertext));
}
