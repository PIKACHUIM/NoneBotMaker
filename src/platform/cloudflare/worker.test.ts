import { describe, expect, it, vi } from 'vitest';
import type { RuntimeBindings } from '../../shared/types';

const cleanup = vi.hoisted(() => ({ purgeExpiredLogs: vi.fn(async () => 3) }));
vi.mock('../../server/storage/log-retention', () => ({ purgeExpiredLogs: cleanup.purgeExpiredLogs }));

import worker from './worker';

describe('Cloudflare scheduled cleanup', () => {
  it('passes the scheduled timestamp to physical log cleanup', () => {
    const scheduledTime = 1_800_000_000_000;
    const bindings = { DB: {} } as RuntimeBindings;
    const waitUntil = vi.fn((_promise: Promise<unknown>) => undefined);

    worker.scheduled({ scheduledTime }, bindings, { waitUntil });

    expect(cleanup.purgeExpiredLogs).toHaveBeenCalledWith(
      { ...bindings, PLATFORM: 'cloudflare' },
      scheduledTime,
    );
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
