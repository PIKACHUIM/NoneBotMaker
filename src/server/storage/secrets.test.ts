import { describe, expect, it } from 'vitest';
import { decryptSecrets, encryptSecrets, isEncryptedSecret, redactSecrets } from './secrets';

describe('secret storage', () => {
  it('keeps an existing encrypted secret when an edit submits an empty string', async () => {
    const bindings = { SYS_SECRET: 'test-db-secret' };
    const original = await encryptSecrets({ apiKey: 'provider-secret' }, undefined, bindings);
    const edited = await encryptSecrets({ apiKey: '' }, original, bindings);

    expect(edited.apiKey).toEqual(original.apiKey);
    expect(await decryptSecrets(edited, bindings)).toEqual({ apiKey: 'provider-secret' });
  });

  it.each(['agent_max_output_tokens', 'max_output_tokens', 'maxTokens', 'input_tokens', 'output_tokens', 'total_tokens', 'promptTokens', 'completionTokens', 'cachedPromptTokens', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens'])(
    'keeps token count %s numeric during encryption and redaction', async (key) => {
      const counts = { [key]: 8192 };
      expect(await encryptSecrets(counts, undefined, {})).toEqual(counts);
      expect(await redactSecrets(counts)).toEqual(counts);
      expect(await encryptSecrets({ [key]: 0 }, undefined, {})).toEqual({ [key]: 0 });
    },
  );

  it('does not treat numeric passwords or credential tokens as public counts', async () => {
    const bindings = { SYS_SECRET: 'test-db-secret' };
    const source = { password: 123456, access_token: 789, authToken: 101112 };
    const encrypted = await encryptSecrets(source, undefined, bindings);
    expect(Object.values(encrypted).every(isEncryptedSecret)).toBe(true);
    expect(await redactSecrets(encrypted)).toEqual({ password: '********', access_token: '********', authToken: '********' });
    expect(await decryptSecrets(encrypted, bindings)).toEqual(source);
  });

  it.each(['authToken', 'bearerToken', 'access_token', 'brave_api_key', 'appSecret', 'password', 'credentials'])(
    'continues to encrypt and redact actual secret %s', async (key) => {
      const bindings = { SYS_SECRET: 'test-db-secret' };
      const source = { [key]: key === 'credentials' ? { appId: '123', appSecret: 'private' } : 'private' };
      const encrypted = await encryptSecrets(source, undefined, bindings);
      expect(isEncryptedSecret(encrypted[key])).toBe(true);
      expect(await decryptSecrets(encrypted, bindings)).toEqual(source);
      const redacted = await redactSecrets(encrypted);
      expect(redacted[key]).toEqual(key === 'credentials' ? { configured: true, masked: true } : '********');
    },
  );
});
