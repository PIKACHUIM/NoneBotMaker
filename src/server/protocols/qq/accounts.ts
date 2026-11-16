import type { RuntimeBindings } from '../../../shared/types';
import { resolveChatAccountByCredential, resolveChatAccountById } from '../accounts';
import type { QQAccountContext } from './types';

export async function resolveQQAccountByAppId(appId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  return resolveChatAccountByCredential('qq', appId, bindings);
}

export async function resolveQQAccountById(accountId: string, bindings: RuntimeBindings): Promise<QQAccountContext | null> {
  const account = await resolveChatAccountById(accountId, bindings);
  return account?.protocol === 'qq' ? account : null;
}
