import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilitySourceItem } from '../../client/api';
import type { RuntimeBindings } from '../../shared/types';
import { createApiRouter } from './index';

const originalPage = `<!doctype html><html><body>
<a class="sh-card sh-skill-card is-hover" href="/en/skill/acme/demo/pdf">
  <div class="id"><span class="owner">acme</span><span class="slash">/</span><span class="name">demo</span></div>
  <p class="desc" dir="auto">PDF helper for extracting text.</p>
  <div class="meta"><span><span class="ltr-nums">1.2k</span></span><span class="sh-score"><span class="ltr-nums">88</span></span></div>
</a>
</body></html>`;

const cnSkills = {
  code: 0,
  data: {
    skills: [{
      slug: 'cn-pdf', name: 'PDF 中文工具', description_zh: '中文简介', category: 'office-efficiency',
      tags: ['latest', 'ocr'], ownerName: 'alice', version: '1.2.0', downloads: 42, stars: 7, updated_at: 123,
    }],
  },
};

function bindings(): RuntimeBindings {
  return { SYS_PASSWD: 'admin-password', SYS_SECRET: 'test-db-secret', PLATFORM: 'local' };
}

async function search(hub: string): Promise<CapabilitySourceItem[]> {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
    if (url.includes('skills.palebluedot.live/en/browse')) return new Response(originalPage, { headers: { 'content-type': 'text/html' } });
    if (url.includes('api.skillhub.cn/api/skills')) return Response.json(cnSkills);
    if (url.includes('api.skillhub.cn/api/v1/categories')) return Response.json({ items: [{ key: 'office-efficiency', name: '办公效率' }] });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchImpl);
  const router = createApiRouter();
  const env = bindings();
  const login = await router.request('/auth/login', {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin-password' }),
  }, env);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const response = await router.request(`/capability-sources/skills/search?hub=${hub}&q=pdf`, { headers: { Cookie: cookie } }, env);
  expect(response.status).toBe(200);
  return (await response.json() as { data: CapabilitySourceItem[] }).data;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('online skill sources', () => {
  it('merges original and Chinese SkillHub metadata', async () => {
    const data = await search('all');
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      name: 'demo', author: 'acme', description: 'PDF helper for extracting text.',
      downloads: 1200, stars: 88, hub: 'palebluedot', hubName: 'SkillHub 原版',
    });
    expect(data[1]).toMatchObject({
      name: 'PDF 中文工具', description: '中文简介', category: '办公效率', author: 'alice',
      version: '1.2.0', downloads: 42, stars: 7, hub: 'skillhub-cn', hubName: 'SkillHub 国内',
    });
    expect(data[1].tags).toEqual(['ocr']);
  });

  it('filters by a preselected hub', async () => {
    const data = await search('skillhub-cn');
    expect(data).toHaveLength(1);
    expect(data[0].hub).toBe('skillhub-cn');
  });
});
