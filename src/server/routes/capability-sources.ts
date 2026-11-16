import { Hono, type Context } from 'hono';
import type { JsonObject, LibraryKind, LibraryRecord, RuntimeBindings } from '../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch } from '../plugins/chatbot/network';
import { createRepository, StorageUnavailableError, type RecordRepository, type StoredRecord } from '../storage/repository';
import { encryptSecrets } from '../storage/secrets';
import { ApiError } from './management';

const MAX_SOURCE_BYTES = 512 * 1024;
const SKILLHUB_ORIGIN = 'https://skills.palebluedot.live';
const SKILLHUB_CN_ORIGIN = 'https://skillhub.cn';
const SKILLHUB_CN_API = 'https://api.skillhub.cn';
const MCP_REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const RULE_REPOSITORY = 'PatrickJS/awesome-cursorrules';
const SKILL_HUBS = ['all', 'palebluedot', 'skillhub-cn'] as const;

interface SourceItem {
  id: string;
  name: string;
  description: string;
  source: string;
  url?: string;
  requiresAuth?: boolean;
  hint?: string;
  category?: string;
  tags?: string[];
  author?: string;
  version?: string;
  downloads?: number;
  stars?: number;
  hub?: string;
  hubName?: string;
  updatedAt?: number;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function isSkillHubUrl(url: URL): boolean {
  return url.hostname === 'skills.palebluedot.live' || url.hostname === 'claudeskillhub.com';
}

function isCnSkillHubUrl(url: URL): boolean {
  return ['skillhub.cn', 'www.skillhub.cn', 'skillhub.tencent.com', 'api.skillhub.cn'].includes(url.hostname);
}

function cnSkillSlug(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part === 'skill' || part === 'skills');
  if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]);
  const last = parts.at(-1);
  return last && !['api', 'v1', 'skills', 'skill'].includes(last) ? decodeURIComponent(last) : null;
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function compactMetric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^([\d.]+)\s*([kKmM]?)/.exec(value.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return undefined;
  const scale = match[2].toLowerCase() === 'm' ? 1_000_000 : match[2].toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(number * scale);
}

async function fetchJson<T>(value: string): Promise<T> {
  const response = await safeFetch(value, { headers: { accept: 'application/json' } }, fetch, 20_000, 3);
  try { return JSON.parse(await boundedText(response, MAX_SOURCE_BYTES)) as T; }
  catch { throw new ApiError(502, 'source_response_invalid'); }
}

let cnCategoryCache: { at: number; map: Map<string, string> } | null = null;
async function cnCategoryNames(): Promise<Map<string, string>> {
  if (cnCategoryCache && Date.now() - cnCategoryCache.at < 60 * 60_000) return cnCategoryCache.map;
  const payload = await fetchJson<{ items?: Array<{ key?: unknown; name?: unknown }> }>(`${SKILLHUB_CN_API}/api/v1/categories`);
  const map = new Map<string, string>();
  for (const item of payload.items ?? []) {
    if (typeof item.key === 'string') map.set(item.key, typeof item.name === 'string' ? item.name : item.key);
  }
  cnCategoryCache = { at: Date.now(), map };
  return map;
}

interface CnSkillSummary {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  description_zh?: unknown;
  category?: unknown;
  tags?: unknown;
  ownerName?: unknown;
  version?: unknown;
  downloads?: unknown;
  stars?: unknown;
  updated_at?: unknown;
}

async function searchCnSkills(query: string): Promise<SourceItem[]> {
  const params = new URLSearchParams({ page: '1', pageSize: '24', sortBy: query ? 'score' : 'downloads', order: 'desc' });
  if (query) params.set('keyword', query);
  const payload = await fetchJson<{ code?: number; data?: { skills?: CnSkillSummary[] } }>(`${SKILLHUB_CN_API}/api/skills?${params.toString()}`);
  if (payload.code !== 0 || !Array.isArray(payload.data?.skills)) return [];
  const categories = await cnCategoryNames().catch(() => new Map<string, string>());
  return payload.data.skills.flatMap((skill) => {
    if (typeof skill.slug !== 'string' || !skill.slug || typeof skill.name !== 'string') return [];
    const slug = skill.slug;
    const categoryKey = typeof skill.category === 'string' ? skill.category : '';
    return [{
      id: `cn:${slug}`,
      name: skill.name.slice(0, 200),
      description: text(typeof skill.description_zh === 'string' ? skill.description_zh : skill.description, 800),
      source: `${SKILLHUB_CN_ORIGIN}/skills/${encodeURIComponent(slug)}`,
      url: `${SKILLHUB_CN_ORIGIN}/skills/${encodeURIComponent(slug)}`,
      category: categories.get(categoryKey) ?? categoryKey,
      tags: Array.isArray(skill.tags) ? skill.tags.filter((tag): tag is string => typeof tag === 'string' && tag.toLowerCase() !== 'latest').slice(0, 8) : [],
      ...(typeof skill.ownerName === 'string' ? { author: skill.ownerName } : {}),
      ...(typeof skill.version === 'string' ? { version: skill.version } : {}),
      ...(typeof skill.downloads === 'number' ? { downloads: skill.downloads } : {}),
      ...(typeof skill.stars === 'number' ? { stars: skill.stars } : {}),
      ...(typeof skill.updated_at === 'number' ? { updatedAt: skill.updated_at } : {}),
      hub: 'skillhub-cn',
      hubName: 'SkillHub 国内',
    } satisfies SourceItem];
  });
}

