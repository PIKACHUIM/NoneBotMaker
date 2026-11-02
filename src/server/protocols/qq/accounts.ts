import { CHATBOT_PLUGIN_TYPE, type JsonObject, type RuntimeBindings } from '../../../shared/types';
import type { BotAccountRecord } from '../../../shared/types';
import { createRepository } from '../../storage/repository';
import { decryptSecrets } from '../../storage/secrets';
import type { QQAccountContext } from './types';

export async function resolveQQAccountByAppId(appId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  const repository = createRepository(bindings);
  const accounts = await repository.list('accounts');
  let resolved: QQAccountContext | null = null;
  for (const stored of accounts) {
    if (stored.protocol !== 'qq') continue;
    const credentials = stored.credentials as JsonObject | undefined;
    if (credentials?.appId !== appId) continue;
    const account = await decryptSecrets(stored as JsonObject, bindings) as unknown as BotAccountRecord;
    const plugin = await repository.get('plugins', account.pluginId);
    if (resolved) return null;
    resolved = toQQAccountContext(account, plugin);
  }
  return resolved;
}

export async function resolveQQAccountById(accountId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  const repository = createRepository(bindings);
  const stored = await repository.get('accounts', accountId);
  if (!stored || stored.protocol !== 'qq') return null;
  const account = await decryptSecrets(stored as JsonObject, bindings) as unknown as BotAccountRecord;
  const plugin = await repository.get('plugins', account.pluginId);
  return toQQAccountContext(account, plugin);
}

function toQQAccountContext(
  account: BotAccountRecord,
  plugin: JsonObject | null,
): QQAccountContext | null {
  const appId = account.credentials.appId;
  const botSecret = account.credentials.botSecret;
  const clientSecret = account.credentials.clientSecret;
  if (
    typeof appId !== 'string' ||
    typeof botSecret !== 'string' ||
    typeof clientSecret !== 'string' ||
    !plugin ||
    plugin.type !== CHATBOT_PLUGIN_TYPE
  ) {
    return null;
  }
  return {
    account,
    appId,
    botSecret,
    clientSecret,
    pluginEnabled: plugin.enabled === true,
  };
}
