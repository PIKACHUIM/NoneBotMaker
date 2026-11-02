import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, KVNamespaceLike, RuntimeBindings } from '../../shared/types';
import { createApiRouter } from '../routes';
import { runThrottledConversationLogCleanup } from './conversation-log-cleanup';
import { purgeExpiredLogs } from './log-retention';

function createKV(values: Map<string, string>): KVNamespaceLike {
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list(options) {
      const prefix = options?.prefix ?? '';
      return {
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

describe('conversation log cleanup route', () => {
  it('physically deletes expired EdgeOne Blob logs and throttles subsequent requests', async () => {
    const now = Date.now();
    const expired = {
      id: 'expired-log',
      accountId: 'account-1',
      groupId: 'group-1',
      groupExternalId: 'external-1',
      userId: 'user-1',
      direction: 'in',
      content: 'expired content',
      createdAt: now - 31 * 24 * 60 * 60 * 1000,
      expiresAt: now - 24 * 60 * 60 * 1000,
    };
    const key = `nonebotmaker/conversation_logs/${encodeURIComponent(expired.accountId)}/${encodeURIComponent(expired.groupId)}/${expired.createdAt}/${encodeURIComponent(expired.id)}`;
    const objects = new Map([[key, JSON.stringify(expired)]]);
    const blob = {
      async get(name: string) { return objects.get(name) ?? null; },
      async put(name: string, value: string) { objects.set(name, value); },
      async delete(name: string) { objects.delete(name); },
      async list(options: { prefix: string }) {
        return { objects: [...objects.keys()].filter((name) => name.startsWith(options.prefix)).map((key) => ({ key })) };
      },
    };
    const cleanupKV = createKV(new Map());
    const bindings: RuntimeBindings = {
      PLATFORM: 'edgeone',
      EDGEONE_BLOB: blob,
      LOG_CLEANUP_KV: cleanupKV,
      LOG_CLEANUP_SECRET: 'scheduled-cleanup-secret',
    };
    const router = createApiRouter();
    const first = await router.request('/internal/logs/purge', {
      method: 'POST',
      headers: { Authorization: 'Bearer scheduled-cleanup-secret' },
    }, bindings);
    const firstResult = await first.json() as { deleted: number; skipped: boolean };
    const second = await router.request('/internal/logs/purge', {
      method: 'POST',
      headers: { Authorization: 'Bearer scheduled-cleanup-secret' },
    }, bindings);
    const secondResult = await second.json() as { deleted: number; skipped: boolean };

    expect(first.status).toBe(200);
    expect(firstResult).toEqual({ deleted: 1, skipped: false });
    expect(objects.has(key)).toBe(false);
    expect(second.status).toBe(200);
    expect(secondResult.skipped).toBe(true);
  });

  it('does not allow unauthenticated cleanup requests', async () => {
    const response = await createApiRouter().request('/internal/logs/purge', { method: 'POST' }, {
      PLATFORM: 'edgeone',
      LOG_CLEANUP_SECRET: 'configured-secret',
    });
    expect(response.status).toBe(403);
  });

  it('runs D1 scheduled cleanup without a KV throttle binding', async () => {
    let statement = '';
    const db = {
      prepare(query: string) {
        statement = query;
        return {
          bind() {
            return { run: async () => ({ meta: { changes: 4 } }) };
          },
        };
      },
    } as unknown as D1DatabaseLike;

    await expect(purgeExpiredLogs({ PLATFORM: 'cloudflare', DB: db }, 1234)).resolves.toBe(4);
    expect(statement).toContain('DELETE FROM conversation_logs WHERE expires_at <= ?');
  });

  it('clears the throttle marker when a cleanup sweep fails', async () => {
    const values = new Map<string, string>();
    const kv = createKV(values);
    const bindings: RuntimeBindings = {
      PLATFORM: 'edgeone',
      EDGEONE_BLOB: {
        async get() { return null; },
        async put() {},
        async delete() {},
        async list() { throw new Error('temporary storage failure'); },
      },
      LOG_CLEANUP_KV: kv,
    };

    await expect(runThrottledConversationLogCleanup(bindings, 10_000)).rejects.toThrow('temporary storage failure');
    expect(values.size).toBe(0);
  });
});