function originalSkillCards(html: string): SourceItem[] {
  const items: SourceItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = match[1];
    if (!/class="[^"]*sh-skill-card/i.test(attrs)) continue;
    const href = /href="([^"]+)"/.exec(attrs)?.[1];
    if (!href || !href.startsWith('/en/skill/')) continue;
    const body = match[2];
    if (seen.has(href)) continue;
    seen.add(href);
    const owner = stripHtml(/<span class="owner">([\s\S]*?)<\/span>/i.exec(body)?.[1] ?? '');
    const name = stripHtml(/<span class="name">([\s\S]*?)<\/span>/i.exec(body)?.[1] ?? '') || href.split('/').at(-1) || href;
    const description = stripHtml(/<p class="desc"[^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1] ?? '');
    const metrics = [...body.matchAll(/<span class="ltr-nums">([^<]*)<\/span>/g)].map((entry) => entry[1]);
    items.push({
      id: `pbd:${href.slice('/en/skill/'.length)}`,
      name: name.slice(0, 200),
      description: description.slice(0, 800),
      source: `${SKILLHUB_ORIGIN}${href}`,
      url: `${SKILLHUB_ORIGIN}${href}`,
      ...(owner ? { author: owner } : {}),
      ...(compactMetric(metrics[0]) !== undefined ? { downloads: compactMetric(metrics[0]) } : {}),
      ...(compactMetric(metrics[1]) !== undefined ? { stars: compactMetric(metrics[1]) } : {}),
      hub: 'palebluedot',
      hubName: 'SkillHub 原版',
    });
    if (items.length >= 24) break;
  }
  return items;
}

async function searchOriginalSkills(query: string): Promise<SourceItem[]> {
  const url = `${SKILLHUB_ORIGIN}/en/browse${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  return originalSkillCards(await fetchText(url));
}

function parseSkillHubPage(html: string): { content: string } | null {
  const marker = /<h2[^>]*>\s*SKILL\.md Content\s*<\/h2>([\s\S]{0,40_000}?)<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>/i.exec(html);
  if (marker) return { content: decodeHtml(marker[2]).trim() };
  const fenced = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i.exec(html);
  if (fenced && /(?:^|\n)---\s*\n[\s\S]*?name:/i.test(decodeHtml(fenced[1]))) {
    return { content: decodeHtml(fenced[1]).trim() };
  }
  return null;
}

function frontmatter(content: string): { name?: string; displayName?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const read = (key: string) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'mi').exec(match[1]);
    if (!found) return undefined;
    let value = found[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.trim() || undefined;
  };
  return { name: read('name'), displayName: read('displayName'), description: read('description') };
}

function slugFromPath(value: string): string {
  const parts = value.split(/[?#]/)[0].split('/').filter(Boolean);
  return parts.at(-1)?.replace(/\.(?:mdc|md)$/i, '') || 'imported-skill';
}

function githubParts(source: string): { owner: string; repo: string; path: string; branch?: string } | null {
  const raw = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.+))?$/.exec(source.trim());
  if (!raw) return null;
  return { owner: raw[1], repo: raw[2], path: (raw[3] ?? '').replace(/^\/+|\/+$/g, '') };
}

function parseGithubUrl(url: URL): { owner: string; repo: string; path: string; branch?: string } | null {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, mode, branch, ...rest] = parts;
  if (mode === 'tree' || mode === 'blob') return { owner, repo: repo.replace(/\.git$/i, ''), branch, path: rest.join('/') };
  return { owner, repo: repo.replace(/\.git$/i, ''), path: '' };
}

async function fetchText(value: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await safeFetch(value, { headers: { accept: 'text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5' } }, fetchImpl, 20_000, 3);
  return boundedText(response, MAX_SOURCE_BYTES);
}

async function fetchGithubSkill(parts: { owner: string; repo: string; path: string; branch?: string }): Promise<string | null> {
  const base = parts.path.replace(/^\/+|\/+$/g, '');
  const candidates: string[] = [];
  const branches = parts.branch ? [parts.branch] : ['main', 'master'];
  for (const branch of branches) {
    const prefix = `https://raw.githubusercontent.com/${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.repo)}/${encodeURIComponent(branch)}`;
    candidates.push(base ? `${prefix}/${base.split('/').map(encodeURIComponent).join('/')}` : `${prefix}/SKILL.md`);
    if (base && !base.toLowerCase().endsWith('skill.md')) candidates.push(`${prefix}/${base.split('/').map(encodeURIComponent).join('/')}/SKILL.md`);
  }
  for (const candidate of candidates) {
    try {
      const content = await fetchText(candidate);
      if (content.trim()) return content;
    } catch { /* try the next branch or layout */ }
  }
  return null;
}

