import { describe, expect, it, vi } from 'vitest';
import type { RuntimeBindings } from '../../shared/types';

const cleanup = vi.hoisted(() => ({ purgeExpiredLogs: vi.fn(async () => 3) }));
vi.mock('../../server/storage/log-retention', () => ({ purgeExpiredLogs: cleanup.purgeExpiredLogs }));

import worker from './worker';

describe('Cloudflare Worker routing', () => {
  it('routes API and QQ webhook requests to the application, and pages to assets', async () => {
    const assets = { fetch: vi.fn(async () => new Response('asset')) };
    const bindings = { ASSETS: assets } as unknown as RuntimeBindings;

    const health = await worker.fetch(new Request('https://example.test/api/health'), bindings);
    const webhook = await worker.fetch(new Request('https://example.test/webhook/qq', { method: 'POST' }), bindings);
    const setup = await worker.fetch(new Request('https://example.test/setup'), bindings);

    expect(await health.json()).toMatchObject({ ok: true });
    expect(webhook.status).toBe(401);
    expect(await setup.text()).toBe('asset');
    expect(assets.fetch).toHaveBeenCalledOnce();
  });
});

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
