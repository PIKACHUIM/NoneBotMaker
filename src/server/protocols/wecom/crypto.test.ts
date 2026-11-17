import { describe, expect, it } from 'vitest';
import { decryptWeCom, encryptWeCom, verifyWeComSignature, wecomSignature } from './crypto';

const key = 'a'.repeat(43);
const corpId = 'ww1234567890abcdef';

describe('WeCom crypto', () => {
  it('round-trips an encrypted envelope and validates the receive id', async () => {
    const encrypted = await encryptWeCom(key, '<xml>hello</xml>', corpId);
    expect(await decryptWeCom(key, encrypted, corpId)).toBe('<xml>hello</xml>');
    await expect(decryptWeCom(key, encrypted, 'wwother')).rejects.toThrow('receive id');
  });

  it('verifies SHA1 signatures over sorted parameters', async () => {
    const signature = await wecomSignature('token', '1700000000', 'nonce', 'encrypted');
    expect(await verifyWeComSignature('token', '1700000000', 'nonce', 'encrypted', signature)).toBe(true);
    expect(await verifyWeComSignature('token', '1700000000', 'nonce', 'encrypted', 'bad')).toBe(false);
  });

  it('rejects malformed keys', async () => {
    await expect(decryptWeCom('short', 'abc', corpId)).rejects.toThrow('EncodingAESKey');
  });
});