interface CnSkillDetail {
  skill?: {
    displayName?: unknown;
    summary?: unknown;
    summary_zh?: unknown;
    category?: unknown;
    tags?: unknown;
    stats?: { downloads?: unknown; stars?: unknown };
  };
  latestVersion?: { version?: unknown };
  owner?: { displayName?: unknown; handle?: unknown };
}

async function loadCnSkill(slug: string): Promise<{ content: string; sourceUrl: string; meta: JsonObject }> {
  const detail = await fetchJson<CnSkillDetail>(`${SKILLHUB_CN_API}/api/v1/skills/${encodeURIComponent(slug)}`).catch(() => null);
  const files = await fetchJson<{ files?: Array<{ path?: unknown }> }>(`${SKILLHUB_CN_API}/api/v1/skills/${encodeURIComponent(slug)}/files`).catch(() => null);
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  for (const file of files?.files ?? []) {
    if (typeof file.path === 'string' && /(^|\/)SKILL\.md$/i.test(file.path)) add(file.path);
  }
  add('SKILL.md');
  add('skill.md');
  add('README.md');
  for (const path of candidates.slice(0, 8)) {
    try {
      const content = await fetchText(`${SKILLHUB_CN_API}/api/v1/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`);
      if (!content.trim()) continue;
      const skill = detail?.skill;
      const categoryKey = typeof skill?.category === 'string' ? skill.category : '';
      const categories = categoryKey ? await cnCategoryNames().catch(() => new Map<string, string>()) : new Map<string, string>();
      const meta: JsonObject = {
        hub: 'skillhub-cn',
        ...(typeof skill?.displayName === 'string' ? { title: skill.displayName } : {}),
        ...(typeof skill?.summary_zh === 'string' ? { description: skill.summary_zh } : typeof skill?.summary === 'string' ? { description: skill.summary } : {}),
        ...(categoryKey ? { category: categories.get(categoryKey) ?? categoryKey } : {}),
        ...(skill?.tags && typeof skill.tags === 'object' && !Array.isArray(skill.tags) ? { tags: Object.keys(skill.tags).filter((tag) => tag.toLowerCase() !== 'latest') } : {}),
        ...(typeof detail?.owner?.displayName === 'string' ? { author: detail.owner.displayName } : typeof detail?.owner?.handle === 'string' ? { author: detail.owner.handle } : {}),
        ...(typeof detail?.latestVersion?.version === 'string' ? { version: detail.latestVersion.version } : {}),
        ...(typeof skill?.stats?.downloads === 'number' ? { downloads: skill.stats.downloads } : {}),
        ...(typeof skill?.stats?.stars === 'number' ? { stars: skill.stats.stars } : {}),
      };
      return { content, sourceUrl: `${SKILLHUB_CN_ORIGIN}/skills/${encodeURIComponent(slug)}`, meta };
    } catch { /* try the next candidate */ }
  }
  throw new ApiError(404, 'skill_not_found');
}

