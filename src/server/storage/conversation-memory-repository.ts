import type { ConversationType, D1DatabaseLike, MemoryType, RuntimeBindings } from '../../shared/types';
import { StorageUnavailableError } from './repository';
import { KNOWLEDGE_LIMITS } from '../plugins/chatbot/knowledge';

export interface ConversationMemoryScope {
  accountId: string;
  groupId: string;
  conversationType: ConversationType;
  externalId: string;
}

export interface ConversationMemory {
  id: string;
  name: string;
  title: string;
  description: string;
  type: MemoryType;
  content: string;
  status: 'pending' | 'confirmed';
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface ConversationMemoryPolicy {
  maxEntries: number;
  retentionDays: number;
}

export interface ConversationMemoryRepository {
  list(scope: ConversationMemoryScope, at?: number): Promise<ConversationMemory[]>;
  get(scope: ConversationMemoryScope, name: string, at?: number): Promise<ConversationMemory | null>;
  save(scope: ConversationMemoryScope, input: Pick<ConversationMemory, 'name' | 'title' | 'type' | 'content' | 'status'> & Partial<Pick<ConversationMemory, 'description'>>, policy: ConversationMemoryPolicy, at?: number): Promise<ConversationMemory>;
  /** Insert only: an existing or concurrently recreated name is never overwritten. */
  createIfMissing(scope: ConversationMemoryScope, input: Pick<ConversationMemory, 'name' | 'title' | 'type' | 'content' | 'status'> & Partial<Pick<ConversationMemory, 'description'>>, policy: ConversationMemoryPolicy, at?: number): Promise<ConversationMemory | null>;
  update(scope: ConversationMemoryScope, name: string, changes: Partial<Pick<ConversationMemory, 'title' | 'description' | 'type' | 'content' | 'status'>>, policy: ConversationMemoryPolicy, at?: number): Promise<ConversationMemory | null>;
  updateIfUnchanged(scope: ConversationMemoryScope, name: string, changes: Partial<Pick<ConversationMemory, 'title' | 'description' | 'type' | 'content' | 'status'>>, expectedUpdatedAt: number, policy: ConversationMemoryPolicy, at?: number, expected?: Pick<ConversationMemory, 'id' | 'status' | 'content'>): Promise<ConversationMemory | null>;
  delete(scope: ConversationMemoryScope, name: string): Promise<boolean>;
  deleteIfUnchanged(scope: ConversationMemoryScope, name: string, expectedUpdatedAt: number, expectedId: string, at?: number): Promise<boolean>;
  purgeExpired(at?: number): Promise<number>;
}

const TABLE = 'chatbot_conversation_memories';
interface MemoryRow {
  id: string; name: string; title: string; description: string; type: MemoryType; content: string; status: ConversationMemory['status'];
  created_at: number; updated_at: number; expires_at: number;
}
function record(row: MemoryRow): ConversationMemory {
  return { id: row.id, name: row.name, title: row.title, description: row.description, type: row.type, content: row.content, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at };
}
function validateScope(scope: ConversationMemoryScope): void {
  if (!scope || !['group', 'private'].includes(scope.conversationType) || [scope.accountId, scope.groupId, scope.externalId].some((value) => typeof value !== 'string' || !value || value.length > 512)) throw new Error('Invalid conversation memory scope.');
}
function validatePolicy(policy: ConversationMemoryPolicy): void {
  if (!Number.isSafeInteger(policy.maxEntries) || policy.maxEntries < 1 || policy.maxEntries > 1000 ||
      !Number.isSafeInteger(policy.retentionDays) || policy.retentionDays < 1 || policy.retentionDays > 365) throw new Error('Invalid conversation memory policy.');
}
function validateInput(value: Pick<ConversationMemory, 'name' | 'title' | 'type' | 'content' | 'status'> & Partial<Pick<ConversationMemory, 'description'>>): void {
  if (typeof value.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.name) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > KNOWLEDGE_LIMITS.title || /[\r\n]/.test(value.title) ||
      value.description !== undefined && (typeof value.description !== 'string' || value.description.length > KNOWLEDGE_LIMITS.description || /[\r\n]/.test(value.description)) ||
      typeof value.content !== 'string' || !value.content.trim() || value.content.length > KNOWLEDGE_LIMITS.memoryContent ||
      !['user', 'feedback', 'project', 'reference'].includes(value.type) || !['pending', 'confirmed'].includes(value.status)) throw new Error('Invalid conversation memory.');
}
function validateName(name: string): void {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Invalid conversation memory name.');
}
function validateTime(at: number): void {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid memory timestamp.');
}

