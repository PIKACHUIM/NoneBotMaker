import type {
  BotAccountRecord,
  ConversationLog,
  DatabaseSetupStatus,
  GroupRecord,
  LibraryKind,
  LibraryRecord,
  ModelPriceRecord,
  PluginRecord,
  PolicyRecord,
  ProjectMemoryRecord,
  ProviderRecord,
  RoleCardRecord,
} from '../shared/types';

export interface ChatbotConversationSummary { id: string; accountId: string; accountName: string; externalId: string; conversationType: 'group' | 'private'; name: string; enabled: boolean; mode: string }
export interface ChatbotConversationStatus { groupId: string; accountId: string; externalId: string; conversationType: 'group' | 'private'; enabled: boolean; connected: boolean; mode: string; silent: boolean; model: string; providerId: string; contextMessages: number; initialPromptPending: boolean; initialPrompt?: string; disabledTools: string[]; pendingAgentWait: boolean; pendingApprovals: Array<{ id: string; tool: string; status: string; expiresAt: number; requestedBy: string; arguments?: Record<string, unknown> }>; policyIds?: Record<string, string> }
export interface ChatbotWake { id: string; dueAt: number; reason: string }
export interface ChatbotMemeSummary { name: string; contentType: string; size: number; digest: string; createdBy: string; createdAt: string }
export interface ChatbotSlangCandidate { id: string; term: string; context: string; definition: string; meaning?: string; usage?: string; example?: string; risk?: string; sources: string[]; status: 'pending' | 'confirmed' | 'rejected'; hits: number; distinctUsers: number; createdAt: number; updatedAt: number }
export interface ChatbotVoiceSummary { accountId: string; name: string; contentType: string; size: number; digest: string; createdBy: string; createdAt: string }

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    const message = typeof body?.message === 'string'
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : `请求失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function records<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: T[] }).items;
  }
  throw new Error('接口返回格式无效，预期为数组或 { items }');
}

function record<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'item' in payload) {
    return (payload as { item: T }).item;
  }
  return payload as T;
}

function jsonBody(data: unknown): RequestInit {
  return { body: JSON.stringify(data) };
}

function collectionPath(path: string, params?: URLSearchParams): string {
  return params?.size ? `${path}?${params.toString()}` : path;
}

export const api = {
  async setupStatus() {
    return request<DatabaseSetupStatus>('/api/setup/status');
  },
  async initializeDatabase(token: string) {
    return request<DatabaseSetupStatus>('/api/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  },
  async login(password: string) {
    return request<{ authenticated?: boolean }>('/api/auth/login', {
      method: 'POST',
      ...jsonBody({ password }),
    });
  },
  async logout() {
    return request<{ success?: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  async me() {
    return request<{ authenticated?: boolean; user?: { name?: string } }>('/api/auth/me');
  },
  async listPlugins() {
    return records<PluginRecord>(await request('/api/plugins'));
  },
  async savePlugin(data: Partial<PluginRecord> & Pick<PluginRecord, 'name' | 'type'>, id?: string) {
    const payload = await request(id ? `/api/plugins/${encodeURIComponent(id)}` : '/api/plugins', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<PluginRecord>(payload);
  },
  async deletePlugin(id: string) {
    return request(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listAccounts() {
    return records<BotAccountRecord>(await request('/api/accounts'));
  },
  async saveAccount(data: Partial<BotAccountRecord> & Pick<BotAccountRecord, 'pluginId' | 'name'>, id?: string) {
    const payload = await request(id ? `/api/accounts/${encodeURIComponent(id)}` : '/api/accounts', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<BotAccountRecord>(payload);
  },
  async deleteAccount(id: string) {
    return request(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listGroups() {
    return records<GroupRecord>(await request('/api/groups'));
  },
  async listRoleCards(accountId: string) {
    const params = new URLSearchParams({ accountId });
    return records<RoleCardRecord>(await request(collectionPath('/api/role_cards', params)));
  },
  async saveRoleCard(data: Partial<RoleCardRecord> & Pick<RoleCardRecord, 'accountId' | 'name' | 'content'>, id?: string) {
    return record<RoleCardRecord>(await request(collectionPath(id ? `/api/role_cards/${encodeURIComponent(id)}` : '/api/role_cards', new URLSearchParams({ accountId: data.accountId })), { method: id ? 'PUT' : 'POST', ...jsonBody(data) }));
  },
  async deleteRoleCard(accountId: string, id: string) {
    return request(collectionPath(`/api/role_cards/${encodeURIComponent(id)}`, new URLSearchParams({ accountId })), { method: 'DELETE' });
  },
  async listProjectMemories(accountId: string, query?: string) {
    const params = new URLSearchParams({ accountId });
    if (query) params.set('q', query);
    return records<ProjectMemoryRecord>(await request(collectionPath('/api/memories', params)));
  },
  async saveProjectMemory(data: Partial<ProjectMemoryRecord> & Pick<ProjectMemoryRecord, 'accountId' | 'type' | 'name' | 'title' | 'content'>, id?: string) {
    return record<ProjectMemoryRecord>(await request(collectionPath(id ? `/api/memories/${encodeURIComponent(id)}` : '/api/memories', new URLSearchParams({ accountId: data.accountId })), { method: id ? 'PUT' : 'POST', ...jsonBody(data) }));
  },
  async deleteProjectMemory(accountId: string, id: string) {
    return request(collectionPath(`/api/memories/${encodeURIComponent(id)}`, new URLSearchParams({ accountId })), { method: 'DELETE' });
  },
  async listChatbotConversations(accountId?: string) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    return records<ChatbotConversationSummary>(await request(collectionPath('/api/chatbot/conversations', params)));
  },
  async getChatbotConversation(accountId: string, groupId: string, externalId?: string) {
    const params = new URLSearchParams();
    if (externalId) params.set('externalId', externalId);
    return request<ChatbotConversationStatus>(collectionPath(`/api/chatbot/conversations/${encodeURIComponent(accountId)}/${encodeURIComponent(groupId)}`, params));
  },
  async controlChatbotConversation<T = unknown>(accountId: string, groupId: string, control: Record<string, unknown>) {
    return request<T>(`/api/chatbot/conversations/${encodeURIComponent(accountId)}/${encodeURIComponent(groupId)}/control`, { method: 'POST', ...jsonBody(control) });
  },
  async listChatbotApprovals(accountId: string, groupId: string, externalId?: string) {
    const params = new URLSearchParams();
    if (externalId) params.set('externalId', externalId);
    return request<{ items: ChatbotConversationStatus['pendingApprovals'] }>(collectionPath(`/api/chatbot/conversations/${encodeURIComponent(accountId)}/${encodeURIComponent(groupId)}/approvals`, params));
  },
  async saveGroup(data: Partial<GroupRecord> & Pick<GroupRecord, 'accountId' | 'externalId' | 'name'>, id?: string) {
    const payload = await request(id ? `/api/groups/${encodeURIComponent(id)}` : '/api/groups', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<GroupRecord>(payload);
  },
  async deleteGroup(id: string) {
    return request(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listProviders() {
    return records<ProviderRecord>(await request('/api/providers'));
  },
  async saveProvider(data: Partial<ProviderRecord> & Pick<ProviderRecord, 'name' | 'baseUrl'>, id?: string) {
    const payload = await request(id ? `/api/providers/${encodeURIComponent(id)}` : '/api/providers', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<ProviderRecord>(payload);
  },
  async deleteProvider(id: string) {
    return request(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async discoverModels(id: string) {
    const payload = await request<unknown>(`/api/providers/${encodeURIComponent(id)}/models`, { method: 'POST' });
    if (Array.isArray(payload)) return payload.filter((item): item is string => typeof item === 'string');
    if (payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)) {
      return (payload as { models: unknown[] }).models.filter((item): item is string => typeof item === 'string');
    }
    throw new Error('模型接口返回格式无效');
  },
  async listPrices() {
    return records<ModelPriceRecord>(await request('/api/prices'));
  },
  async getPrice(id: string) {
    return record<ModelPriceRecord>(await request(`/api/prices/${encodeURIComponent(id)}`));
  },
  async savePrice(data: Omit<Partial<ModelPriceRecord>, 'cacheInputCostPerMillion'> & Pick<ModelPriceRecord, 'name' | 'model'> & { cacheInputCostPerMillion?: number | null }, id?: string) {
    return record<ModelPriceRecord>(await request(id ? `/api/prices/${encodeURIComponent(id)}` : '/api/prices', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    }));
  },
  async deletePrice(id: string) {
    return request(`/api/prices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listLibraries(kind: LibraryKind) {
    return records<LibraryRecord>(await request(`/api/${kind}`));
  },
  async listPolicies() {
    return records<PolicyRecord>(await request('/api/policies'));
  },
  async savePolicy(data: Partial<PolicyRecord> & Pick<PolicyRecord, 'type' | 'name'>, id?: string) {
    const payload = await request(id ? `/api/policies/${encodeURIComponent(id)}` : '/api/policies', {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<PolicyRecord>(payload);
  },
  async deletePolicy(id: string) {
    return request(`/api/policies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async saveLibrary(kind: LibraryKind, data: Partial<LibraryRecord> & Pick<LibraryRecord, 'name'>, id?: string) {
    const payload = await request(id ? `/api/${kind}/${encodeURIComponent(id)}` : `/api/${kind}`, {
      method: id ? 'PUT' : 'POST',
      ...jsonBody(data),
    });
    return record<LibraryRecord>(payload);
  },
  async deleteLibrary(kind: LibraryKind, id: string) {
    return request(`/api/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listLogs(params: { page: number; pageSize: number; q?: string; pluginId?: string; openid?: string; accountId?: string; groupId?: string; from?: number; to?: number }) {
    const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.q) search.set('q', params.q);
    if (params.pluginId) search.set('pluginId', params.pluginId);
    if (params.openid) search.set('openid', params.openid);
    if (params.accountId) search.set('accountId', params.accountId);
    if (params.groupId) search.set('groupId', params.groupId);
    if (params.from !== undefined) search.set('from', String(params.from));
    if (params.to !== undefined) search.set('to', String(params.to));
    const payload = await request<unknown>(collectionPath('/api/logs', search));
    if (Array.isArray(payload)) return { items: payload as ConversationLog[], total: payload.length, enabled: true };
    if (payload && typeof payload === 'object') {
      const result = payload as { items?: unknown; total?: unknown; enabled?: unknown; loggingEnabled?: unknown };
      if (result.enabled === false || result.loggingEnabled === false) {
        return { items: [] as ConversationLog[], total: 0, enabled: false };
      }
      if (Array.isArray(result.items)) {
        return {
          items: result.items as ConversationLog[],
          total: typeof result.total === 'number' ? result.total : result.items.length,
          enabled: true,
        };
      }
    }
    throw new Error('日志接口返回格式无效，预期为数组或分页对象');
  },
};
