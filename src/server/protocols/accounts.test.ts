import { describe, expect, it } from 'vitest';
import { CHATBOT_PLUGIN_TYPE, type JsonObject, type KVNamespaceLike, type RuntimeBindings } from '../../shared/types';
import { encryptSecrets } from '../storage/secrets';
import { resolveChatAccountByCredential, resolveChatAccountById } from './accounts';

function environment(): RuntimeBindings & { KV: KVNamespaceLike } {
  const values = new Map<string, string>();
  return { SYS_SECRET: 'test-encryption-key', KV: {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
    list: async (options) => ({ keys: [...values.keys()].filter((name) => name.startsWith(options?.prefix ?? '')).map((name) => ({ name })), list_complete: true }),
  } };
}

async function save(bindings: RuntimeBindings & { KV: KVNamespaceLike }, id: string, protocol: string, credentials: JsonObject) {
  await bindings.KV.put(`nonebotmaker:records:accounts:${id}`, JSON.stringify(await encryptSecrets({ id, protocol, pluginId: 'plugin', credentials, enabled: true, createdAt: '', updatedAt: '' }, undefined, bindings)));
  await bindings.KV.put('nonebotmaker:records:plugins:plugin', JSON.stringify(await encryptSecrets({ id: 'plugin', type: CHATBOT_PLUGIN_TYPE, enabled: true, config: { web_search_results: 3 } }, undefined, bindings)));
}

describe('generic chat account resolution', () => {
  it('builds protocol-scoped credentials for Feishu accounts', async () => {
    const bindings = environment();
    await save(bindings, 'feishu', 'feishu', { appId: 'cli_1', appSecret: 'secret', verificationToken: 'verify', encryptKey: '' });
    const account = await resolveChatAccountByCredential('feishu', 'cli_1', bindings);
    expect(account).toMatchObject({
      protocol: 'feishu', appId: 'cli_1', appSecret: 'secret', pluginEnabled: true,
      credentials: { appId: 'cli_1', appSecret: 'secret', verificationToken: 'verify', encryptKey: '' },
    });
    expect(account?.pluginConfig).toMatchObject({ web_search_results: 3 });
    expect((await resolveChatAccountById('feishu', bindings))?.protocol).toBe('feishu');
  });

  it('keeps protocol identifiers separate and rejects unknown protocols', async () => {
    const bindings = environment();
    await save(bindings, 'wechat', 'wechat', { appId: 'wx_1', appSecret: 'secret', token: 'token' });
    expect(await resolveChatAccountByCredential('feishu', 'wx_1', bindings)).toBeNull();
    expect((await resolveChatAccountByCredential('wechat', 'wx_1', bindings))?.protocol).toBe('wechat');
    await save(bindings, 'slack', 'slack', { appId: 'x', appSecret: 'secret' });
    expect(await resolveChatAccountById('slack', bindings)).toBeNull();
  });

  it('resolves OneBot without a required signing secret and derives Telegram bot IDs', async () => {
    const bindings = environment();
    await save(bindings, 'onebot', 'onebot', { selfId: '10001', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: '', secret: '' });
    expect(await resolveChatAccountByCredential('onebot', '10001', bindings)).toMatchObject({
      protocol: 'onebot', appId: '10001', appSecret: undefined,
    });
    await save(bindings, 'telegram', 'telegram', { botToken: '123456789:AA-test', secretToken: 'secret-token' });
    expect(await resolveChatAccountById('telegram', bindings)).toMatchObject({
      protocol: 'telegram', appId: '123456789', appSecret: '123456789:AA-test',
      credentials: { botId: '123456789', botToken: '123456789:AA-test', secretToken: 'secret-token' },
    });
    await save(bindings, 'bad-onebot', 'onebot', { selfId: '10002', apiBaseUrl: 'file:///tmp/socket' });
    expect(await resolveChatAccountById('bad-onebot', bindings)).toBeNull();
  });
});
