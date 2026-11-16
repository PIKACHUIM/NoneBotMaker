import { describe, expect, it, vi } from 'vitest';
import type { ExtensionRecord } from '../../shared/types';
import { runExtension, type ExtensionEvent } from './extensions';

const event: ExtensionEvent = {
  source: 'command', command: 'ping', args: 'hello', text: '/ping hello',
  accountId: 'account-1', groupId: 'group-1', groupName: 'Test Group', userId: 'user-1',
  conversationType: 'group', at: 1_700_000_000_000,
};

function extension(config: ExtensionRecord['config']): ExtensionRecord {
  return { id: 'ext-1', name: 'Test extension', description: '', enabled: true, config, createdAt: '', updatedAt: '' };
}

describe('extension runtime', () => {
  it('forwards events to an HTTPS webhook and normalizes replies', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ replies: ['pong', '', 3] }));
    const result = await runExtension(extension({ engine: 'webhook', webhookUrl: 'https://93.184.216.34/plugin', authToken: 'secret', timeoutMs: 2000 }), event, { fetch: fetchImpl });
    expect(result.replies).toEqual(['pong']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://93.184.216.34/plugin');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(String(init.body))).toMatchObject({ event: { command: 'ping', args: 'hello' }, extension: { id: 'ext-1' } });
  });

  it('accepts plain text and single-reply webhook responses', async () => {
    const text = await runExtension(extension({ engine: 'webhook', webhookUrl: 'https://93.184.216.34/plugin' }), event, {
      fetch: vi.fn(async () => new Response('hello from plugin', { headers: { 'content-type': 'text/plain' } })),
    });
    expect(text.replies).toEqual(['hello from plugin']);
    const json = await runExtension(extension({ engine: 'webhook', webhookUrl: 'https://93.184.216.34/plugin' }), event, {
      fetch: vi.fn(async () => Response.json({ reply: 'one' })),
    });
    expect(json.replies).toEqual(['one']);
  });

  it('runs a JavaScript extension where dynamic code is available', async () => {
    const result = await runExtension(extension({ engine: 'javascript', source: 'ctx.reply("hello " + ctx.args); return "second";' }), event);
    expect(result.replies).toEqual(['hello hello', 'second']);
  });

  it('rejects disabled extensions and missing JavaScript source', async () => {
    await expect(runExtension({ ...extension({ engine: 'javascript', source: 'ctx.reply("x")' }), enabled: false }, event)).rejects.toThrow('disabled');
    await expect(runExtension(extension({ engine: 'javascript', source: '  ' }), event)).rejects.toThrow('empty');
  });
});