async function loadSkillSource(source: string): Promise<{ content: string; sourceUrl: string; slug: string; meta?: JsonObject }> {
  const trimmed = source.trim();
  if (!trimmed) throw new ApiError(400, 'source_required');
  let url: URL | null = null;
  try { url = new URL(trimmed); } catch { url = null; }

  if (url && isCnSkillHubUrl(url)) {
    const slug = cnSkillSlug(url);
    if (!slug) throw new ApiError(400, 'invalid_skill_source');
    const loaded = await loadCnSkill(slug);
    return { content: loaded.content, sourceUrl: loaded.sourceUrl, slug, meta: loaded.meta };
  }
  if (url && isSkillHubUrl(url)) {
    const html = await fetchText(url.toString());
    const parsed = parseSkillHubPage(html);
    if (!parsed) throw new ApiError(502, 'skillhub_content_not_found');
    return { content: parsed.content, sourceUrl: url.toString(), slug: slugFromPath(url.pathname) };
  }
  if (url && /raw\.githubusercontent\.com$/i.test(url.hostname)) {
    const content = await fetchText(url.toString());
    return { content, sourceUrl: url.toString(), slug: slugFromPath(url.pathname) };
  }
  if (url && /^https?:$/.test(url.protocol)) {
    const github = parseGithubUrl(url);
    if (github) {
      const content = await fetchGithubSkill(github);
      if (!content) throw new ApiError(404, 'skill_not_found');
      return { content, sourceUrl: url.toString(), slug: slugFromPath(github.path) };
    }
    const content = await fetchText(url.toString());
    return { content, sourceUrl: url.toString(), slug: slugFromPath(url.pathname) };
  }
  const github = githubParts(trimmed);
  if (github) {
    const content = await fetchGithubSkill(github);
    if (content) {
      return { content, sourceUrl: `https://github.com/${github.owner}/${github.repo}${github.path ? `/${github.path}` : ''}`, slug: slugFromPath(github.path) };
    }
    // SkillHub slugs are not always literal repository paths; resolve the catalog page as a fallback.
    try {
      const page = await fetchText(`${SKILLHUB_ORIGIN}/en/skill/${github.owner}/${github.repo}/${github.path}`.replace(/\/+$/, ''));
      const parsed = parseSkillHubPage(page);
      if (parsed) {
        return { content: parsed.content, sourceUrl: `${SKILLHUB_ORIGIN}/en/skill/${github.owner}/${github.repo}/${github.path}`.replace(/\/+$/, ''), slug: slugFromPath(github.path) };
      }
    } catch { /* report the original not-found result */ }
    throw new ApiError(404, 'skill_not_found');
  }
  throw new ApiError(400, 'invalid_skill_source');
}

async function repository(context: Context<{ Bindings: RuntimeBindings }>): Promise<RecordRepository> {
  try { return createRepository(context.env); }
  catch (error) {
    if (error instanceof StorageUnavailableError) throw new ApiError(503, 'storage_unavailable');
    throw error;
  }
}

async function uniqueName(repo: RecordRepository, kind: LibraryKind, preferred: string): Promise<string> {
  const existing = new Set((await repo.list(kind)).map((record) => String(record.name).toLowerCase()));
  const base = preferred.trim().slice(0, 200) || 'imported';
  if (!existing.has(base.toLowerCase())) return base;
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  throw new ApiError(409, 'too_many_duplicate_names');
}

async function saveLibrary(context: Context<{ Bindings: RuntimeBindings }>, kind: LibraryKind, input: {
  name: string;
  description: string;
  config: JsonObject;
}): Promise<LibraryRecord> {
  const repo = await repository(context);
  const now = new Date().toISOString();
  const record: LibraryRecord = {
    id: crypto.randomUUID(),
    name: await uniqueName(repo, kind, input.name),
    description: input.description.slice(0, 1000),
    enabled: true,
    config: input.config,
    createdAt: now,
    updatedAt: now,
  };
  await repo.put(kind, await encryptSecrets(record as unknown as JsonObject, undefined, context.env) as unknown as StoredRecord);
  return record;
}

function skillRecord(content: string, name: string, description: string, sourceUrl: string, meta?: JsonObject): { name: string; description: string; config: JsonObject } {
  return {
    name: name.slice(0, 200),
    description: description.slice(0, 1000),
    config: {
      prompt: description.slice(0, 4000),
      content: content.slice(0, MAX_SOURCE_BYTES),
      sourceUrl,
      ...(meta && Object.keys(meta).length ? { sourceMeta: meta } : {}),
    },
  };
}

