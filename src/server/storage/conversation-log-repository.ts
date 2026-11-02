import { LOG_RETENTION_DAYS } from '../../shared/types';
import type { ConversationLog, D1DatabaseLike, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import type { EdgeOneBlobStoreLike } from './edgeone-blob-repository';

export interface ConversationLogFilter {
  accountId?: string;
  groupId?: string;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
  offset?: number;
  q?: string;
}

export interface ConversationLogPage {
  items: ConversationLog[];
  total: number;
  nextCursor: string | null;
}

export interface ConversationLogRepository {
  readonly consistency: 'eventual' | 'provider-defined';
  append(entries: ConversationLog[]): Promise<void>;
  list(filter: ConversationLogFilter): Promise<ConversationLogPage>;
  purgeExpired(now: number): Promise<number>;
}

const KV_PREFIX = 'nonebotmaker:conversation_logs:';
const BLOB_PREFIX = 'nonebotmaker/conversation_logs/';
const MAX_PAGE_SIZE = 1000;
const RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

interface Cursor {
  createdAt: number;
  id: string;
}

interface ConversationLogRow {
  id: string;
  account_id: string;
  group_id: string;
  group_external_id: string;
  user_id: string;
  direction: 'in' | 'out';
  content: string;
  created_at: number;
  expires_at: number;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string): Cursor {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Partial<Cursor>;
  if (!Number.isFinite(decoded.createdAt) || typeof decoded.id !== 'string') throw new TypeError('Invalid conversation log cursor.');
  return { createdAt: decoded.createdAt as number, id: decoded.id };
}

function withRetention(log: ConversationLog, now: number): ConversationLog | null {
  const expiresAt = Math.min(log.expiresAt, log.createdAt + RETENTION_MS);
  if (expiresAt <= now) return null;
  return { ...log, expiresAt };
}

function afterFilters(log: ConversationLog, filter: ConversationLogFilter, now: number): boolean {
  if (log.expiresAt <= now) return false;
  if (filter.accountId !== undefined && log.accountId !== filter.accountId) return false;
  if (filter.groupId !== undefined && log.groupId !== filter.groupId) return false;
  if (filter.from !== undefined && log.createdAt < filter.from) return false;
  if (filter.to !== undefined && log.createdAt > filter.to) return false;
  if (filter.q && !`${log.content}\n${log.userId}\n${log.groupExternalId}`.toLowerCase().includes(filter.q.toLowerCase())) return false;
  return true;
}

function compareLogs(a: ConversationLog, b: ConversationLog): number {
  return b.createdAt - a.createdAt || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
}

function pageFromItems(items: ConversationLog[], total: number, filter: ConversationLogFilter): ConversationLogPage {
  const limit = normalizeLimit(filter.limit);
  const offset = normalizeOffset(filter.offset);
  let start = offset;
  if (filter.cursor) {
    const cursor = decodeCursor(filter.cursor);
    start = items.findIndex((item) => item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id));
    if (start < 0) start = items.length;
  }
  const selected = items.slice(start, start + limit);
  const hasMore = start + selected.length < items.length;
  const last = selected[selected.length - 1];
  return {
    items: selected,
    total,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

function fromRow(row: ConversationLogRow): ConversationLog {
  return {
    id: row.id,
    accountId: row.account_id,
    groupId: row.group_id,
    groupExternalId: row.group_external_id,
    userId: row.user_id,
    direction: row.direction,
    content: row.content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function insertStatement(db: D1DatabaseLike, log: ConversationLog) {
  return db.prepare(
    'INSERT INTO conversation_logs (id, account_id, group_id, group_external_id, user_id, direction, content, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, group_id = excluded.group_id, group_external_id = excluded.group_external_id, user_id = excluded.user_id, direction = excluded.direction, content = excluded.content, created_at = excluded.created_at, expires_at = excluded.expires_at',
  ).bind(log.id, log.accountId, log.groupId, log.groupExternalId, log.userId, log.direction, log.content, log.createdAt, log.expiresAt);
}

export class D1ConversationLogRepository implements ConversationLogRepository {
  readonly consistency = 'eventual' as const;

  constructor(private readonly db: D1DatabaseLike) {}

  async append(entries: ConversationLog[]): Promise<void> {
    const now = Date.now();
    const statements = entries.flatMap((entry) => {
      const log = withRetention(entry, now);
      return log ? [insertStatement(this.db, log)] : [];
    });
    if (statements.length === 0) return;
    if (this.db.batch) await this.db.batch(statements);
    else await Promise.all(statements.map((statement) => statement.run()));
  }

  async list(filter: ConversationLogFilter): Promise<ConversationLogPage> {
    const clauses = ['expires_at > ?'];
    const values: unknown[] = [Date.now()];
    if (filter.accountId !== undefined) { clauses.push('account_id = ?'); values.push(filter.accountId); }
    if (filter.groupId !== undefined) { clauses.push('group_id = ?'); values.push(filter.groupId); }
    if (filter.from !== undefined) { clauses.push('created_at >= ?'); values.push(filter.from); }
    if (filter.to !== undefined) { clauses.push('created_at <= ?'); values.push(filter.to); }
    if (filter.q) {
      clauses.push('(instr(lower(content), lower(?)) > 0 OR instr(lower(user_id), lower(?)) > 0 OR instr(lower(group_external_id), lower(?)) > 0)');
      values.push(filter.q, filter.q, filter.q);
    }
    const where = clauses.join(' AND ');
    const count = await this.db.prepare(`SELECT COUNT(*) AS total FROM conversation_logs WHERE ${where}`).bind(...values).first<{ total: number }>();
    const limit = normalizeLimit(filter.limit);
    const pageValues = [...values];
    let cursorClause = '';
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      pageValues.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    pageValues.push(limit + 1);
    let offsetClause = '';
    if (!filter.cursor) {
      offsetClause = ' OFFSET ?';
      pageValues.push(normalizeOffset(filter.offset));
    }
    const result = await this.db.prepare(
      `SELECT id, account_id, group_id, group_external_id, user_id, direction, content, created_at, expires_at FROM conversation_logs WHERE ${where}${cursorClause} ORDER BY created_at DESC, id DESC LIMIT ?${offsetClause}`,
    ).bind(...pageValues).all<ConversationLogRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(fromRow);
    const last = items[items.length - 1];
    return {
      items,
      total: count?.total ?? 0,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async purgeExpired(now: number): Promise<number> {
    const result = await this.db.prepare('DELETE FROM conversation_logs WHERE expires_at <= ?').bind(now).run() as { meta?: { changes?: number } };
    return result.meta?.changes ?? 0;
  }
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function kvLogKey(log: ConversationLog): string {
  return `${KV_PREFIX}${encoded(log.accountId)}:${encoded(log.groupId)}:${log.createdAt}:${encoded(log.id)}`;
}

function blobLogKey(log: ConversationLog): string {
  return `${BLOB_PREFIX}${encoded(log.accountId)}/${encoded(log.groupId)}/${log.createdAt}/${encoded(log.id)}`;
}

function kvPrefix(filter: ConversationLogFilter): string {
  if (filter.accountId !== undefined && filter.groupId !== undefined) return `${KV_PREFIX}${encoded(filter.accountId)}:${encoded(filter.groupId)}:`;
  if (filter.accountId !== undefined) return `${KV_PREFIX}${encoded(filter.accountId)}:`;
  return KV_PREFIX;
}

function blobPrefix(filter: ConversationLogFilter): string {
  if (filter.accountId !== undefined && filter.groupId !== undefined) return `${BLOB_PREFIX}${encoded(filter.accountId)}/${encoded(filter.groupId)}/`;
  if (filter.accountId !== undefined) return `${BLOB_PREFIX}${encoded(filter.accountId)}/`;
  return BLOB_PREFIX;
}

async function listKvRecords(kv: KVNamespaceLike, prefix: string): Promise<Array<{ key: string; log: ConversationLog }>> {
  if (!kv.list) throw new Error('The configured KV adapter does not support listing keys.');
  const records: Array<{ key: string; log: ConversationLog }> = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, limit: 1000, cursor });
    const values = await Promise.all(page.keys.map(async ({ name }) => {
      const value = await kv.get(name);
      return value ? { key: name, log: JSON.parse(value) as ConversationLog } : null;
    }));
    records.push(...values.filter((item): item is { key: string; log: ConversationLog } => item !== null));
    cursor = page.list_complete ? undefined : page.cursor;
    if (!page.list_complete && !cursor) throw new Error('The configured KV adapter returned an incomplete page without a cursor.');
  } while (cursor);
  return records;
}

export class KVConversationLogRepository implements ConversationLogRepository {
  readonly consistency = 'eventual' as const;

  constructor(protected readonly kv: KVNamespaceLike) {}

  async append(entries: ConversationLog[]): Promise<void> {
    const now = Date.now();
    await Promise.all(entries.flatMap((entry) => {
      const log = withRetention(entry, now);
      if (!log) return [];
      const expirationTtl = Math.max(60, Math.ceil((log.expiresAt - now) / 1000));
      return [this.kv.put(kvLogKey(log), JSON.stringify(log), { expirationTtl })];
    }));
  }

  async list(filter: ConversationLogFilter): Promise<ConversationLogPage> {
    const now = Date.now();
    const records = await listKvRecords(this.kv, kvPrefix(filter));
    const items = records.map((item) => item.log).filter((log) => afterFilters(log, filter, now)).sort(compareLogs);
    return pageFromItems(items, items.length, filter);
  }

  async purgeExpired(now: number): Promise<number> {
    const records = await listKvRecords(this.kv, KV_PREFIX);
    const expired = records.filter(({ log }) => log.expiresAt <= now);
    await Promise.all(expired.map(({ key }) => this.kv.delete(key)));
    return expired.length;
  }
}

export class EdgeOneKVConversationLogRepository extends KVConversationLogRepository {
  constructor(kv: KVNamespaceLike) { super(kv); }
}

export class EsaKVConversationLogRepository extends KVConversationLogRepository {
  constructor(kv: KVNamespaceLike) { super(kv); }
}

async function listBlobRecords(blob: EdgeOneBlobStoreLike, prefix: string): Promise<Array<{ key: string; log: ConversationLog }>> {
  const records: Array<{ key: string; log: ConversationLog }> = [];
  let cursor: string | undefined;
  do {
    const page = await blob.list({ prefix, limit: 1000, cursor });
    const values = await Promise.all(page.objects.map(async ({ key }) => {
      const value = await blob.get(key);
      if (value === null) return null;
      const text = typeof value === 'string' ? value : await value.text();
      return { key, log: JSON.parse(text) as ConversationLog };
    }));
    records.push(...values.filter((item): item is { key: string; log: ConversationLog } => item !== null));
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) throw new Error('The configured blob adapter returned a truncated page without a cursor.');
  } while (cursor);
  return records;
}

export class EdgeOneBlobConversationLogRepository implements ConversationLogRepository {
  readonly consistency = 'provider-defined' as const;

  constructor(private readonly blob: EdgeOneBlobStoreLike) {}

  async append(entries: ConversationLog[]): Promise<void> {
    const now = Date.now();
    await Promise.all(entries.flatMap((entry) => {
      const log = withRetention(entry, now);
      return log ? [this.blob.put(blobLogKey(log), JSON.stringify(log))] : [];
    }));
  }

  async list(filter: ConversationLogFilter): Promise<ConversationLogPage> {
    const now = Date.now();
    const records = await listBlobRecords(this.blob, blobPrefix(filter));
    const items = records.map((item) => item.log).filter((log) => afterFilters(log, filter, now)).sort(compareLogs);
    return pageFromItems(items, items.length, filter);
  }

  async purgeExpired(now: number): Promise<number> {
    const records = await listBlobRecords(this.blob, BLOB_PREFIX);
    const expired = records.filter(({ log }) => log.expiresAt <= now);
    await Promise.all(expired.map(({ key }) => this.blob.delete(key)));
    return expired.length;
  }
}

export function createConversationLogRepository(bindings: RuntimeBindings): ConversationLogRepository {
  if (bindings.DB) return new D1ConversationLogRepository(bindings.DB);
  if (bindings.PLATFORM === 'edgeone') {
    const blob = bindings.EDGEONE_BLOB as EdgeOneBlobStoreLike | undefined;
    if (blob) return new EdgeOneBlobConversationLogRepository(blob);
    if (bindings.EDGEONE_KV) return new EdgeOneKVConversationLogRepository(bindings.EDGEONE_KV);
  }
  if (bindings.PLATFORM === 'esa') {
    const kv = bindings.ESA_KV ?? bindings.KV;
    if (kv) return new EsaKVConversationLogRepository(kv);
  }
  if (bindings.KV) return new KVConversationLogRepository(bindings.KV);
  throw new Error('Persistent conversation log storage is not configured.');
}
