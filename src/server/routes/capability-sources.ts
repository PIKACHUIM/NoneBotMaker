import { Hono, type Context } from 'hono';
import type { JsonObject, LibraryKind, LibraryRecord, RuntimeBindings } from '../../shared/types';
import { boundedText, publicHttpsUrl, safeFetch } from '../plugins/chatbot/network';
import { createRepository, StorageUnavailableError, type RecordRepository, type StoredRecord } from '../storage/repository';
import { encryptSecrets } from '../storage/secrets';
import { ApiError } from './management';

const MAX_SOURCE_BYTES = 512 * 1024;
const SKILLHUB_ORIGIN = 'https://skills.palebluedot.live';
const MCP_REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const RULE_REPOSITORY = 'PatrickJS/awesome-cursorrules';

interface SourceItem {
  id: string;
  name: string;
  description: string;
  source: string;
  url?: string;
  requiresAuth?: boolean;
  hint?: string;
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

function parseSkillHubPage(html: string): { content: string } | null {
  const marker = /<h2[^>]*>\s*SKILL\.md Content\s*<\/h2>([\s\S]{0,40_000}?)<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>/i.exec(html);
  if (marker) return { content: decodeHtml(marker[2]).trim() };
  const fenced = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i.exec(html);
  if (fenced && /(?:^|\n)---\s*\n[\s\S]*?name:/i.test(decodeHtml(fenced[1]))) {
    return { content: decodeHtml(fenced[1]).trim() };
  }
  return null;
}

function frontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const read = (key: string) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'mi').exec(match[1]);
    if (!found) return undefined;
    let value = found[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.trim() || undefined;
  };
  return { name: read('name'), description: read('description') };
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

async function loadSkillSource(source: string): Promise<{ content: string; sourceUrl: string; slug: string }> {
  const trimmed = source.trim();
  if (!trimmed) throw new ApiError(400, 'source_required');
  let url: URL | null = null;
  try { url = new URL(trimmed); } catch { url = null; }

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

function skillRecord(content: string, name: string, description: string, sourceUrl: string): { name: string; description: string; config: JsonObject } {
  return {
    name: name.slice(0, 200),
    description: description.slice(0, 1000),
    config: { prompt: description.slice(0, 4000), content: content.slice(0, MAX_SOURCE_BYTES), sourceUrl },
  };
}

async function searchSkills(query: string): Promise<SourceItem[]> {
  const url = `${SKILLHUB_ORIGIN}/en/browse${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  const html = await fetchText(url);
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  for (const match of html.matchAll(/href="(\/en\/skill\/[^"?#]+)"/g)) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const slug = path.replace(/^\/en\/skill\//, '');
    const name = slug.split('/').at(-1) ?? slug;
    items.push({
      id: slug,
      name,
      description: slug,
      source: `${SKILLHUB_ORIGIN}${path}`,
      url: `${SKILLHUB_ORIGIN}${path}`,
    });
    if (items.length >= 24) break;
  }
  return items;
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
    try { return context.json({ data: await searchSkills(context.req.query('q')?.trim() ?? '') }); }
    catch (error) { return sourceFailure(context, error); }
  });

  api.post('/capability-sources/skills/import', async (context) => {
    try {
      const body = await context.req.json() as JsonObject;
      const loaded = await loadSkillSource(String(body.source ?? ''));
      const meta = frontmatter(loaded.content);
      const imported = skillRecord(loaded.content, meta.name ?? loaded.slug, meta.description ?? `从 SkillHub 导入的 ${loaded.slug} 技能。`, loaded.sourceUrl);
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
