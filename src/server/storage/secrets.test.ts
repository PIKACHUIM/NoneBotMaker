import { describe, expect, it } from 'vitest';
import { decryptSecrets, encryptSecrets } from './secrets';

describe('secret storage', () => {
  it('keeps an existing encrypted secret when an edit submits an empty string', async () => {
    const bindings = { SYS_SECRET: 'test-db-secret' };
    const original = await encryptSecrets({ apiKey: 'provider-secret' }, undefined, bindings);
    const edited = await encryptSecrets({ apiKey: '' }, original, bindings);

    expect(edited.apiKey).toEqual(original.apiKey);
    expect(await decryptSecrets(edited, bindings)).toEqual({ apiKey: 'provider-secret' });
  });
});
