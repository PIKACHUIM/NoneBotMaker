import { app } from '../../server/app';
import type { RuntimeBindings } from '../../shared/types';

export interface EdgeOneFunctionContext {
  request: Request;
  env?: Record<string, unknown>;
  waitUntil?: (task: Promise<unknown>) => void;
}

export async function onRequest(context: EdgeOneFunctionContext): Promise<Response> {
  const bindings = { ...(context.env ?? {}), PLATFORM: 'edgeone' } as RuntimeBindings;
  return app.fetch(context.request, bindings);
}
