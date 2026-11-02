import { CHATBOT_PLUGIN_TYPE, type JsonObject, type RuntimeBindings } from '../../../shared/types';
import type { BotAccountRecord } from '../../../shared/types';
import { createRepository } from '../../storage/repository';
import { decryptSecrets } from '../../storage/secrets';
import type { QQAccountContext } from './types';

export async function resolveQQAccountByAppId(appId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  const repository = createRepository(bindings);
  const accounts = await repository.list('accounts');
  let resolved: QQAccountContext | null = null;
  let matched = false;
  for (const stored of accounts) {
    if (stored.protocol !== 'qq') continue;
    const account = await decryptSecrets(stored as JsonObject, bindings) as unknown as BotAccountRecord;
    if (account.credentials?.appId !== appId) continue;
    if (matched) return null;
    matched = true;
    const storedPlugin = await repository.get('plugins', account.pluginId);
    const plugin = storedPlugin ? await decryptSecrets(storedPlugin as JsonObject, bindings) : null;
    resolved = toQQAccountContext(account, plugin);
  }
  return resolved;
}

export async function resolveQQAccountById(accountId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  const repository = createRepository(bindings);
  const stored = await repository.get('accounts', accountId);
  if (!stored || stored.protocol !== 'qq') return null;
  const account = await decryptSecrets(stored as JsonObject, bindings) as unknown as BotAccountRecord;
  const storedPlugin = await repository.get('plugins', account.pluginId);
  const plugin = storedPlugin ? await decryptSecrets(storedPlugin as JsonObject, bindings) : null;
  return toQQAccountContext(account, plugin);
}

function toQQAccountContext(
  account: BotAccountRecord,
  plugin: JsonObject | null,
): QQAccountContext | null {
  const credentials = account.credentials ?? {};
  const appId = credentials.appId;
  const secrets = [credentials.appSecret, credentials.botSecret, credentials.clientSecret]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const appSecret = secrets[0];
  if (
    typeof appId !== 'string' || !appId || appId.length > 64 ||
    !appSecret || appSecret.length > 4096 || secrets.some((value) => value !== appSecret) ||
    !plugin ||
    plugin.type !== CHATBOT_PLUGIN_TYPE
  ) {
    return null;
  }
  return {
    account,
    appId,
    appSecret,
    pluginEnabled: plugin.enabled === true,
    pluginConfig: plugin.config as JsonObject | undefined,
  };
}
