import { Hono } from 'hono';
import type { DatabaseSetupStatus, RuntimeBindings } from '../../shared/types';
import { constantTimePasswordMatches } from '../auth';
import { initializeD1Setup, inspectD1Setup } from '../storage/d1-setup';

function bearerToken(authorization: string | undefined): string {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
}

const NOT_CONFIGURED: DatabaseSetupStatus = {
  databaseConfigured: false,
  schemaReady: false,
  missing: ['DB binding'],
  pendingMigrations: 0,
};

export function registerSetupRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/setup/status', async (context) => {
    if (!context.env.DB) return context.json({ data: NOT_CONFIGURED });
    try {
      return context.json({ data: await inspectD1Setup(context.env.DB) });
    } catch {
      return context.json({ error: 'storage_unavailable' }, 503);
    }
  });

  api.post('/setup', async (context) => {
    if (!context.env.SYS_SECRET) return context.json({ error: 'setup_unavailable' }, 503);
    if (!context.env.DB) return context.json({ error: 'database_unavailable' }, 503);
    if (!(await constantTimePasswordMatches(bearerToken(context.req.header('Authorization')), context.env.SYS_SECRET))) {
      return context.json({ error: 'unauthorized' }, 401);
    }

    try {
      return context.json({ data: await initializeD1Setup(context.env.DB) });
    } catch (error) {
      console.error('D1 setup failed', error instanceof Error ? error.message : 'unknown error');
      return context.json({ error: 'setup_failed' }, 500);
    }
  });
}
