import { CHATBOT_PLUGIN_TYPE, type BotAccountRecord, type JsonObject, type RuntimeBindings } from '../../shared/types';
import { chatProtocolDefinition, normalizeFieldValues, pluginDefinition } from '../../shared/plugin-catalog';
import { createRepository, type RecordRepository } from '../storage/repository';
import { decryptSecrets } from '../storage/secrets';
import type { ChatAccountContext } from './types';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Builds the runtime account context for any supported protocol.
 * Credentials are normalized against the protocol's field list so a record
 * saved as QQ keeps only appId/appSecret even when other protocols exist.
 */
export function toChatAccountContext(account: BotAccountRecord, plugin: JsonObject | null): ChatAccountContext | null {
  if (!plugin || plugin.type !== CHATBOT_PLUGIN_TYPE) return null;
  const definition = pluginDefinition(CHATBOT_PLUGIN_TYPE);
  const protocol = chatProtocolDefinition(account.protocol, CHATBOT_PLUGIN_TYPE);
  if (!definition || !protocol) return null;

  const stored = account.credentials ?? {};
  const credentials: JsonObject = { ...stored };
  if (protocol.id === 'qq') {
    const explicit = stringValue(stored.appSecret);
    const botSecret = stringValue(stored.botSecret);
    const clientSecret = stringValue(stored.clientSecret);
    const canonical = explicit || botSecret || clientSecret;
    if (!explicit && botSecret && clientSecret && botSecret !== clientSecret) return null;
    credentials.appSecret = canonical;
    delete credentials.botSecret;
    delete credentials.clientSecret;
  }

  const normalized = normalizeFieldValues(protocol.credentialFields, credentials);
  if (protocol.id === 'telegram' && !stringValue(normalized.botId).trim()) {
    const prefix = stringValue(normalized.botToken).split(':')[0];
    if (/^\d{3,20}$/.test(prefix)) normalized.botId = prefix;
  }
  if (protocol.id === 'onebot') {
    try {
      const url = new URL(stringValue(normalized.apiBaseUrl));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    } catch {
      return null;
    }
  }
  if (protocol.id === 'mattermost') {
    if (!stringValue(normalized.baseUrl)) return null;
    try {
      const url = new URL(stringValue(normalized.baseUrl));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    } catch {
      return null;
    }
  }
  const appId = stringValue(normalized[protocol.identifierField]).trim();
  const secretField = protocol.secretField ?? 'appSecret';
  const appSecret = stringValue(normalized[secretField]) || undefined;
  if (!appId || appId.length > 256 || (!appSecret && protocol.requiresSecret !== false) || (appSecret && appSecret.length > 4096)) return null;

  return {
    account,
    protocol: protocol.id,
    credentials: normalized,
    appId,
    appSecret,
    pluginEnabled: plugin.enabled === true,
    pluginConfig: normalizeFieldValues(definition.configFields, plugin.config as JsonObject | undefined),
  };
}

async function storedAccountContext(
  repository: RecordRepository,
  stored: Record<string, unknown>,
  bindings: RuntimeBindings,
): Promise<ChatAccountContext | null> {
  const account = await decryptSecrets(stored as JsonObject, bindings) as unknown as BotAccountRecord;
  const storedPlugin = account.pluginId ? await repository.get('plugins', account.pluginId) : null;
  const plugin = storedPlugin ? await decryptSecrets(storedPlugin as JsonObject, bindings) : null;
  return toChatAccountContext(account, plugin);
}

export async function resolveChatAccountById(accountId: string, bindings: RuntimeBindings): Promise<ChatAccountContext | null> {
  const repository = createRepository(bindings);
  const stored = await repository.get('accounts', accountId);
  return stored ? storedAccountContext(repository, stored, bindings) : null;
}

/**
 * Finds the single account whose protocol identifier matches. Duplicate
 * identifiers are ambiguous and therefore rejected instead of picking one.
 */
export async function resolveChatAccountByCredential(
  protocol: string,
  value: string,
  bindings: RuntimeBindings,
): Promise<ChatAccountContext | null> {
  const repository = createRepository(bindings);
  const protocolDefinition = chatProtocolDefinition(protocol);
  if (!protocolDefinition) return null;
  const accounts = await repository.list('accounts');
  let resolved: ChatAccountContext | null = null;
  for (const stored of accounts) {
    if (stored.protocol !== protocol) continue;
    const context = await storedAccountContext(repository, stored, bindings);
    if (!context) continue;
    if (stringValue(context.credentials[protocolDefinition.identifierField]).trim() !== value) continue;
    if (resolved) return null;
    resolved = context;
  }
  return resolved;
}

/** All usable accounts for a protocol, used when a callback carries no identifier. */
export async function listChatAccounts(protocol: string, bindings: RuntimeBindings): Promise<ChatAccountContext[]> {
  const repository = createRepository(bindings);
  const accounts = await repository.list('accounts');
  const contexts: ChatAccountContext[] = [];
  for (const stored of accounts) {
    if (stored.protocol !== protocol) continue;
    const context = await storedAccountContext(repository, stored, bindings);
    if (context) contexts.push(context);
  }
  return contexts;
}
