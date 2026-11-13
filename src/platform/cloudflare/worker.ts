import { app } from '../../server/app';
import type { RuntimeBindings } from '../../shared/types';
import { purgeExpiredLogs } from '../../server/storage/log-retention';
import { createConversationMemoryRepository } from '../../server/storage/conversation-memory-repository';
import { ensureQQGatewaySessions } from './qq-do';
export { QQGatewayDurableObject } from './qq-do';

interface ScheduledControllerLike {
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: RuntimeBindings, context?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    const maintenance = ensureQQGatewaySessions(bindings).catch((error) => {
      console.error('QQ gateway maintenance failed; management remains available.', error instanceof Error ? error.message : error);
    });
    if (context) context.waitUntil(maintenance);
    else await maintenance;
    const isApplicationPath = url.pathname.startsWith('/api/') || url.pathname === '/webhook/qq';
    if (isApplicationPath || !env.ASSETS) {
      return app.fetch(request, bindings);
    }
    return env.ASSETS.fetch(request);
  },
  scheduled(controller: ScheduledControllerLike, env: RuntimeBindings, context: ExecutionContextLike): void {
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    context.waitUntil(purgeExpiredLogs(bindings, controller.scheduledTime));
    if (bindings.DB) context.waitUntil(createConversationMemoryRepository(bindings).purgeExpired(controller.scheduledTime));
  },
};
