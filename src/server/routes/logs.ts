import { Hono } from 'hono';
import type { RuntimeBindings } from '../../shared/types';
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

export function registerLogRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/logs', async (context) => {
    if (!readBoolean(context.env.LOG_RECORD)) return context.json({ enabled: false, items: [], total: 0 });

    const query = context.req.query();
    const page = integerParameter(query.page, 1, 1, 1_000_000);
    const pageSize = integerParameter(query.pageSize, 20, 1, 100);
    const q = query.q?.trim();
    if (q && q.length > 200) throw new ApiError(400, 'invalid_q');

    try {
      const repository = createConversationLogRepository(context.env);
      const result = await repository.list({
        accountId: query.accountId,
        groupId: query.groupId,
        from: timestampParameter(query.from, 'from'),
        to: timestampParameter(query.to, 'to'),
        q,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      context.header('X-Storage-Consistency', repository.consistency);
      return context.json({ enabled: true, items: result.items, total: result.total });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'storage_unavailable');
    }
  });
}
