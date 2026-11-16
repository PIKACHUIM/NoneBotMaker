import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupRecord, RuntimeBindings, ScheduleRecord } from '../../shared/types';

const state = vi.hoisted(() => {
  const stored = new Map<string, Record<string, unknown>>();
  return {
    stored,
    group: { id: 'group-1', accountId: 'account-1', externalId: 'group-openid', name: 'Test', enabled: true,
      conversationType: 'group', config: { bridge_owner_ids: 'owner' } } as unknown as GroupRecord,
    reply: vi.fn(async () => undefined),
    resolveAccount: vi.fn(async () => ({ account: { id: 'account-1' }, protocol: 'qq', appId: 'app', credentials: {}, pluginEnabled: true })),
  };
});

vi.mock('../storage/repository', () => ({
  createRepository: () => ({
    consistency: 'eventual',
    async list(kind: string) { return kind === 'schedules' ? [...state.stored.values()] : []; },
    async get(kind: string, id: string) { return kind === 'groups' && id === 'group-1' ? state.group : kind === 'schedules' ? state.stored.get(id) ?? null : null; },
    async put(kind: string, record: Record<string, unknown>) { if (kind === 'schedules') state.stored.set(String(record.id), record); },
    async delete() { return undefined; },
  }),
}));
vi.mock('../storage/secrets', () => ({ decryptSecrets: async (value: unknown) => value }));
vi.mock('../protocols/accounts', () => ({ resolveChatAccountById: state.resolveAccount }));
vi.mock('../protocols/sender', () => ({
  sendProactiveChatText: state.reply,
  sendChatText: vi.fn(async () => undefined),
  sendChatMedia: vi.fn(async () => undefined),
}));

import { runDueSchedules, runSchedule } from './schedules';

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  const at = 1_800_000_000_000;
  return {
    id: 'schedule-1', name: 'Daily', description: '', enabled: true,
    config: { cron: '* * * * *', timezone: 'UTC', groupId: 'group-1', action: 'message', content: 'hello {name}' },
    createdAt: new Date(at - 60_000).toISOString(), updatedAt: new Date(at - 60_000).toISOString(),
    ...overrides,
  };
}

function store(record: ScheduleRecord): void {
  state.stored.set(record.id, record as unknown as Record<string, unknown>);
}

const bindings = { DB: {} } as unknown as RuntimeBindings;

describe('schedule runner', () => {
  beforeEach(() => {
    state.stored.clear();
    state.reply.mockClear();
    state.resolveAccount.mockClear();
  });

  it('runs a due message schedule proactively and records the result', async () => {
    store(schedule());
    const results = await runDueSchedules(bindings, 1_800_000_000_000);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'schedule-1', status: 'success' });
    expect(state.reply).toHaveBeenCalledWith(expect.anything(), 'group-openid', 'group', 'hello Daily', 1);
    expect(state.stored.get('schedule-1')).toMatchObject({ lastStatus: 'success', lastRunAt: new Date(1_800_000_000_000).toISOString() });
  });

  it('skips schedules that are not due or are disabled', async () => {
    store(schedule({ config: { cron: '0 9 * * *', timezone: 'UTC', groupId: 'group-1', action: 'message', content: 'x' } }));
    store(schedule({ id: 'schedule-2', enabled: false }));
    const results = await runDueSchedules(bindings, 1_800_000_000_000);
    expect(results).toEqual([]);
    expect(state.reply).not.toHaveBeenCalled();
  });

  it('returns an error result when the target conversation is unavailable', async () => {
    store(schedule({ config: { cron: '* * * * *', timezone: 'UTC', groupId: 'missing', action: 'message', content: 'x' } }));
    const result = await runSchedule(bindings, 'schedule-1', 1_800_000_000_000, { force: true });
    expect(result.status).toBe('error');
    expect(result.error).toContain('目标会话不存在');
  });
});
