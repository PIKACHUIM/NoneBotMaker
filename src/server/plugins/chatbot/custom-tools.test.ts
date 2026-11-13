import { describe, expect, it, vi } from 'vitest';
import type { LibraryRecord } from '../../../shared/types';
import { createCustomApiTools, createCustomApiToolsFromRecords, type CustomApiToolConfig } from './custom-tools';
import { executeTool } from './tools';

const config: CustomApiToolConfig = {
  id: 'lookup', name: 'Lookup', description: 'Read from a configured JSON API', url: 'https://api.example/v1/lookup', allowedHosts: ['api.example'], bearerToken: 'private-credential',
  properties: { query: { type: 'string', maxLength: 32 }, limit: { type: 'number' } }, required: ['query'], enabled: true,
};
const dns = () => Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const json = (value: unknown) => Response.json(value);

describe('administrator-configured custom JSON APIs', () => {
  it('exposes approval metadata; POSTs only explicitly approved argument fields', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).includes('cloudflare-dns.com') ? dns() : json({ found: true, authorization: 'private-credential' }));
    const [registered] = createCustomApiTools([config], fetchImpl);
    expect(registered.custom).toEqual({ id: 'lookup', host: 'api.example', approvalRequired: true });
    expect(registered.definition.function.parameters).toMatchObject({ additionalProperties: false, required: ['query'] });
    const value = JSON.parse(await registered.execute({ query: 'plants', limit: 2 }));
    expect(value).toMatchObject({ untrusted: true, data: { found: true, authorization: '[redacted]' } });
    const [url, init] = fetchImpl.mock.calls.at(-1)!;
    expect(url).toBe(config.url);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'plants', limit: 2 });
    expect(init?.headers).toMatchObject({ authorization: 'Bearer private-credential' });
  });

  it('fails closed on arbitrary arguments even when execute is called without dispatcher validation', async () => {
    const fetchImpl = vi.fn();
    const [registered] = createCustomApiTools([config], fetchImpl);
    for (const args of [{ query: 'ok', url: 'https://127.0.0.1' }, { query: 'x'.repeat(33) }, { limit: 1 }, { query: 1 }]) {
      await expect(registered.execute(args)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('rejects private URLs, mismatched domain, credentials in URL and query-based tokens', () => {
    for (const url of ['http://api.example/v1', 'https://127.0.0.1/v1', 'https://api.example.evil.test/v1', 'https://user:pass@api.example/v1', 'https://api.example/v1?token=secret']) {
      expect(() => createCustomApiTools([{ ...config, url }])).toThrow();
    }
    expect(() => createCustomApiTools([{ ...config, properties: { apiKey: { type: 'string' } } }])).toThrow();
  });

  it('does not follow redirects or surface remote secret-bearing diagnostics', async () => {
    const redirect = vi.fn(async (url: RequestInfo | URL) => String(url).includes('cloudflare-dns.com') ? dns() : new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }));
    const [registered] = createCustomApiTools([config], redirect);
    await expect(registered.execute({ query: 'x' })).rejects.toThrow('Custom API request failed');
    expect(redirect).toHaveBeenCalledTimes(3);
    const error = vi.fn(async (url: RequestInfo | URL) => String(url).includes('cloudflare-dns.com') ? dns() : new Response('private-credential', { status: 500 }));
    const output = await executeTool('custom_lookup', '{"query":"x"}', new Map([['custom_lookup', createCustomApiTools([config], error)[0]]]), []);
    expect(output.content).not.toContain('private-credential');
    expect(output.isError).toBe(true);
  });

  it('rejects private DNS answers, non-JSON and oversized responses', async () => {
    const privateDns = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.2' }] }));
    await expect(createCustomApiTools([config], privateDns)[0].execute({ query: 'x' })).rejects.toThrow('Custom API request failed');
    const html = vi.fn(async (url: RequestInfo | URL) => String(url).includes('cloudflare-dns.com') ? dns() : new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
    await expect(createCustomApiTools([config], html)[0].execute({ query: 'x' })).rejects.toThrow('JSON');
    const oversized = vi.fn(async (url: RequestInfo | URL) => String(url).includes('cloudflare-dns.com') ? dns() : new Response('x'.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
    await expect(createCustomApiTools([config], oversized)[0].execute({ query: 'x' })).rejects.toThrow('too large');
  });

  it('does not register disabled tools or duplicate names', () => {
    expect(createCustomApiTools([{ ...config, enabled: false }])).toEqual([]);
    expect(() => createCustomApiTools([{ ...config, enabled: 'false' as unknown as boolean }])).toThrow('configuration');
    expect(() => createCustomApiTools([config, config])).toThrow('Duplicate');
  });

  it('adapts persisted administrator tool records, supports safe GET, and skips builtins', async () => {
    const record: LibraryRecord = { id: '7e8ab123-1234-1234-1234-123456789012', name: 'Public lookup', description: 'Lookup', enabled: true,
      config: { kind: 'https', url: config.url, method: 'GET', authToken: 'private-credential', readOnly: true,
        parameterSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 32 } }, required: ['query'], additionalProperties: false } }, createdAt: '', updatedAt: '' };
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).includes('cloudflare-dns.com') ? dns() : json({ ok: true }));
    const registered = createCustomApiToolsFromRecords([record, { ...record, id: 'builtin', config: { kind: 'builtin', name: 'chat_generate_image' } }], fetchImpl);
    expect(registered).toHaveLength(1);
    expect(registered[0].definition.function.name).toBe(`custom_${record.id}`);
    expect(registered[0].custom).toMatchObject({ id: record.id, approvalRequired: false });
    await registered[0].execute({ query: 'plant & tree' });
    const [url, init] = fetchImpl.mock.calls.at(-1)!;
    expect(url).toBe(`${config.url}?query=plant+%26+tree`);
    expect(init?.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
    expect(() => createCustomApiToolsFromRecords([{ ...record, config: { ...record.config, parameterSchema: { type: 'object', additionalProperties: true } } }])).toThrow('schema');
    expect(() => createCustomApiToolsFromRecords([{ ...record, config: { ...record.config, method: 'DELETE' } }])).toThrow('method');
    expect(() => createCustomApiToolsFromRecords([{ ...record, config: { ...record.config, method: 'GET', readOnly: false } }])).toThrow('read-only');
  });
});
