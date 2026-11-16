import { Hono, type Context } from 'hono';
import type { RuntimeBindings } from '../../shared/types';
import { runDueSchedules, runSchedule } from '../automation/schedules';
import { ApiError } from './management';

const INTERNAL_SCHEDULE_PATH = /(?:^|\/)internal\/schedules\/run\/?$/;

async function bearerMatches(context: Context<{ Bindings: RuntimeBindings }>): Promise<boolean> {
  const secret = context.env.SYS_SECRET;
  if (!secret) return false;
  const authorization = context.req.header('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || token.length !== secret.length) return false;
  let mismatch = 0;
  for (let index = 0; index < token.length; index += 1) mismatch |= token.charCodeAt(index) ^ secret.charCodeAt(index);
  return mismatch === 0;
}

export function registerScheduleRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.post('/schedules/run-due', async (context) => {
    try {
      const results = await runDueSchedules(context.env, Date.now());
      return context.json({ data: { ran: results.length, results } });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'schedule_run_failed' }, 502);
    }
  });

  api.post('/schedules/:id/run', async (context) => {
    try {
      const result = await runSchedule(context.env, context.req.param('id'), Date.now(), { force: true });
      return context.json({ data: result });
    } catch (error) {
      if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
      return context.json({ error: error instanceof Error ? error.message : 'schedule_run_failed' }, 502);
    }
  });

  api.post('/internal/schedules/run', async (context) => {
    if (!(await bearerMatches(context))) return context.json({ error: 'unauthorized' }, 401);
    try {
      const results = await runDueSchedules(context.env, Date.now());
      return context.json({ data: { ran: results.length, results } });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'schedule_run_failed' }, 502);
    }
  });
}

export function isInternalSchedulePath(path: string): boolean {
  return INTERNAL_SCHEDULE_PATH.test(path);
}
