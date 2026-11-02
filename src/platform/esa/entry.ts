import { app } from '../../server/app';
import type { RuntimeBindings } from '../../shared/types';

export default {
  async fetch(request: Request, env: Record<string, unknown> = {}): Promise<Response> {
    const bindings = { ...env, PLATFORM: 'esa' } as RuntimeBindings;
    return app.fetch(request, bindings);
  },
};
