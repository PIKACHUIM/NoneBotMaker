import { Hono } from 'hono';
import type { ConversationLog, JsonObject, RuntimeBindings } from '../../shared/types';
import { readBoolean } from '../env';
import { createConversationLogRepository } from '../storage/conversation-log-repository';
import { ApiError } from './management';

interface MergedTurn {
  base: ConversationLog;
  inputs: string[];
  replies: string[];
  errors: string[];
  details: JsonObject;
  status?: string;
}

function turnKey(row: ConversationLog): string {
  // 同一事件的收发共享 eventId；没有 eventId 时按会话和5分钟窗口归并。
  if (row.eventId) return `event:${row.accountId}:${row.eventId}`;
  return `window:${row.accountId}:${row.groupId}:${row.userId}:${Math.floor(row.createdAt / 300_000)}`;
}

/** 把同一轮对话的接收、处理状态与发送内容合并为一条记录。 */
export function mergeConversationTurns(items: ConversationLog[]): ConversationLog[] {
  const turns = new Map<string, MergedTurn>();
  for (const row of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = turnKey(row);
    let turn = turns.get(key);
    if (!turn) {
      turn = { base: row, inputs: [], replies: [], errors: [], details: { ...(row.details ?? {}) } };
      turns.set(key, turn);
    } else {
      turn.details = { ...turn.details, ...(row.details ?? {}) };
    }
    if (row.direction === 'in') {
      if (row.content) turn.inputs.push(row.content);
      continue;
    }
    if (row.content) turn.replies.push(row.content);
    if (row.status) turn.status = row.status;
    if (row.status === 'error' || row.status === 'failed') {
      const error = row.details?.error;
      turn.errors.push(typeof error === 'string' && error ? error : '发送失败');
    }
  }
  return [...turns.values()]
    .map((turn) => ({
      ...turn.base,
      content: turn.inputs.length ? turn.inputs.join('\n') : turn.base.content,
      status: turn.errors.length ? 'error' : turn.replies.length ? 'sent' : turn.status ?? turn.base.status ?? 'received',
      details: {
        ...turn.details,
        ...(turn.replies.length ? { reply: turn.replies.join('\n') } : {}),
        ...(turn.errors.length ? { error: turn.errors.join('\n') } : {}),
      },
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

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
      const items = mergeConversationTurns(result.items);
      return context.json({ enabled: true, items, total: result.total, fields: logFields(items) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'storage_unavailable');
    }
  });
}
