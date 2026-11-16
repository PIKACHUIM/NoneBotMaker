import type { ExtensionRecord, GroupRecord, JsonObject, RuntimeBindings, ScheduleRecord, ScheduleStatus } from '../../shared/types';
import { configIdSet } from '../../shared/plugin-catalog';
import { nextCronOccurrence } from '../../shared/schedules';
import { renderScheduleText } from '../../shared/commands';
import type { ChatAccountContext, ChatPlatformMessage } from '../protocols/types';
import { resolveChatAccountById } from '../protocols/accounts';
import { sendChatMedia, sendChatText, sendProactiveChatText } from '../protocols/sender';
import { createPersistentChatbotStores, createStoredChatbotHandler } from '../plugins/chatbot/runtime';
import { createRepository, type StoredRecord } from '../storage/repository';
import { decryptSecrets } from '../storage/secrets';
import { runExtension, type WorkerLoaderLike } from './extensions';

export interface ScheduleRunResult {
  id: string;
  name: string;
  status: ScheduleStatus;
  at: string;
  error?: string;
  replies?: string[];
}

interface QQGatewayNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

const MAX_PROACTIVE_CHARS = 1000;
const runningSchedules = new Set<string>();

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MAX_PROACTIVE_CHARS) {
    let boundary = Math.max(remaining.lastIndexOf('\n', MAX_PROACTIVE_CHARS), remaining.lastIndexOf(' ', MAX_PROACTIVE_CHARS));
    if (boundary < MAX_PROACTIVE_CHARS / 2) boundary = MAX_PROACTIVE_CHARS;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function groupConversationType(group: GroupRecord): 'group' | 'private' {
  return group.conversationType === 'private' ? 'private' : 'group';
}

async function sendProactive(account: ChatAccountContext, group: GroupRecord, text: string): Promise<void> {
  const target = group.externalId.split(',')[0]?.trim();
  if (!target) throw new Error('Schedule target conversation has no external id.');
  const conversationType = groupConversationType(group);
  for (const [index, part] of splitText(text).entries()) {
    await sendProactiveChatText(account, target, conversationType, part, index + 1);
  }
}

async function enqueueMessage(bindings: RuntimeBindings, account: ChatAccountContext, group: GroupRecord, message: ChatPlatformMessage): Promise<void> {
  const namespace = account.protocol === 'qq' ? bindings.QQ_GATEWAY_SESSIONS as QQGatewayNamespaceLike | undefined : undefined;
  if (namespace) {
    if (typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') throw new Error('QQ_GATEWAY_SESSIONS 绑定无效。');
    const stub = namespace.get(namespace.idFromName(account.account.id));
    const response = await stub.fetch(new Request('https://qq-gateway.internal/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: account.account.id, message }),
    }));
    if (!response.ok) throw new Error(`QQ 消息投递失败（${response.status}）。`);
    return;
  }
  const handler = createStoredChatbotHandler(bindings, {
    ...createPersistentChatbotStores(bindings),
    sendReply: sendChatText,
    sendMedia: sendChatMedia,
  });
  await handler(account, message);
}

function scheduledMessage(account: ChatAccountContext, group: GroupRecord, at: number, text: string, wake: boolean, ownerId: string): ChatPlatformMessage {
  const conversationType = groupConversationType(group);
  const eventId = `schedule:${crypto.randomUUID()}`;
  return {
    id: eventId, eventId, accountId: account.account.id, botId: account.appId,
    groupId: group.externalId.split(',')[0]?.trim() ?? '', userId: ownerId,
    text: text.slice(0, 8000), mentionsBot: true, receivedAt: at,
    eventType: account.protocol === 'qq'
      ? conversationType === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE'
      : 'scheduled',
    conversationType,
    ...(wake ? { isWake: true, wakeReason: text.slice(0, 1000) } : {}),
  };
}

function ownerId(group: GroupRecord): string {
  const owners = configIdSet((group.config as JsonObject | undefined)?.bridge_owner_ids);
  return [...owners][0] ?? '';
}

async function loadScheduleTarget(bindings: RuntimeBindings, schedule: ScheduleRecord): Promise<{ account: ChatAccountContext; group: GroupRecord }> {
  const repository = createRepository(bindings);
  const stored = await repository.get('groups', schedule.config.groupId);
  if (!stored) throw new Error('定时任务目标会话不存在。');
  const group = await decryptSecrets(stored as JsonObject, bindings) as unknown as GroupRecord;
  if (!group.enabled) throw new Error('定时任务目标会话已停用。');
  const account = await resolveChatAccountById(group.accountId, bindings);
  if (!account) throw new Error('定时任务目标会话的账号不可用。');
  return { account, group };
}

export async function executeSchedule(bindings: RuntimeBindings, schedule: ScheduleRecord, at: number): Promise<ScheduleRunResult> {
  const result: ScheduleRunResult = { id: schedule.id, name: schedule.name, status: 'success', at: new Date(at).toISOString() };
  try {
    const { account, group } = await loadScheduleTarget(bindings, schedule);
    const content = schedule.config.content ?? '';
    const rendered = renderScheduleText(content, {
      name: schedule.name, time: new Date(at).toISOString(), args: '',
    });
    if (schedule.config.action === 'message') {
      if (!rendered) throw new Error('定时消息内容为空。');
      await sendProactive(account, group, rendered);
    } else if (schedule.config.action === 'prompt') {
      if (!rendered) throw new Error('定时提示词为空。');
      await enqueueMessage(bindings, account, group, scheduledMessage(account, group, at, rendered, true, ownerId(group)));
    } else if (schedule.config.action === 'command') {
      const command = rendered.startsWith('/') ? rendered : `/${rendered}`;
      if (command === '/') throw new Error('定时命令为空。');
      await enqueueMessage(bindings, account, group, scheduledMessage(account, group, at, command, false, ownerId(group) || 'schedule'));
    } else if (schedule.config.action === 'extension') {
      const repository = createRepository(bindings);
      const extension = schedule.config.extensionId ? await repository.get('extensions', schedule.config.extensionId) : null;
      if (!extension || extension.enabled === false) throw new Error('定时任务引用的插件不存在或已停用。');
      const execution = await runExtension(extension as unknown as ExtensionRecord, {
        source: 'schedule', args: '', text: rendered, accountId: account.account.id,
        groupId: group.id, groupName: group.name, userId: ownerId(group), conversationType: groupConversationType(group), at,
      }, { fetch, loader: bindings.PLUGIN_LOADER as WorkerLoaderLike | undefined });
      result.replies = execution.replies;
      if (execution.replies.length) await sendProactive(account, group, execution.replies.join('\n\n'));
    } else {
      throw new Error('不支持的定时任务类型。');
    }
  } catch (error) {
    result.status = 'error';
    result.error = (error instanceof Error ? error.message : '定时任务执行失败。').slice(0, 500);
  }
  return result;
}

function storedSchedule(record: StoredRecord): ScheduleRecord {
  return record as unknown as ScheduleRecord;
}

export async function runSchedule(
  bindings: RuntimeBindings,
  scheduleId: string,
  at = Date.now(),
  options: { force?: boolean } = {},
): Promise<ScheduleRunResult> {
  const repository = createRepository(bindings);
  const stored = await repository.get('schedules', scheduleId);
  if (!stored) throw new Error('定时任务不存在。');
  const schedule = storedSchedule(stored);
  if (!options.force && !schedule.enabled) return { id: schedule.id, name: schedule.name, status: 'skipped', at: new Date(at).toISOString(), error: '定时任务已停用。' };
  if (runningSchedules.has(schedule.id)) throw new Error('定时任务正在执行。');
  runningSchedules.add(schedule.id);
  const startedAt = Date.now();
  try {
    // Record the attempt before executing so overlapping cron ticks do not repeat side effects.
    const claimed: StoredRecord = { ...stored, lastRunAt: new Date(at).toISOString(), updatedAt: new Date().toISOString() };
    await repository.put('schedules', claimed);
    const result = await executeSchedule(bindings, schedule, at);
    const next = nextCronOccurrence(schedule.config.cron, at, schedule.config.timezone);
    const updated: StoredRecord = {
      ...claimed,
      lastStatus: result.status,
      ...(result.error ? { lastError: result.error } : { lastError: '' }),
      lastDurationMs: Date.now() - startedAt,
      ...(next === null ? {} : { nextRunAt: new Date(next).toISOString() }),
      updatedAt: new Date().toISOString(),
    };
    await repository.put('schedules', updated);
    return result;
  } finally {
    runningSchedules.delete(schedule.id);
  }
}

function isDue(schedule: ScheduleRecord, at: number): boolean {
  if (!schedule.enabled) return false;
  const from = Date.parse(schedule.lastRunAt ?? schedule.createdAt ?? new Date(at).toISOString());
  if (!Number.isFinite(from)) return false;
  const next = nextCronOccurrence(schedule.config.cron, from, schedule.config.timezone);
  return next !== null && next <= at;
}

export async function runDueSchedules(bindings: RuntimeBindings, at = Date.now()): Promise<ScheduleRunResult[]> {
  const repository = createRepository(bindings);
  const schedules = (await repository.list('schedules')).map(storedSchedule);
  const results: ScheduleRunResult[] = [];
  for (const schedule of schedules) {
    if (!isDue(schedule, at)) {
      // Keep the console preview fresh without executing anything.
      if (schedule.enabled && !schedule.nextRunAt) {
        const next = nextCronOccurrence(schedule.config.cron, at, schedule.config.timezone);
        if (next !== null) {
          try {
            await repository.put('schedules', { ...schedule, nextRunAt: new Date(next).toISOString() });
          } catch { /* preview only */ }
        }
      }
      continue;
    }
    try { results.push(await runSchedule(bindings, schedule.id, at)); }
    catch (error) {
      results.push({ id: schedule.id, name: schedule.name, status: 'error', at: new Date(at).toISOString(),
        error: error instanceof Error ? error.message : '定时任务执行失败。' });
    }
  }
  return results;
}
