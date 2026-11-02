import { Hono } from 'hono';
import type { ConversationLog, RuntimeBindings } from '../../shared/types';
import { readBoolean } from '../env';
import { createConversationLogRepository } from '../storage/conversation-log-repository';
import { ApiError } from './management';

function integerParameter(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ApiError(400, 'invalid_pagination');
  return parsed;
}

function timestampParameter(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ApiError(400, `invalid_${name}`);
  return parsed;
}

export function logFields(items: ConversationLog[]) {
  const fields = ['createdAt', 'pluginId', 'pluginType', 'accountId', 'groupId', 'groupExternalId', 'userId', 'direction', 'eventId', 'status', 'content', 'details']
    .map((key) => ({ key, label: key, type: key === 'details' ? 'json' : key === 'createdAt' ? 'timestamp' : 'text' }));
  const details = new Set(items.flatMap((item) => Object.keys(item.details ?? {})));
  for (const key of [...details].slice(0, 50)) fields.push({ key: `details.${key}`, label: key, type: 'json' });
  return fields;
}

export function registerLogRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/logs', async (context) => {
    if (!readBoolean(context.env.LOG_RECORD)) return context.json({ enabled: false, items: [], total: 0, fields: logFields([]) });

    const query = context.req.query();
    const page = integerParameter(query.page, 1, 1, 1_000_000);
    const pageSize = integerParameter(query.pageSize, 20, 1, 100);
    const q = query.q?.trim();
    if (q && q.length > 200) throw new ApiError(400, 'invalid_q');
    const openid = query.openid?.trim();
    if (openid && openid.length > 512) throw new ApiError(400, 'invalid_openid');

    try {
      const repository = createConversationLogRepository(context.env);
      const result = await repository.list({
        accountId: query.accountId,
        groupId: query.groupId,
        pluginId: query.pluginId,
        pluginType: query.pluginType,
        openid,
        from: timestampParameter(query.from, 'from'),
        to: timestampParameter(query.to, 'to'),
        q,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      context.header('X-Storage-Consistency', repository.consistency);
      return context.json({ enabled: true, items: result.items, total: result.total, fields: logFields(result.items) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'storage_unavailable');
    }
  });
}
