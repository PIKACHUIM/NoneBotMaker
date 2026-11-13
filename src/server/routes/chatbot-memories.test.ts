import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike, RuntimeBindings } from '../../shared/types';
import { createSessionToken, SESSION_COOKIE } from '../auth';
import { createApiRouter } from './index';

const sqlite = await import('node:sqlite').catch(() => null);
function fixture() {
  const database = new sqlite!.DatabaseSync(':memory:');
  let afterMemoryRead: ((database: DatabaseSync) => void) | undefined;
  database.exec(`CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE chatbot_conversation_memories (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_id TEXT NOT NULL,
      conversation_type TEXT NOT NULL CHECK (conversation_type IN ('group','private')),
      group_external_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('confirmed','pending')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      UNIQUE (account_id, conversation_type, group_external_id, name));`);
  const DB: D1DatabaseLike = { prepare(query): D1StatementLike {
    const statement = database.prepare(query);
    let values: SQLInputValue[] = [];
    return { bind(...args) { values = args as SQLInputValue[]; return this; }, async first<T>() {
      const found = statement.get(...values) as T | null ?? null;
      if (query.includes('FROM chatbot_conversation_memories') && query.includes('AND name = ?') && afterMemoryRead) {
        const callback = afterMemoryRead;
        afterMemoryRead = undefined;
        callback(database);
      }
      return found;
    },
      async all<T>() { return { results: statement.all(...values) as T[] }; }, async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
  } };
  function store(kind: string, value: Record<string, unknown>) {
    database.prepare('INSERT INTO records(kind,id,value,updated_at) VALUES(?,?,?,?)').run(kind, String(value.id), JSON.stringify(value), '');
  }
  store('accounts', { id: 'account', createdAt: '', updatedAt: '' });
  store('groups', { id: 'group', accountId: 'account', externalId: 'qq-a,qq-b', conversationType: 'group', memoryPolicyId: 'policy', createdAt: '', updatedAt: '' });
  store('policies', { id: 'policy', type: 'memory', enabled: true, config: { maxEntries: 2, retentionDays: 7 }, createdAt: '', updatedAt: '' });
  const bindings: RuntimeBindings = { DB, SYS_SECRET: 'memory-api-test' };
  const api = createApiRouter();
  const base = '/chatbot/conversations/account/group/memories';
  async function request(path: string, method = 'GET', body?: unknown) {
    const cookie = `${SESSION_COOKIE}=${await createSessionToken(bindings)}`;
    return api.request(path, { method, headers: { Cookie: cookie, Origin: 'http://localhost', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, bindings);
  }
  return { api, bindings, database, base, request, afterMemoryRead: (callback: (database: DatabaseSync) => void) => { afterMemoryRead = callback; } };
}

describe.skipIf(!sqlite?.DatabaseSync)('authenticated per-conversation memory routes', () => {
  it('requires a session and isolates other accounts and actual QQ openids', async () => {
    const f = fixture();
    try {
      expect((await f.api.request(`${f.base}?externalId=qq-a`, {}, f.bindings)).status).toBe(401);
      expect((await f.request(f.base)).status).toBe(400);
      const item = { name: 'favorite', title: 'Favorite', description: 'flower preference', type: 'user', content: 'likes flowers', status: 'pending' };
      const added = await f.request(`${f.base}?externalId=qq-a`, 'POST', item);
      expect(added.status).toBe(201);
      expect(await added.json()).toMatchObject({ data: { name: 'favorite', description: 'flower preference', status: 'pending' } });
      expect(await (await f.request(`${f.base}?externalId=qq-b`)).json()).toEqual({ data: { items: [] } });
      expect((await f.request(`${f.base}?externalId=unbound`)).status).toBe(404);
      expect((await f.request('/chatbot/conversations/other/group/memories?externalId=qq-a')).status).toBe(404);
      expect((await f.request(`${f.base}?externalId=qq-a`, 'POST', item)).status).toBe(409);
      const approved = await f.request(`${f.base}/favorite/approve?externalId=qq-a`, 'POST');
      expect(await approved.json()).toMatchObject({ data: { status: 'confirmed' } });
      expect((await f.request(`${f.base}/favorite/approve?externalId=qq-a`, 'POST')).status).toBe(409);
      expect((await f.request(`${f.base}/favorite?externalId=qq-b`)).status).toBe(404);
      expect((await f.request(`${f.base}/favorite?externalId=qq-a`, 'DELETE')).status).toBe(200);
    } finally { f.database.close(); }
  });

  it('rejects approval when a candidate is edited, confirmed or deleted after the read, even in the same millisecond', async () => {
    for (const competing of ['content', 'status', 'delete', 'recreate'] as const) {
      const f = fixture();
      try {
        const saved = await f.request(`${f.base}?externalId=qq-a`, 'POST',
          { name: 'candidate', title: 'Original', content: 'original', type: 'user', status: 'pending' });
        expect(saved.status).toBe(201);
        const original = (await saved.json() as { data: { id: string; updatedAt: number } }).data;
        f.afterMemoryRead((database) => {
          if (competing === 'delete' || competing === 'recreate') {
            if (competing === 'delete') database.prepare('DELETE FROM chatbot_conversation_memories WHERE id = ?').run(original.id);
            else database.prepare('UPDATE chatbot_conversation_memories SET id = ? WHERE id = ?').run('replacement', original.id);
            return;
          }
          database.prepare(`UPDATE chatbot_conversation_memories SET ${competing === 'content' ? 'content' : 'status'} = ? WHERE id = ?`)
            .run(competing === 'content' ? 'revised' : 'confirmed', original.id);
        });
        const attempted = await f.request(`${f.base}/candidate/approve?externalId=qq-a`, 'POST');
        expect(attempted.status, competing).toBe(409);
        expect(await attempted.json()).toEqual({ error: 'memory_changed_concurrently' });
        const current = f.database.prepare('SELECT id, status, content, updated_at FROM chatbot_conversation_memories WHERE name = ?').get('candidate') as
          { id: string; status: string; content: string; updated_at: number } | undefined;
        expect(current?.updated_at ?? original.updatedAt).toBe(original.updatedAt);
        if (competing === 'content') expect(current).toMatchObject({ status: 'pending', content: 'revised' });
        if (competing === 'status') expect(current?.status).toBe('confirmed');
        if (competing === 'delete') expect(current).toBeUndefined();
        if (competing === 'recreate') expect(current).toMatchObject({ id: 'replacement', status: 'pending' });
      } finally { f.database.close(); }
    }
  });

  it('atomically rejects duplicate concurrent POSTs without overwriting the winning record', async () => {
    const f = fixture();
    try {
      const path = `${f.base}?externalId=qq-a`;
      const payload = { name: 'one', title: 'One', content: 'original', type: 'user', status: 'confirmed' };
      const results = await Promise.all([
        f.request(path, 'POST', payload),
        f.request(path, 'POST', { ...payload, content: 'competing' }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const contents = (await (await f.request(path)).json() as { data: { items: Array<{ content: string }> } }).data.items.map((item) => item.content);
      expect(contents).toHaveLength(1);
      expect(['original', 'competing']).toContain(contents[0]);
    } finally { f.database.close(); }
  });

  it('returns service unavailable instead of faking persistence when only KV is bound', async () => {
    const f = fixture();
    try {
      const entries = new Map<string, string>();
      for (const row of f.database.prepare('SELECT kind, id, value FROM records').all() as Array<{ kind: string; id: string; value: string }>) {
        entries.set(`nonebotmaker:records:${row.kind}:${row.id}`, row.value);
      }
      const bindings: RuntimeBindings = { SYS_SECRET: f.bindings.SYS_SECRET, KV: {
        async get(key) { return entries.get(key) ?? null; }, async put(key, value) { entries.set(key, value); }, async delete(key) { entries.delete(key); },
      } };
      const token = await createSessionToken(bindings);
      const response = await f.api.request(`${f.base}?externalId=qq-a`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }, bindings);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'memory_storage_unavailable' });
    } finally { f.database.close(); }
  });

  it('accepts the knowledge limit of 20,000 Chinese characters without truncation', async () => {
    const f = fixture();
    try {
      const content = '花'.repeat(20_000);
      const saved = await f.request(`${f.base}?externalId=qq-a`, 'POST', { name: 'long', title: '中文标题', description: '', content, type: 'user', status: 'confirmed' });
      expect(saved.status).toBe(201);
      expect((await saved.json() as { data: { content: string } }).data.content).toBe(content);
    } finally { f.database.close(); }
  });

  it('supports editing approved memories and applies selected policy capacity', async () => {
    const f = fixture();
    try {
      for (const name of ['one', 'two']) expect((await f.request(`${f.base}?externalId=qq-a`, 'POST', { name, title: name, type: 'user', content: 'text', status: 'confirmed' })).status).toBe(201);
      const full = await f.request(`${f.base}?externalId=qq-a`, 'POST', { name: 'three', title: 'third', type: 'user', content: 'text', status: 'confirmed' });
      expect(full.status).toBe(409);
      expect(await full.json()).toEqual({ error: 'memory_capacity_reached' });
      expect((await f.request(`${f.base}/one?externalId=qq-a`, 'PATCH', { content: 'new content', description: 'edited description' })).status).toBe(200);
      expect((await f.request(`${f.base}/one?externalId=qq-a`, 'PATCH', { description: 23 })).status).toBe(400);
      for (const invalid of [{ description: 'a'.repeat(501) }, { title: 'a'.repeat(121) },
        { title: 'newline\nvalue' }, { content: 'a'.repeat(20_001) }]) {
        expect((await f.request(`${f.base}/one?externalId=qq-a`, 'PATCH', invalid)).status).toBe(400);
      }
      expect((await f.request(`${f.base}?externalId=qq-a`, 'POST', { name: '中文', title: 'title', content: 'text', type: 'user', status: 'confirmed' })).status).toBe(400);
      expect((await f.request(`${f.base}/one?externalId=qq-a`, 'PATCH', { name: 'three' })).status).toBe(400);
      const found = await f.request(`${f.base}/one?externalId=qq-a`);
      expect(await found.json()).toMatchObject({ data: { content: 'new content', description: 'edited description', status: 'confirmed' } });
    } finally { f.database.close(); }
  });
});
