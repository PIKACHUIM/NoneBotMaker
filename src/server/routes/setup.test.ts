import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { D1DatabaseLike, D1StatementLike, RuntimeBindings } from '../../shared/types';
import { createApiRouter } from './index';

const sqliteModule = await import('node:sqlite').catch(() => null);
const DatabaseSyncConstructor = sqliteModule?.DatabaseSync;

function d1Adapter(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string): D1StatementLike {
      const statement = database.prepare(query);
      let values: SQLInputValue[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound as SQLInputValue[];
          return this;
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          statement.run(...values);
          return { success: true };
        },
      };
    },
  };
}

describe('online setup routes', () => {
  it('reports a missing D1 binding without failing the page', async () => {
    const response = await createApiRouter().request('/setup/status', {}, {} as RuntimeBindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        databaseConfigured: false,
        schemaReady: false,
        missing: ['DB binding'],
        pendingMigrations: 0,
      },
    });
  });

  it.skipIf(!DatabaseSyncConstructor)('requires SYS_SECRET and initializes D1 idempotently', async () => {
    const database = new DatabaseSyncConstructor!(':memory:');
    try {
      const bindings = {
        DB: d1Adapter(database),
        SYS_SECRET: 'setup-token',
      } as RuntimeBindings;
      const router = createApiRouter();

      const before = await router.request('/setup/status', {}, bindings);
      expect((await before.json() as { data: { schemaReady: boolean } }).data.schemaReady).toBe(false);

      const missingToken = await router.request('/setup', { method: 'POST' }, bindings);
      expect(missingToken.status).toBe(401);

      const wrongToken = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      }, bindings);
      expect(wrongToken.status).toBe(401);

      const initialized = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer setup-token' },
      }, bindings);
      expect(initialized.status).toBe(200);
      expect(await initialized.json()).toMatchObject({
        data: { databaseConfigured: true, schemaReady: true, pendingMigrations: 0 },
      });

      const repeated = await router.request('/setup', {
        method: 'POST',
        headers: { Authorization: 'Bearer setup-token' },
      }, bindings);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({ data: { schemaReady: true } });
    } finally {
      database.close();
    }
  });

  it('fails closed when no setup token is configured', async () => {
    const response = await createApiRouter().request('/setup', { method: 'POST' }, {} as RuntimeBindings);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'setup_unavailable' });
  });
});
