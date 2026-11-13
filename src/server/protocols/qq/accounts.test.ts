import { describe, expect, it } from 'vitest';
import { CHATBOT_PLUGIN_TYPE, type JsonObject, type KVNamespaceLike, type RuntimeBindings } from '../../../shared/types';
import { encryptSecrets } from '../../storage/secrets';
import { resolveQQAccountByAppId, resolveQQAccountById } from './accounts';

function environment(): RuntimeBindings & { KV: KVNamespaceLike } {
  const values = new Map<string, string>();
  return { SYS_SECRET: 'test-encryption-key', KV: {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
    list: async (options) => ({ keys: [...values.keys()].filter((name) => name.startsWith(options?.prefix ?? '')).map((name) => ({ name })), list_complete: true }),
  } };
}

async function save(bindings: RuntimeBindings & { KV: KVNamespaceLike }, id: string, credentials: JsonObject) {
  await bindings.KV.put(`nonebotmaker:records:accounts:${id}`, JSON.stringify(await encryptSecrets({ id, protocol: 'qq', pluginId: 'plugin', credentials, enabled: true, createdAt: '', updatedAt: '' }, undefined, bindings)));
  await bindings.KV.put('nonebotmaker:records:plugins:plugin', JSON.stringify({ id: 'plugin', type: CHATBOT_PLUGIN_TYPE, enabled: true }));
}

describe('QQ credential resolution', () => {
  it('resolves encrypted canonical credentials by AppId and uses one secret for token/signature', async () => {
    const bindings = environment();
    await save(bindings, 'canonical', { appId: '11111', appSecret: 'same-app-secret' });
    await bindings.KV.put('nonebotmaker:records:plugins:plugin', JSON.stringify(await encryptSecrets({ id: 'plugin', type: CHATBOT_PLUGIN_TYPE, enabled: true, config: { brave_api_key: 'brave-key', agent_api_key: 'agent-key' } }, undefined, bindings)));
    const account = await resolveQQAccountByAppId('11111', bindings);
    expect(account).toMatchObject({ appId: '11111', appSecret: 'same-app-secret', pluginEnabled: true });
    expect(account?.botSecret).toBeUndefined();
    expect((await resolveQQAccountById('canonical', bindings))?.appSecret).toBe('same-app-secret');
    expect(account?.pluginConfig).toEqual({ web_search_engine: 'auto', web_search_results: 5, brave_api_key: 'brave-key' });
    expect((await resolveQQAccountById('canonical', bindings))?.pluginConfig).toEqual(account?.pluginConfig);
  });

  it('accepts matching legacy aliases but rejects conflicts and duplicate AppIds', async () => {
    const bindings = environment();
    await save(bindings, 'legacy', { appId: '22222', botSecret: 'same', clientSecret: 'same' });
    expect((await resolveQQAccountByAppId('22222', bindings))?.appSecret).toBe('same');
    await save(bindings, 'conflict', { appId: '33333', botSecret: 'one', clientSecret: 'two' });
    expect(await resolveQQAccountById('conflict', bindings)).toBeNull();
    await save(bindings, 'duplicate', { appId: '22222', appSecret: 'same' });
    expect(await resolveQQAccountByAppId('22222', bindings)).toBeNull();
  });
});
