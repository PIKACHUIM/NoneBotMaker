import { Hono, type Context } from 'hono';
import type { GroupRecord, MemoryType, RuntimeBindings } from '../../shared/types';
import { conversationIdList, matchesConversationId, primaryConversationId } from '../../shared/plugin-catalog';
import { createConversationMemoryRepository, type ConversationMemoryScope } from '../storage/conversation-memory-repository';
import { createRepository } from '../storage/repository';
import { ApiError } from './management';
import { KNOWLEDGE_LIMITS } from '../plugins/chatbot/knowledge';

const BASE = '/chatbot/conversations/:accountId/:groupId/memories';
type Api = Hono<{ Bindings: RuntimeBindings }>;
type ApiContext = Context<{ Bindings: RuntimeBindings }>;

function valid(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, `invalid_${field}`);
  return value.trim();
}

async function contextFor(api: ApiContext): Promise<{
  scope: ConversationMemoryScope; policy: { maxEntries: number; retentionDays: number };
}> {
  const accountId = valid(api.req.param('accountId'), 'accountId');
  const groupId = valid(api.req.param('groupId'), 'groupId');
  const repository = createRepository(api.env);
  const group = await repository.get('groups', groupId) as unknown as GroupRecord | null;
  const account = await repository.get('accounts', accountId);
  if (!account || !group || group.accountId !== accountId) throw new ApiError(404, 'not_found');
  if (!api.req.query('externalId') && conversationIdList(group.externalId).length > 1) throw new ApiError(400, 'externalId_required');
  const externalId = valid(api.req.query('externalId') ?? primaryConversationId(group.externalId), 'externalId');
  if (!matchesConversationId(group.externalId, externalId)) throw new ApiError(404, 'not_found');
  if (!api.env.DB) throw new ApiError(503, 'memory_storage_unavailable');
  if (!group.memoryPolicyId) throw new ApiError(409, 'memory_policy_unavailable');
  const selected = await repository.get('policies', group.memoryPolicyId);
  if (!selected || selected.type !== 'memory' || selected.enabled !== true || !selected.config || typeof selected.config !== 'object') throw new ApiError(409, 'memory_policy_unavailable');
  const config = selected.config as Record<string, unknown>;
  const maxEntries = config.maxEntries ?? 100;
  const retentionDays = config.retentionDays ?? 7;
  if (!Number.isSafeInteger(maxEntries) || (maxEntries as number) < 1 || (maxEntries as number) > 1000 ||
      !Number.isSafeInteger(retentionDays) || (retentionDays as number) < 1 || (retentionDays as number) > 365) throw new ApiError(409, 'invalid_memory_policy');
  return { scope: { accountId, groupId, conversationType: group.conversationType ?? 'group', externalId },
    policy: { maxEntries: maxEntries as number, retentionDays: retentionDays as number } };
}

function memoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new ApiError(400, 'invalid_memory_name');
  return value;
}

async function bodyOf(api: ApiContext): Promise<Record<string, unknown>> {
  const length = Number(api.req.header('content-length'));
  if (length > 128_000) throw new ApiError(400, 'memory_request_too_large');
  let body: unknown;
  try { body = await api.req.json(); } catch { throw new ApiError(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 50_000) throw new ApiError(400, 'invalid_memory');
  return body as Record<string, unknown>;
}

function writable(input: Record<string, unknown>, partial = false) {
  const fields = ['name', 'title', 'description', 'content', 'type', 'status'];
  if (Object.keys(input).some((key) => !fields.includes(key)) || partial && (Object.hasOwn(input, 'name') || Object.keys(input).length === 0)) throw new ApiError(400, 'invalid_memory');
  if (input.name !== undefined) memoryName(input.name);
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > KNOWLEDGE_LIMITS.title || /[\r\n]/.test(input.title))) throw new ApiError(400, 'invalid_memory_title');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > KNOWLEDGE_LIMITS.description || /[\r\n]/.test(input.description))) throw new ApiError(400, 'invalid_memory_description');
  if (input.content !== undefined) valid(input.content, 'memory_content', KNOWLEDGE_LIMITS.memoryContent);
  if (input.type !== undefined && !['user', 'feedback', 'project', 'reference'].includes(input.type as string) ||
      input.status !== undefined && !['pending', 'confirmed'].includes(input.status as string)) throw new ApiError(400, 'invalid_memory');
  if (!partial && (!input.name || !input.title || !input.content || !input.type || !input.status)) throw new ApiError(400, 'invalid_memory');
  return input as { name: string; title: string; description?: string; content: string; type: MemoryType; status: 'pending' | 'confirmed' };
}

/** Register under the existing authenticated /chatbot guard in routes/index.ts. */
export function registerChatbotMemoryRoutes(api: Api): void {
  api.get(BASE, async (context) => {
    const { scope } = await contextFor(context);
    return context.json({ data: { items: await createConversationMemoryRepository(context.env).list(scope) } });
  });
  api.post(BASE, async (context) => {
    const { scope, policy } = await contextFor(context);
    const record = writable(await bodyOf(context));
    const repo = createConversationMemoryRepository(context.env);
    try {
      const created = await repo.createIfMissing(scope, record, policy);
      if (!created) throw new ApiError(409, await repo.get(scope, record.name) ? 'memory_already_exists' : 'memory_capacity_reached');
      return context.json({ data: created }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes('capacity')) throw new ApiError(409, 'memory_capacity_reached');
      throw error;
    }
  });
  api.get(`${BASE}/:name`, async (context) => {
    const { scope } = await contextFor(context);
    const item = await createConversationMemoryRepository(context.env).get(scope, memoryName(context.req.param('name')));
    if (!item) throw new ApiError(404, 'not_found');
    return context.json({ data: item });
  });
  api.patch(`${BASE}/:name`, async (context) => {
    const { scope, policy } = await contextFor(context);
    const changes = writable(await bodyOf(context), true);
    const item = await createConversationMemoryRepository(context.env).update(scope, memoryName(context.req.param('name')), changes, policy);
    if (!item) throw new ApiError(404, 'not_found');
    return context.json({ data: item });
  });
  api.delete(`${BASE}/:name`, async (context) => {
    const { scope } = await contextFor(context);
    const deleted = await createConversationMemoryRepository(context.env).delete(scope, memoryName(context.req.param('name')));
    if (!deleted) throw new ApiError(404, 'not_found');
    return context.json({ data: { deleted: true } });
  });
  api.post(`${BASE}/:name/approve`, async (context) => {
    const { scope, policy } = await contextFor(context);
    const repo = createConversationMemoryRepository(context.env);
    const name = memoryName(context.req.param('name'));
    const original = await repo.get(scope, name);
    if (!original) throw new ApiError(404, 'not_found');
    if (original.status !== 'pending') throw new ApiError(409, 'memory_not_pending');
    const approved = await repo.updateIfUnchanged(scope, name, { status: 'confirmed' }, original.updatedAt, policy, Date.now(),
      { id: original.id, status: 'pending', content: original.content });
    if (!approved) throw new ApiError(409, 'memory_changed_concurrently');
    return context.json({ data: approved });
  });
}
