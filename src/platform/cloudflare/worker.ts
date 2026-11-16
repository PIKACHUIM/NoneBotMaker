import { app } from '../../server/app';
import type { RuntimeBindings } from '../../shared/types';
import { purgeExpiredLogs } from '../../server/storage/log-retention';
import { createConversationMemoryRepository } from '../../server/storage/conversation-memory-repository';
import { runDueSchedules } from '../../server/automation/schedules';
import { ensureQQGatewaySessions } from './qq-do';
export { QQGatewayDurableObject } from './qq-do';
export { AutomationDurableObject } from './automation-do';

interface ScheduledControllerLike {
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

let lastAutomationEnsureAt = 0;

function ensureAutomationScheduler(bindings: RuntimeBindings): Promise<void> | undefined {
  const namespace = bindings.AUTOMATION_SCHEDULER as DurableObjectNamespaceLike | undefined;
  if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') return undefined;
  if (Date.now() - lastAutomationEnsureAt < 60_000) return undefined;
  lastAutomationEnsureAt = Date.now();
  return namespace.get(namespace.idFromName('global'))
    .fetch(new Request('https://automation.internal/ensure'))
    .then(() => undefined)
    .catch((error) => {
      console.error('Automation scheduler ensure failed.', error instanceof Error ? error.message : error);
    });
}

export default {
  async fetch(request: Request, env: RuntimeBindings, context?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    const maintenance = ensureQQGatewaySessions(bindings).catch((error) => {
      console.error('QQ gateway maintenance failed; management remains available.', error instanceof Error ? error.message : error);
    });
    const automation = ensureAutomationScheduler(bindings);
    if (context) {
      context.waitUntil(maintenance);
      if (automation) context.waitUntil(automation);
    } else {
      await maintenance;
      if (automation) await automation;
    }
    const isApplicationPath = url.pathname.startsWith('/api/') || url.pathname === '/webhook/qq';
    if (isApplicationPath || !env.ASSETS) {
      return app.fetch(request, bindings);
    }
    return env.ASSETS.fetch(request);
  },
  scheduled(controller: ScheduledControllerLike, env: RuntimeBindings, context: ExecutionContextLike): void {
    const bindings = { ...env, PLATFORM: 'cloudflare' };
    context.waitUntil(purgeExpiredLogs(bindings, controller.scheduledTime));
    if (bindings.DB) {
      context.waitUntil(createConversationMemoryRepository(bindings).purgeExpired(controller.scheduledTime));
      context.waitUntil(runDueSchedules(bindings, controller.scheduledTime).catch((error) => {
        console.error('Scheduled task run failed.', error instanceof Error ? error.message : error);
      }));
    }
  },
};
