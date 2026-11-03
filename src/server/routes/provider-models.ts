import { Hono } from 'hono';
import type { JsonObject, ProviderRecord, RuntimeBindings } from '../../shared/types';
import { decryptSecrets } from '../storage/secrets';
import { createRepository, StorageUnavailableError } from '../storage/repository';
import { ApiError } from './management';

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 20_000;
const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan', '.test', '.invalid', '.example', '.nip.io', '.sslip.io', '.xip.io'];

function modelEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiError(400, 'invalid_provider_url');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port !== '' && url.port !== '443') ||
    hostname.includes(':') ||
    /^[\d.]+$/.test(hostname) ||
    !hostname.includes('.') ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new ApiError(400, 'invalid_provider_url');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.toLowerCase().endsWith('/models') ? pathname : `${pathname}/models`;
  return url;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Provider response exceeds the size limit.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function discoverProviderModels(provider: ProviderRecord, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = modelEndpoint(provider.baseUrl);
  const headers = new Headers({ Accept: 'application/json' });
  if (provider.apiKey) headers.set('Authorization', `Bearer ${provider.apiKey}`);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, 'provider_unavailable');
  }
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new ApiError(502, 'provider_unavailable');
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new ApiError(502, 'invalid_provider_response');

  let payload: unknown;
  try {
    payload = JSON.parse(await readLimitedBody(response));
  } catch {
    throw new ApiError(502, 'invalid_provider_response');
  }
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new ApiError(502, 'invalid_provider_response');
  }

  const models = (payload as { data: Array<{ id?: unknown }> }).data
    .flatMap((model) => typeof model?.id === 'string' && model.id.trim().length > 0 && model.id.length <= 256 ? [model.id.trim()] : []);
  return [...new Set(models)];
}

export function registerProviderModelRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.post('/providers/:id/models', async (context) => {
    let repository;
    try {
      repository = createRepository(context.env);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw new ApiError(503, 'storage_unavailable');
      throw error;
    }
    const record = await repository.get('providers', context.req.param('id'));
    if (!record) throw new ApiError(404, 'not_found');

    let provider: ProviderRecord;
    try {
      provider = await decryptSecrets(record as JsonObject, context.env) as unknown as ProviderRecord;
    } catch {
      throw new ApiError(503, 'provider_secret_unavailable');
    }
    const models = await discoverProviderModels(provider);
    return context.json({ models });
  });
}
