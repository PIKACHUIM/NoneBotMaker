import type { ChatAccountContext } from '../types';
import type { MatrixEvent } from './message';
import { matrixBaseUrl } from './api';

type FetchLike = typeof fetch;

export interface MatrixSyncBatch {
  nextBatch: string;
  events: Array<{ roomId: string; event: MatrixEvent }>;
  inviteRooms: string[];
}

function credential(account: ChatAccountContext, key: string): string {
  const value = account.credentials[key];
  return typeof value === 'string' ? value : '';
}

function headers(account: ChatAccountContext): Record<string, string> {
  return { authorization: `Bearer ${credential(account, 'accessToken')}` };
}

/** Reads the m.direct account data so DM rooms can be treated as private conversations. */
export async function fetchMatrixDirectRooms(
  account: ChatAccountContext,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const userId = credential(account, 'userId');
  if (!userId) return [];
  const response = await fetchImpl(
    `${matrixBaseUrl(account)}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/m.direct`,
    { headers: headers(account), signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) return [];
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const rooms: string[] = [];
  for (const value of Object.values(result)) {
    if (!Array.isArray(value)) continue;
    for (const roomId of value) if (typeof roomId === 'string') rooms.push(roomId);
  }
  return rooms;
}

export async function joinMatrixRoom(
  account: ChatAccountContext,
  roomId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${matrixBaseUrl(account)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
    {
      method: 'POST',
      headers: { ...headers(account), 'content-type': 'application/json; charset=utf-8' },
      body: '{}',
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`Matrix join failed: ${response.status}.`);
}

/**
 * Performs one /sync request. Passing no `since` performs an initial sync that
 * only records the next batch token, so a new account never replays history.
 */
export async function matrixSync(
  account: ChatAccountContext,
  since: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<MatrixSyncBatch> {
  const params = new URLSearchParams();
  if (since) {
    params.set('since', since);
    params.set('timeout', '25000');
    params.set('filter', JSON.stringify({ room: { timeline: { limit: 20 } } }));
  } else {
    params.set('timeout', '0');
    params.set('filter', JSON.stringify({ room: { timeline: { limit: 0 }, state: { limit: 0 } } }));
  }
  const response = await fetchImpl(
    `${matrixBaseUrl(account)}/_matrix/client/v3/sync?${params.toString()}`,
    { headers: headers(account), signal: AbortSignal.timeout(40_000) },
  );
  if (!response.ok) throw new Error(`Matrix sync failed: ${response.status}.`);
  const result = await response.json() as {
    next_batch?: unknown;
    rooms?: { join?: Record<string, { timeline?: { events?: unknown } }>; invite?: Record<string, unknown> };
  };
  const nextBatch = typeof result.next_batch === 'string' ? result.next_batch : '';
  if (!nextBatch) throw new Error('Matrix sync response is missing next_batch.');

  const events: MatrixSyncBatch['events'] = [];
  for (const [roomId, room] of Object.entries(result.rooms?.join ?? {})) {
    const timeline = Array.isArray(room.timeline?.events) ? room.timeline!.events : [];
    for (const event of timeline) {
      if (event && typeof event === 'object') events.push({ roomId, event: event as MatrixEvent });
    }
  }
  const inviteRooms = Object.keys(result.rooms?.invite ?? {});
  return { nextBatch, events, inviteRooms };
}
