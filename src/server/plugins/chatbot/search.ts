import { boundedText, safeFetch } from './network';

export type WebSearchEngine = 'auto' | 'duckduckgo' | 'bing' | 'brave';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  engine: string;
  query: string;
  results: WebSearchResult[];
}

export const MAX_SEARCH_RESULTS = 10;
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export function normalizeSearchEngine(value: unknown): WebSearchEngine {
  return value === 'duckduckgo' || value === 'bing' || value === 'brave' ? value : 'auto';
}

function clampLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(parsed)));
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCodePoint(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) return '';
  try { return String.fromCodePoint(value); } catch { return ''; }
}

function trimText(value: string, limit: number): string {
  const text = decodeEntities(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function dedupe(results: WebSearchResult[], limit: number): WebSearchResult[] {
  const seen = new Set<string>();
  const unique: WebSearchResult[] = [];
  for (const result of results) {
    if (!result.url || seen.has(result.url)) continue;
    seen.add(result.url);
    unique.push(result);
    if (unique.length >= limit) break;
  }
  return unique;
}

/** duckduckgo-search 的 html 后端：GET + result__a/result__snippet 解析。 */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  for (const block of blocks) {
    const anchor = /<a\b[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!anchor) continue;
    const href = /\bhref="([^"]*)"/.exec(anchor[0])?.[1] ?? '';
    const url = decodeDuckDuckGoUrl(href);
    if (!url) continue;
    const snippet = /<a\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    results.push({ title: trimText(anchor[1], 300), url, snippet: trimText(snippet, 500) });
  }
  return dedupe(results, limit);
}

/** duckduckgo-search 的 lite 后端，作为 html 后端的兜底。 */
export function parseDuckDuckGoLite(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const links = [...html.matchAll(/<a\b[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const href = /\bhref=['"]([^'"]*)['"]/.exec(link[0])?.[1] ?? '';
    const url = decodeDuckDuckGoUrl(href);
    if (!url) continue;
    const rest = html.slice(link.index! + link[0].length);
    const snippet = /<td\b[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(rest)?.[1] ?? '';
    results.push({ title: trimText(link[1], 300), url, snippet: trimText(snippet, 500) });
  }
  return dedupe(results, limit);
}

function decodeDuckDuckGoUrl(href: string): string {
  const value = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target && /^https?:\/\//i.test(target)) return target;
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

export function parseBingRss(xml: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '';
    const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '';
    const description = /<description>([\s\S]*?)<\/description>/.exec(block)?.[1] ?? '';
    const url = decodeEntities(link);
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ title: trimText(title, 300), url, snippet: trimText(description, 500) });
  }
  return dedupe(results, limit);
}

async function duckDuckGo(query: string, limit: number, fetchImpl: typeof fetch): Promise<WebSearchResult[]> {
  const region = /[\u3400-\u9fff]/.test(query) ? 'cn-zh' : 'us-en';
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${region}`;
  const response = await safeFetch(endpoint, { headers: BROWSER_HEADERS }, fetchImpl);
  const html = await boundedText(response, 1024 * 1024);
  const results = parseDuckDuckGoHtml(html, limit);
  if (results.length) return results;
  if (/anomaly-modal|challenge-form/i.test(html)) throw new Error('DuckDuckGo returned an anti-bot challenge.');
  const lite = await safeFetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=${region}`, { headers: BROWSER_HEADERS }, fetchImpl);
  return parseDuckDuckGoLite(await boundedText(lite, 1024 * 1024), limit);
}

async function bing(query: string, limit: number, fetchImpl: typeof fetch): Promise<WebSearchResult[]> {
  // Bing RSS 在查询为中文但未指定市场时会返回无关的缓存结果，必须带上匹配的 mkt。
  const market = /[\u3400-\u9fff]/.test(query) ? 'zh-CN' : 'en-US';
  const endpoint = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${limit}&mkt=${market}`;
  const response = await safeFetch(endpoint, { headers: { ...BROWSER_HEADERS, accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' } }, fetchImpl);
  return parseBingRss(await boundedText(response, 1024 * 1024), limit);
}

async function brave(query: string, limit: number, apiKey: string, fetchImpl: typeof fetch): Promise<WebSearchResult[]> {
  const response = await safeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: { accept: 'application/json', 'X-Subscription-Token': apiKey },
  }, fetchImpl);
  const payload = JSON.parse(await boundedText(response, 512 * 1024)) as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> } };
  return dedupe((payload.web?.results ?? []).flatMap((item) => typeof item.url === 'string'
    ? [{ title: trimText(String(item.title ?? ''), 300), url: item.url, snippet: trimText(String(item.description ?? ''), 500) }]
    : []), limit);
}

export async function webSearch(
  query: string,
  options: { engine?: unknown; limit?: unknown; braveApiKey?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<WebSearchResponse> {
  const text = query.normalize('NFKC').trim();
  if (!text || text.length > 500) throw new Error('Search query must be between 1 and 500 characters.');
  const limit = clampLimit(options.limit);
  const selected = normalizeSearchEngine(options.engine);
  const braveKey = typeof options.braveApiKey === 'string' ? options.braveApiKey.trim() : '';
  const order: Array<'duckduckgo' | 'bing' | 'brave'> = selected === 'auto' ? ['duckduckgo', 'bing', ...(braveKey ? ['brave' as const] : [])] : [selected];
  const failures: string[] = [];
  for (const engine of order) {
    if (engine === 'brave' && !braveKey) throw new Error('Brave Search requires brave_api_key in the plugin settings.');
    try {
      const results = engine === 'duckduckgo' ? await duckDuckGo(text, limit, fetchImpl)
        : engine === 'bing' ? await bing(text, limit, fetchImpl)
          : await brave(text, limit, braveKey, fetchImpl);
      if (results.length) return { engine, query: text, results };
      failures.push(`${engine}: no results`);
    } catch (error) {
      failures.push(`${engine}: ${error instanceof Error ? error.message : 'request failed'}`);
      if (selected !== 'auto') throw error;
    }
  }
  throw new Error(`Web search failed (${failures.join('; ')}).`);
}
