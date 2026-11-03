import { describe, expect, it, vi } from 'vitest';
import { parseBaiduMobile, parseBingRss, parseDuckDuckGoHtml, parseDuckDuckGoLite, webSearch } from './search';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const dns = () => json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
const routed = (handler: (url: string) => Response | Promise<Response>) => vi.fn(async (input: RequestInfo | URL) => (
  String(input).includes('cloudflare-dns.com') ? dns() : handler(String(input))
));

const ddgHtml = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&amp;rut=abc">A &amp; B <b>title</b></a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Snippet &quot;one&quot; with &#39;quotes&#39;.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <a class="result__a" href="https://direct.example/b">Direct</a>
    <a class="result__snippet">Second snippet.</a>
  </div>
</div>`;

describe('free web search parsers', () => {
  it('parses DuckDuckGo html results and decodes redirect links', () => {
    expect(parseDuckDuckGoHtml(ddgHtml, 5)).toEqual([
      { title: 'A & B title', url: 'https://example.com/a?x=1', snippet: 'Snippet "one" with \'quotes\'.' },
      { title: 'Direct', url: 'https://direct.example/b', snippet: 'Second snippet.' },
    ]);
  });

  it('parses DuckDuckGo lite results', () => {
    const html = `
      <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example%2Fpage&amp;rut=1" class='result-link'>Lite result</a>
      <td class='result-snippet'>Lite snippet</td>`;
    expect(parseDuckDuckGoLite(html, 3)).toEqual([{ title: 'Lite result', url: 'https://lite.example/page', snippet: 'Lite snippet' }]);
  });

  it('parses Bing RSS and skips non-http links', () => {
    const xml = `<rss><channel>
      <item><title>Bing &amp; title</title><link>https://bing.example/a</link><description><![CDATA[<b>hello</b> world]]></description></item>
      <item><title>Bad</title><link>javascript:alert(1)</link><description>nope</description></item>
    </channel></rss>`;
    expect(parseBingRss(xml, 5)).toEqual([{ title: 'Bing & title', url: 'https://bing.example/a', snippet: 'hello world' }]);
  });

  it('parses Baidu mobile SSR results and skips unsafe links', () => {
    const html = `<script>window.__state={"citationList":[{"abstract":"A &amp; B","title":"T","url":"https://example.com/a"},{"title":"bad","url":"javascript:1"}]};</script>`;
    expect(parseBaiduMobile(html, 5)).toEqual([{ title: 'T', url: 'https://example.com/a', snippet: 'A & B' }]);
  });

  it('uses Baidu mobile when DuckDuckGo is challenged', async () => {
    const fetchImpl = routed((url) => url.includes('duckduckgo')
      ? new Response('<html><div class="anomaly-modal">challenge</div></html>', { headers: { 'content-type': 'text/html' } })
      : new Response('<script>{"citationList":[{"title":"B","url":"https://b.example","abstract":"s"}]}</script>', { headers: { 'content-type': 'text/html' } }));
    await expect(webSearch('test', { engine: 'auto' }, fetchImpl as typeof fetch)).resolves.toMatchObject({
      engine: 'baidu', results: [{ title: 'B', url: 'https://b.example', snippet: 's' }],
    });
  });

  it('falls back from DuckDuckGo and Baidu to Bing in auto mode', async () => {
    const fetchImpl = routed((url) => url.includes('duckduckgo')
      ? new Response('<html><div class="anomaly-modal">challenge</div></html>', { headers: { 'content-type': 'text/html' } })
      : url.includes('baidu')
        ? new Response('<html><div>wappass.baidu.com/static/captcha</div></html>', { headers: { 'content-type': 'text/html' } })
        : new Response('<rss><channel><item><title>B</title><link>https://b.example</link><description>s</description></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } }));
    await expect(webSearch('test', { engine: 'auto' }, fetchImpl as typeof fetch)).resolves.toMatchObject({
      engine: 'bing', results: [{ title: 'B', url: 'https://b.example', snippet: 's' }],
    });
  });

  it('requires a key for Brave and rejects oversized queries', async () => {
    await expect(webSearch('test', { engine: 'brave' }, vi.fn() as unknown as typeof fetch)).rejects.toThrow('brave_api_key');
    await expect(webSearch('x'.repeat(501), {}, vi.fn() as unknown as typeof fetch)).rejects.toThrow('500');
  });
});