async function searchSkills(query: string, hub = 'all'): Promise<SourceItem[]> {
  if (!SKILL_HUBS.includes(hub as typeof SKILL_HUBS[number])) throw new ApiError(400, 'invalid_skill_hub');
  const searches = hub === 'all'
    ? [searchOriginalSkills(query), searchCnSkills(query)]
    : hub === 'palebluedot' ? [searchOriginalSkills(query)] : [searchCnSkills(query)];
  const settled = await Promise.allSettled(searches);
  const items = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!items.length) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return items.slice(0, 40);
}

interface RegistryServer {
  server?: {
    name?: unknown;
    description?: unknown;
    remotes?: Array<{ type?: unknown; url?: unknown; headers?: Array<{ name?: unknown; isRequired?: unknown; isSecret?: unknown }> }>;
    repository?: { url?: unknown };
  };
}

async function searchMcps(query: string): Promise<SourceItem[]> {
  const params = new URLSearchParams({ limit: '20' });
  if (query) params.set('search', query);
  const response = await safeFetch(`${MCP_REGISTRY}?${params.toString()}`, { headers: { accept: 'application/json' } }, fetch, 20_000, 3);
  let payload: unknown;
  try { payload = JSON.parse(await boundedText(response, MAX_SOURCE_BYTES)); }
  catch { throw new ApiError(502, 'mcp_registry_invalid'); }
  const servers = (payload as { servers?: RegistryServer[] }).servers;
  if (!Array.isArray(servers)) return [];
  const items: SourceItem[] = [];
  const seen = new Set<string>();
  for (const entry of servers) {
    const server = entry.server;
    if (!server || typeof server.name !== 'string') continue;
    const remote = (server.remotes ?? []).find((item) => (item.type === 'streamable-http' || item.type === 'sse') && typeof item.url === 'string');
    if (!remote || typeof remote.url !== 'string') continue;
    if (seen.has(`${server.name}|${remote.url}`)) continue;
    seen.add(`${server.name}|${remote.url}`);
    const requiresAuth = (remote.headers ?? []).some((header) => header.isRequired === true || header.isSecret === true);
    items.push({
      id: server.name,
      name: server.name,
      description: typeof server.description === 'string' ? server.description.slice(0, 500) : '',
      source: remote.url,
      url: remote.url,
      requiresAuth,
      ...(requiresAuth ? { hint: '该服务需要访问令牌；导入后在 MCP 编辑页填写。' } : {}),
    });
    if (items.length >= 20) break;
  }
  return items;
}

let ruleCache: { at: number; items: Array<{ name: string; download: string }> } | null = null;

async function loadRuleIndex(): Promise<Array<{ name: string; download: string }>> {
  if (ruleCache && Date.now() - ruleCache.at < 10 * 60_000) return ruleCache.items;
  // The repository README is a stable, small index and avoids GitHub API rate limits.
  const response = await safeFetch(`https://raw.githubusercontent.com/${RULE_REPOSITORY}/main/README.md`, {
    headers: { accept: 'text/plain,text/markdown' },
  }, fetch, 20_000, 3);
  const markdown = await boundedText(response, MAX_SOURCE_BYTES);
  const items: Array<{ name: string; download: string }> = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(https:\/\/github\.com\/PatrickJS\/awesome-cursorrules\/blob\/main\/rules\/([^)\s]+?\.mdc)\)/g)) {
    const file = match[2];
    if (seen.has(file)) continue;
    seen.add(file);
    items.push({
      name: file.replace(/\.mdc$/i, ''),
      download: `https://raw.githubusercontent.com/${RULE_REPOSITORY}/main/rules/${file.split('/').map(encodeURIComponent).join('/')}`,
    });
  }
  if (!items.length) throw new ApiError(502, 'rule_source_empty');
  ruleCache = { at: Date.now(), items };
  return items;
}

async function searchRules(query: string): Promise<SourceItem[]> {
  const items = await loadRuleIndex();
  const normalized = query.trim().toLowerCase();
  return items
    .filter((item) => !normalized || item.name.toLowerCase().includes(normalized))
    .slice(0, 30)
    .map((item) => ({ id: item.name, name: item.name, description: `cursorrules / ${item.name}`, source: item.download, url: `https://github.com/${RULE_REPOSITORY}` }));
}

