import type { RuntimeBindings } from '../../shared/types';
import { createConversationLogRepository } from './conversation-log-repository';
import { purgeExpiredLogs } from './log-retention';

export const LOG_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;
const CLEANUP_MARKER_KEY = 'nonebotmaker:maintenance:conversation-logs:last-cleanup';

function cleanupStateKV(bindings: RuntimeBindings) {
  return bindings.LOG_CLEANUP_KV ??
    (bindings.PLATFORM === 'edgeone' ? bindings.EDGEONE_KV : undefined) ??
    (bindings.PLATFORM === 'esa' ? bindings.ESA_KV : undefined) ??
    bindings.KV;
}

export async function runThrottledConversationLogCleanup(
  bindings: RuntimeBindings,
  now = Date.now(),
): Promise<{ deleted: number; skipped: boolean; nextRunAt?: number }> {
  const repository = createConversationLogRepository(bindings);
  const kv = cleanupStateKV(bindings);
  if (!kv) throw new Error('A KV binding is required to throttle conversation log cleanup.');

  const lastRun = Number(await kv.get(CLEANUP_MARKER_KEY));
  if (Number.isFinite(lastRun) && lastRun > 0 && now - lastRun < LOG_CLEANUP_INTERVAL_SECONDS * 1000) {
    return { deleted: 0, skipped: true, nextRunAt: lastRun + LOG_CLEANUP_INTERVAL_SECONDS * 1000 };
  }

  await kv.put(CLEANUP_MARKER_KEY, String(now), { expirationTtl: LOG_CLEANUP_INTERVAL_SECONDS + 60 });
  try {
    const deleted = await repository.purgeExpired(now);
    return { deleted, skipped: false };
  } catch (error) {
    await kv.delete(CLEANUP_MARKER_KEY);
    throw error;
  }
}

export async function runScheduledConversationLogCleanup(bindings: RuntimeBindings, now = Date.now()): Promise<number> {
  return purgeExpiredLogs(bindings, now);
}
