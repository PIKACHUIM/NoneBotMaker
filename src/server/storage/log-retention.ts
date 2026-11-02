import type { RuntimeBindings } from '../../shared/types';
import { createConversationLogRepository } from './conversation-log-repository';

export async function purgeExpiredLogs(bindings: RuntimeBindings, now = Date.now()): Promise<number> {
  return createConversationLogRepository(bindings).purgeExpired(now);
}
