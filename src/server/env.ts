import type { RuntimeBindings } from '../shared/types';

export function readBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function validateRuntime(bindings: RuntimeBindings): string[] {
  const errors: string[] = [];
  if (!bindings.SYS_PASSWD) errors.push('SYS_PASSWD must be configured.');
  if (!bindings.SYS_SECRET) errors.push('SYS_SECRET must be configured.');
  const method = bindings.API_METHOD ?? 'webhook';
  if (method !== 'webhook' && method !== 'websocket') {
    errors.push('API_METHOD must be webhook or websocket.');
  }
  if (method === 'websocket' && bindings.PLATFORM && bindings.PLATFORM !== 'cloudflare') {
    errors.push(`API_METHOD=websocket is not supported on ${bindings.PLATFORM}; use webhook.`);
  }
  return errors;
}
