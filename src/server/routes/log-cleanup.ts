import { Hono } from 'hono';
import type { RuntimeBindings } from '../../shared/types';
import { runThrottledConversationLogCleanup } from '../storage/conversation-log-cleanup';
import { ApiError } from './management';

export function registerLogCleanupRoute(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.post('/internal/logs/purge', async (context) => {
    try {
      const result = await runThrottledConversationLogCleanup(context.env);
      return context.json(result);
    } catch {
      throw new ApiError(503, 'log_cleanup_unavailable');
    }
  });
}
