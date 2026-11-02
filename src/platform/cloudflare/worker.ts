import { app } from '../../server/app';
import type { RuntimeBindings } from '../../shared/types';
import { purgeExpiredLogs } from '../../server/storage/log-retention';
import { ensureQQGatewaySessions } from './qq-do';
export { QQGatewayDurableObject } from './qq-do';

interface ScheduledControllerLike {
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: RuntimeBindings): Promise<Response> {
    const url = new URL(request.url);
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    await ensureQQGatewaySessions(bindings);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, bindings);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, bindings);
  },
  scheduled(controller: ScheduledControllerLike, env: RuntimeBindings, context: ExecutionContextLike): void {
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    context.waitUntil(purgeExpiredLogs(bindings, controller.scheduledTime));
  },
};
