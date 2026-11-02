import { describe, expect, it } from 'vitest';
import type { RuntimeBindings } from '../../shared/types';
import { createApiRouter } from './index';

describe('admin route protections', () => {
  it('requires same-origin requests for browser mutations', async () => {
    const router = createApiRouter();
    const blocked = await router.request('/auth/logout', { method: 'POST' }, {} as RuntimeBindings);
    const allowed = await router.request('/auth/logout', {
      method: 'POST',
      headers: { Origin: 'http://localhost' },
    }, {} as RuntimeBindings);

    expect(blocked.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('does not apply browser Origin checks to external QQ webhooks', async () => {
    const response = await createApiRouter().request('/webhook/qq', { method: 'POST' }, {} as RuntimeBindings);
    expect(response.status).toBe(404);
  });

  it('requires an authenticated session for logs and provider discovery', async () => {
    const router = createApiRouter();
    const logs = await router.request('/logs', {}, { SYS_SECRET: 'test-secret' });
    const models = await router.request('/providers/provider-1/models', { method: 'POST' }, { SYS_SECRET: 'test-secret' });

    expect(logs.status).toBe(401);
    expect(models.status).toBe(403);
  });
});