export function createConversationMemoryRepository(bindings: RuntimeBindings): ConversationMemoryRepository {
  // A KV list/get/put sequence cannot enforce an atomic per-scope capacity or approval transition.
  if (!bindings.DB) throw new StorageUnavailableError();
  const db: D1DatabaseLike = bindings.DB;
  const columns = 'id, name, title, description, type, content, status, created_at, updated_at, expires_at';
  const where = 'account_id = ? AND group_id = ? AND conversation_type = ? AND group_external_id = ?';
  const values = (scope: ConversationMemoryScope) => [scope.accountId, scope.groupId, scope.conversationType, scope.externalId];
  return {
    async list(scope, at = Date.now()) {
      validateScope(scope); validateTime(at);
      const rows = await db.prepare(`SELECT ${columns} FROM ${TABLE} WHERE ${where} AND expires_at > ? ORDER BY updated_at DESC, id DESC LIMIT 1000`)
        .bind(...values(scope), at).all<MemoryRow>();
      return (rows.results ?? []).map(record);
    },
    async get(scope, name, at = Date.now()) {
      validateScope(scope); validateName(name); validateTime(at);
      const row = await db.prepare(`SELECT ${columns} FROM ${TABLE} WHERE ${where} AND name = ? AND expires_at > ?`)
        .bind(...values(scope), name, at).first<MemoryRow>();
      return row ? record(row) : null;
    },
    async save(scope, input, policy, at = Date.now()) {
      validateScope(scope); validatePolicy(policy); validateInput(input); validateTime(at);
      const expiresAt = at + policy.retentionDays * 86_400_000;
      // Count and insert must be one SQL statement; no concurrent writer may bypass the limit.
      const id = crypto.randomUUID();
      const result = await db.prepare(`INSERT INTO ${TABLE}
        (id, account_id, group_id, conversation_type, group_external_id, name, title, description, type, content, status, created_at, updated_at, expires_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
        (SELECT count(*) FROM ${TABLE} WHERE ${where} AND expires_at > ?) < ?
        ON CONFLICT(account_id, conversation_type, group_external_id, name) DO UPDATE SET
        id = CASE WHEN ${TABLE}.expires_at <= excluded.created_at THEN excluded.id ELSE ${TABLE}.id END,
        created_at = CASE WHEN ${TABLE}.expires_at <= excluded.created_at THEN excluded.created_at ELSE ${TABLE}.created_at END,
        title = excluded.title, description = excluded.description, type = excluded.type, content = excluded.content, status = excluded.status,
        updated_at = CASE WHEN ${TABLE}.updated_at >= excluded.updated_at THEN ${TABLE}.updated_at + 1 ELSE excluded.updated_at END,
        expires_at = CASE WHEN ${TABLE}.updated_at >= excluded.updated_at THEN ${TABLE}.updated_at + 1 ELSE excluded.updated_at END + ?
        WHERE ${TABLE}.group_id = excluded.group_id AND
          (excluded.status <> 'pending' OR ${TABLE}.status = 'pending' OR ${TABLE}.expires_at <= excluded.created_at)`)
        .bind(id, ...values(scope), input.name, input.title, input.description ?? '', input.type, input.content, input.status, at, at, expiresAt,
          ...values(scope), at, policy.maxEntries, policy.retentionDays * 86_400_000).run() as { meta?: { changes?: number } };
      if (!result?.meta?.changes) {
        const existing = await this.get(scope, input.name, at);
        if (input.status === 'pending' && existing?.status === 'confirmed') return existing;
        if (existing) {
          const updated = await this.updateIfUnchanged(scope, input.name, input, existing.updatedAt, policy, at,
            { id: existing.id, status: existing.status, content: existing.content });
          if (updated) return updated;
          throw new Error('Conversation memory changed concurrently.');
        }
        throw new Error('Conversation memory capacity reached.');
      }
      return (await this.get(scope, input.name, at))!;
    },
    async createIfMissing(scope, input, policy, at = Date.now()) {
      validateScope(scope); validatePolicy(policy); validateInput(input); validateTime(at);
      const id = crypto.randomUUID();
      const result = await db.prepare(`INSERT INTO ${TABLE}
        (id, account_id, group_id, conversation_type, group_external_id, name, title, description, type, content, status, created_at, updated_at, expires_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
        (SELECT count(*) FROM ${TABLE} WHERE ${where} AND expires_at > ?) < ?
        ON CONFLICT(account_id, conversation_type, group_external_id, name) DO UPDATE SET
          id = excluded.id, title = excluded.title, description = excluded.description, type = excluded.type,
          content = excluded.content, status = excluded.status, created_at = excluded.created_at,
          updated_at = excluded.updated_at, expires_at = excluded.expires_at
          WHERE ${TABLE}.group_id = excluded.group_id AND ${TABLE}.expires_at <= excluded.created_at`)
        .bind(id, ...values(scope), input.name, input.title, input.description ?? '', input.type, input.content,
          input.status, at, at, at + policy.retentionDays * 86_400_000, ...values(scope), at, policy.maxEntries)
        .run() as { meta?: { changes?: number } };
      return result?.meta?.changes ? this.get(scope, input.name, at) : null;
    },
    async update(scope, name, changes, policy, at = Date.now()) {
      validateScope(scope); validateName(name); validatePolicy(policy); validateTime(at);
      const existing = await this.get(scope, name, at);
      if (!existing) return null;
      return this.updateIfUnchanged(scope, name, changes, existing.updatedAt, policy, at,
        { id: existing.id, status: existing.status, content: existing.content });
    },
    async updateIfUnchanged(scope, name, changes, expectedUpdatedAt, policy, at = Date.now(), expected) {
      validateScope(scope); validateName(name); validatePolicy(policy); validateTime(at); validateTime(expectedUpdatedAt);
      const existing = await this.get(scope, name, at);
      if (!existing || existing.updatedAt !== expectedUpdatedAt ||
          expected && (existing.id !== expected.id || existing.status !== expected.status || existing.content !== expected.content)) return null;
      const next = { ...existing, ...changes };
      validateInput(next);
      const updatedAt = Math.max(at, expectedUpdatedAt + 1);
      validateTime(updatedAt);
      const result = await db.prepare(`UPDATE ${TABLE} SET title = ?, description = ?, type = ?, content = ?, status = ?,
        updated_at = ?, expires_at = ? WHERE ${where} AND name = ? AND id = ? AND updated_at = ?
        AND status = ? AND content = ? AND expires_at > ?`)
        .bind(next.title, next.description, next.type, next.content, next.status,
          updatedAt, updatedAt + policy.retentionDays * 86_400_000, ...values(scope), name,
          existing.id, expectedUpdatedAt, existing.status, existing.content, at).run() as { meta?: { changes?: number } };
      return result?.meta?.changes ? this.get(scope, name, at) : null;
    },
    async delete(scope, name) {
      validateScope(scope); validateName(name);
      const result = await db.prepare(`DELETE FROM ${TABLE} WHERE ${where} AND name = ?`).bind(...values(scope), name).run() as { meta?: { changes?: number } };
      return (result?.meta?.changes ?? 0) > 0;
    },
    async deleteIfUnchanged(scope, name, expectedUpdatedAt, expectedId, at = Date.now()) {
      validateScope(scope); validateName(name); validateTime(at); validateTime(expectedUpdatedAt);
      if (typeof expectedId !== 'string' || !expectedId) throw new Error('Invalid conversation memory identity.');
      const result = await db.prepare(`DELETE FROM ${TABLE} WHERE ${where} AND name = ? AND updated_at = ?
        AND expires_at > ? AND id = ?`)
        .bind(...values(scope), name, expectedUpdatedAt, at, expectedId).run() as { meta?: { changes?: number } };
      return (result?.meta?.changes ?? 0) > 0;
    },
    async purgeExpired(at = Date.now()) {
      validateTime(at);
      const result = await db.prepare(`DELETE FROM ${TABLE} WHERE expires_at <= ?`).bind(at).run() as { meta?: { changes?: number } };
      return result?.meta?.changes ?? 0;
    },
  };
}
