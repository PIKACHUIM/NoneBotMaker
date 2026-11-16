import type { RuntimeBindings } from '../../shared/types';
import { runDueSchedules } from '../../server/automation/schedules';

interface AlarmStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(when: number | Date): Promise<void>;
}

interface AlarmState {
  storage: AlarmStorage;
}

const INTERVAL_MS = 60_000;

/**
 * Minute-level scheduler that does not depend on the account's Cloudflare Cron
 * trigger quota. The alarm re-arms itself after every run.
 */
export class AutomationDurableObject {
  constructor(private readonly state: AlarmState, private readonly env: RuntimeBindings) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ensure') return new Response('Not found', { status: 404 });
    await this.ensureAlarm();
    return Response.json({ scheduled: true });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    try {
      const results = await runDueSchedules({ ...this.env, PLATFORM: 'cloudflare' }, now);
      if (results.some((result) => result.status === 'error')) {
        console.error('Scheduled tasks reported errors.', results.filter((result) => result.status === 'error').map((result) => result.error));
      }
    } catch (error) {
      console.error('Scheduled task runner failed.', error instanceof Error ? error.message : error);
    } finally {
      await this.scheduleNext(now + INTERVAL_MS);
    }
  }

  private async ensureAlarm(): Promise<void> {
    const now = Date.now();
    const next = await this.state.storage.get<number>('nextAlarmAt');
    if (typeof next === 'number' && next > now) return;
    await this.scheduleNext(now + INTERVAL_MS);
  }

  private async scheduleNext(at: number): Promise<void> {
    await this.state.storage.put('nextAlarmAt', at);
    await this.state.storage.setAlarm(at);
  }
}