async function importRule(source: string): Promise<{ name: string; description: string; config: JsonObject }> {
  const trimmed = source.trim();
  let content: string;
  let sourceUrl = trimmed;
  let name = '';
  let url: URL | null = null;
  try { url = new URL(trimmed); } catch { url = null; }
  if (url && /github\.com$/i.test(url.hostname) || url && /raw\.githubusercontent\.com$/i.test(url.hostname)) {
    const github = parseGithubUrl(url);
    if (github) {
      const candidate = `https://raw.githubusercontent.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/${encodeURIComponent(github.branch ?? 'main')}/${github.path.split('/').map(encodeURIComponent).join('/')}`;
      content = await fetchText(candidate);
      name = slugFromPath(github.path);
      sourceUrl = candidate;
    } else {
      content = await fetchText(trimmed);
      name = slugFromPath(url.pathname);
    }
  } else if (url && /^https?:$/.test(url.protocol)) {
    content = await fetchText(trimmed);
    name = slugFromPath(url.pathname);
  } else {
    const github = githubParts(trimmed);
    if (!github) throw new ApiError(400, 'invalid_rule_source');
    const prefix = `https://raw.githubusercontent.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}`;
    const path = github.path.split('/').map(encodeURIComponent).join('/');
    content = await fetchText(`${prefix}/main/${path}`);
    name = slugFromPath(github.path);
  }
  if (!content.trim()) throw new ApiError(400, 'empty_rule');
  return {
    name: name || 'imported-rule',
    description: `从在线源导入的规则（${content.length} 字符）`,
    config: { content: content.slice(0, MAX_SOURCE_BYTES), sourceUrl },
  };
}

export function registerCapabilitySourceRoutes(api: Hono<{ Bindings: RuntimeBindings }>): void {
  api.get('/capability-sources/skills/search', async (context) => {
    try { return context.json({ data: await searchSkills(context.req.query('q')?.trim() ?? '', context.req.query('hub')?.trim() || 'all') }); }
    catch (error) { return sourceFailure(context, error); }
  });

  api.post('/capability-sources/skills/import', async (context) => {
    try {
      const body = await context.req.json() as JsonObject;
      const loaded = await loadSkillSource(String(body.source ?? ''));
      const meta = frontmatter(loaded.content);
      const metaTitle = text(loaded.meta?.title, 200);
      const metaDescription = text(loaded.meta?.description, 1000);
      const imported = skillRecord(
        loaded.content,
        meta.displayName ?? meta.name ?? (metaTitle || loaded.slug),
        meta.description ?? (metaDescription || `从 SkillHub 导入的 ${loaded.slug} 技能。`),
        loaded.sourceUrl,
        loaded.meta,
      );
      const record = await saveLibrary(context, 'skills', imported);
      return context.json({ data: record }, 201);
    } catch (error) { return sourceFailure(context, error); }
  });

  api.get('/capability-sources/mcps/search', async (context) => {
    try { return context.json({ data: await searchMcps(context.req.query('q')?.trim() ?? '') }); }
    catch (error) { return sourceFailure(context, error); }
  });

  api.post('/capability-sources/mcps/import', async (context) => {
    try {
      const body = await context.req.json() as JsonObject;
      const rawName = text(body.name, 200);
      const rawUrl = text(body.url, 2048);
      if (!rawName || !rawUrl) throw new ApiError(400, 'name_and_url_required');
      const url = publicHttpsUrl(rawUrl);
      const authToken = text(body.authToken, 4096).replace(/^Bearer\s+/i, '');
      const record = await saveLibrary(context, 'mcps', {
        name: rawName,
        description: text(body.description, 1000) || '从 MCP 官方 Registry 导入的远端服务。',
        config: { url: url.toString(), ...(authToken ? { authToken } : {}), source: 'mcp-registry' },
      });
      return context.json({ data: record }, 201);
    } catch (error) { return sourceFailure(context, error); }
  });

  api.get('/capability-sources/rules/search', async (context) => {
    try { return context.json({ data: await searchRules(context.req.query('q')?.trim() ?? '') }); }
    catch (error) { return sourceFailure(context, error); }
  });

  api.post('/capability-sources/rules/import', async (context) => {
    try {
      const body = await context.req.json() as JsonObject;
      const imported = await importRule(String(body.source ?? ''));
      const record = await saveLibrary(context, 'rules', imported);
      return context.json({ data: record }, 201);
    } catch (error) { return sourceFailure(context, error); }
  });
}

function sourceFailure(context: Context<{ Bindings: RuntimeBindings }>, error: unknown): Response {
  if (error instanceof ApiError) return context.json({ error: error.code }, error.status);
  const message = error instanceof Error ? error.message : 'source_unavailable';
  console.error('capability source request failed', message);
  const status = /404|not found/i.test(message) ? 404 : /timed? out|timeout/i.test(message) ? 504 : 502;
  return context.json({ error: message.slice(0, 300) }, status as 400);
}
