import { LOG_RETENTION_DAYS } from '../../shared/types';
import type { ConversationLog, D1DatabaseLike, JsonObject, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import type { EdgeOneBlobStoreLike } from './edgeone-blob-repository';

export interface ConversationLogFilter {
  accountId?: string;
  groupId?: string;
  pluginId?: string;
  pluginType?: string;
  openid?: string;
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
  plugin_id?: string | null;
  plugin_type?: string | null;
  event_id?: string | null;
  status?: string | null;
  details?: string | null;
}

function redactText(value: string, limit = 4096): string {
  if (/^[a-z0-9+/]{256,}={0,2}$/i.test(value)) return '[REDACTED_MEDIA]';
  return value.slice(0, limit)
    .replace(/data:[^\s,;]*;base64,[a-z0-9+/=\s]+/gi, '[REDACTED_MEDIA]')
    .replace(/\b(?:Bearer|QQBot)\s+[^\s"']+/gi, '[REDACTED]')
    .replace(/((?:["']?(?:[a-z_]*(?:secret|token|password)|api[_-]?key|authorization)["']?)\s*[:=]\s*)["']?[^\s,"'&}]+/gi, '$1[REDACTED]');
}

export function sanitizeLogDetails(value: unknown): JsonObject {
  let remaining = 16_384;
  let nodes = 0;
  const seen = new WeakSet<object>();
  function visit(input: unknown, depth: number): unknown {
    if (++nodes > 200 || remaining <= 0 || depth > 6) return '[TRUNCATED]';
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'string') {
      const text = redactText(input, Math.min(2048, remaining));
      remaining -= text.length;
      return text;
    }
    if (typeof input !== 'object') return null;
    if (seen.has(input)) return '[CIRCULAR]';
    seen.add(input);
    if (Array.isArray(input)) return input.slice(0, 50).map((item) => visit(item, depth + 1));
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(input).slice(0, 50)) {
      if (remaining <= 0 || nodes > 200) break;
      const safeKey = key.slice(0, 128);
      if (safeKey === '__proto__' || safeKey === 'constructor' || safeKey === 'prototype') continue;
      remaining -= safeKey.length;
      const tokenCount = typeof item === 'number' && Number.isFinite(item) && /^(?:(?:cached_)?(?:prompt|completion|input|output|total)_tokens|cached_tokens|(?:cachedPrompt|cachedInput|prompt|completion|input|output|total)Tokens|max(?:Output)?Tokens|tokens)$/i.test(key);
      output[safeKey] = /secret|token|password|authorization|api[_-]?key|base64|file_data/i.test(key) && !tokenCount
        ? '[REDACTED]' : visit(item, depth + 1);
    }
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return visit(value, 0) as JsonObject;
}

export function sanitizeConversationLog(log: ConversationLog): ConversationLog {
  return {
    id: log.id.slice(0, 512), accountId: log.accountId.slice(0, 512),
    groupId: log.groupId.slice(0, 512), groupExternalId: (log.groupExternalId ?? '').slice(0, 512),
    userId: log.userId.slice(0, 512), direction: log.direction,
    createdAt: log.createdAt, expiresAt: log.expiresAt,
    content: redactText(log.content, 65_536),
    ...(log.pluginId ? { pluginId: log.pluginId.slice(0, 256) } : {}),
    ...(log.pluginType ? { pluginType: log.pluginType.slice(0, 256) } : {}),
    ...(log.eventId ? { eventId: log.eventId.slice(0, 512) } : {}),
    ...(log.status ? { status: log.status.slice(0, 100) } : {}),
    ...(log.details ? { details: sanitizeLogDetails(log.details) } : {}),
  };
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
  return sanitizeConversationLog({ ...log, expiresAt });
}

function afterFilters(log: ConversationLog, filter: ConversationLogFilter, now: number): boolean {
  if (log.expiresAt <= now) return false;
  if (filter.accountId !== undefined && log.accountId !== filter.accountId) return false;
  if (filter.groupId !== undefined && log.groupId !== filter.groupId) return false;
  if (filter.pluginId !== undefined && log.pluginId !== filter.pluginId) return false;
  if (filter.pluginType !== undefined && log.pluginType !== filter.pluginType) return false;
  if (filter.from !== undefined && log.createdAt < filter.from) return false;
  if (filter.to !== undefined && log.createdAt > filter.to) return false;
  if (filter.q && !`${log.content}\n${log.userId}\n${log.groupExternalId}\n${log.eventId ?? ''}\n${JSON.stringify(log.details ?? {})}`.toLowerCase().includes(filter.q.toLowerCase())) return false;
  if (filter.openid && !`${log.userId}\n${log.groupExternalId}\n${JSON.stringify(log.details ?? {})}`.toLowerCase().includes(filter.openid.toLowerCase())) return false;
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
  let details: JsonObject | undefined;
  if (row.details) {
    try { details = sanitizeLogDetails(JSON.parse(row.details)); } catch { details = {}; }
  }
  return sanitizeConversationLog({
    id: row.id,
    accountId: row.account_id,
    groupId: row.group_id,
    groupExternalId: row.group_external_id,
    userId: row.user_id,
    direction: row.direction,
    content: row.content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
    ...(row.plugin_type ? { pluginType: row.plugin_type } : {}),
    ...(row.event_id ? { eventId: row.event_id } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(details ? { details } : {}),
  });
}

const LOG_SIDECAR_KIND = 'conversation-log-metadata-v1';
const LOG_METADATA_COLUMNS = { plugin_id: 'pluginId', plugin_type: 'pluginType', event_id: 'eventId', status: 'status', details: 'details' } as const;

function insertStatement(db: D1DatabaseLike, log: ConversationLog, extended = true) {
  const columns = ['id', 'account_id', 'group_id', 'group_external_id', 'user_id', 'direction', 'content', 'created_at', 'expires_at'];
  const values: unknown[] = [log.id, log.accountId, log.groupId, log.groupExternalId, log.userId, log.direction, log.content, log.createdAt, log.expiresAt];
  if (extended) {
    columns.push(...Object.keys(LOG_METADATA_COLUMNS));
    values.push(log.pluginId ?? null, log.pluginType ?? null, log.eventId ?? null, log.status ?? null, log.details ? JSON.stringify(log.details) : null);
  }
  return db.prepare(`INSERT INTO conversation_logs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map((column) => `${column} = excluded.${column}`).join(', ')}`)
    .bind(...values);
}

export class D1ConversationLogRepository implements ConversationLogRepository {
  readonly consistency = 'eventual' as const;
  private schema?: Promise<{ columns: Set<string>; sidecar: boolean; extended: boolean }>;

  constructor(private readonly db: D1DatabaseLike) {}

  private storageSchema() {
    if (!this.schema) this.schema = Promise.all([
      this.db.prepare('PRAGMA table_info(conversation_logs)').all<{ name: string }>(),
      this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'records'").first<{ name: string }>(),
    ]).then(([result, records]) => {
      const columns = new Set((result.results ?? []).map((column) => column.name));
      return { columns, sidecar: Boolean(records), extended: Object.keys(LOG_METADATA_COLUMNS).every((column) => columns.has(column)) };
    });
    return this.schema;
  }

  async append(entries: ConversationLog[]): Promise<void> {
    const now = Date.now();
    const schema = await this.storageSchema();
    const statements = entries.flatMap((entry) => {
      const log = withRetention(entry, now);
      if (!log) return [];
      const statements = [insertStatement(this.db, log, schema.extended)];
      if (schema.extended && schema.sidecar) statements.push(this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').bind(LOG_SIDECAR_KIND, log.id));
      if (!schema.extended) {
        const metadata = { pluginId: log.pluginId, pluginType: log.pluginType, eventId: log.eventId, status: log.status, details: log.details };
        if (Object.values(metadata).some((value) => value !== undefined)) {
          if (!schema.sidecar) throw new Error('Plugin log metadata requires the records table or migration 0004.');
          statements.push(this.db.prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
            .bind(LOG_SIDECAR_KIND, log.id, JSON.stringify(metadata), new Date(log.expiresAt).toISOString()));
        } else if (schema.sidecar) statements.push(this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').bind(LOG_SIDECAR_KIND, log.id));
      }
      return statements;
    });
    if (!statements.length) return;
    if (this.db.batch) await this.db.batch(statements);
    else for (const statement of statements) await statement.run();
  }

  async list(filter: ConversationLogFilter): Promise<ConversationLogPage> {
    const schema = await this.storageSchema();
    const expressions = Object.fromEntries(Object.entries(LOG_METADATA_COLUMNS).map(([column, property]) => {
      const persisted = schema.sidecar ? `json_extract(meta.value, '$.${property}')` : 'NULL';
      return [column, schema.columns.has(column) ? schema.sidecar ? `COALESCE(l.${column}, ${persisted})` : `l.${column}` : persisted];
    })) as Record<keyof typeof LOG_METADATA_COLUMNS, string>;
    const source = `conversation_logs l${schema.sidecar ? ` LEFT JOIN records meta ON meta.kind = '${LOG_SIDECAR_KIND}' AND meta.id = l.id` : ''}`;
    const clauses = ['l.expires_at > ?'];
    const values: unknown[] = [Date.now()];
    if (filter.accountId !== undefined) { clauses.push('l.account_id = ?'); values.push(filter.accountId); }
    if (filter.groupId !== undefined) { clauses.push('l.group_id = ?'); values.push(filter.groupId); }
    if (filter.pluginId !== undefined) { clauses.push(`${expressions.plugin_id} = ?`); values.push(filter.pluginId); }
    if (filter.pluginType !== undefined) { clauses.push(`${expressions.plugin_type} = ?`); values.push(filter.pluginType); }
    if (filter.from !== undefined) { clauses.push('l.created_at >= ?'); values.push(filter.from); }
    if (filter.to !== undefined) { clauses.push('l.created_at <= ?'); values.push(filter.to); }
    if (filter.q) {
      const columns = ['l.content', 'l.user_id', 'l.group_external_id', expressions.event_id, expressions.details];
      clauses.push(`(${columns.map((column) => `instr(lower(${column}), lower(?)) > 0`).join(' OR ')})`);
      values.push(...columns.map(() => filter.q));
    }
    if (filter.openid) {
      const columns = ['l.user_id', 'l.group_external_id', expressions.details];
      clauses.push(`(${columns.map((column) => `instr(lower(${column}), lower(?)) > 0`).join(' OR ')})`);
      values.push(...columns.map(() => filter.openid));
    }
    const where = clauses.join(' AND ');
    const count = await this.db.prepare(`SELECT COUNT(*) AS total FROM ${source} WHERE ${where}`).bind(...values).first<{ total: number }>();
    const limit = normalizeLimit(filter.limit);
    const pageValues = [...values];
    let cursorClause = '';
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      cursorClause = ' AND (l.created_at < ? OR (l.created_at = ? AND l.id < ?))';
      pageValues.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    pageValues.push(limit + 1);
    let offsetClause = '';
    if (!filter.cursor) {
      offsetClause = ' OFFSET ?';
      pageValues.push(normalizeOffset(filter.offset));
    }
    const metadataColumns = Object.entries(expressions).map(([column, expression]) => `${expression} AS ${column}`).join(', ');
    const result = await this.db.prepare(
      `SELECT l.id, l.account_id, l.group_id, l.group_external_id, l.user_id, l.direction, l.content, l.created_at, l.expires_at, ${metadataColumns} FROM ${source} WHERE ${where}${cursorClause} ORDER BY l.created_at DESC, l.id DESC LIMIT ?${offsetClause}`,
    ).bind(...pageValues).all<ConversationLogRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(fromRow);
    const last = items[items.length - 1];
    return { items, total: count?.total ?? 0, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
  }

  async purgeExpired(now: number): Promise<number> {
    const result = await this.db.prepare('DELETE FROM conversation_logs WHERE expires_at <= ?').bind(now).run() as { meta?: { changes?: number } };
    if ((await this.storageSchema()).sidecar) await this.db.prepare('DELETE FROM records WHERE kind = ? AND updated_at <= ?').bind(LOG_SIDECAR_KIND, new Date(now).toISOString()).run();
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
    const items = records.map((item) => sanitizeConversationLog(item.log)).filter((log) => afterFilters(log, filter, now)).sort(compareLogs);
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
    const items = records.map((item) => sanitizeConversationLog(item.log)).filter((log) => afterFilters(log, filter, now)).sort(compareLogs);
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
