import type { ChatbotRuntimeActivity, JsonObject } from '../../../shared/types';

const ACTIVE_WINDOW_MS = 5 * 60_000;

/** Reads the best-effort live snapshot left by the chatbot handler. */
export function readRuntimeActivity(state: JsonObject): ChatbotRuntimeActivity | null {
  const value = state.runtimeActivity;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const activity = value as unknown as ChatbotRuntimeActivity;
  if (!['thinking', 'tool', 'replying', 'completed', 'error'].includes(activity.phase)) return null;
  if (!Number.isFinite(activity.startedAt) || !Number.isFinite(activity.updatedAt) || !Array.isArray(activity.tools)) return null;
  return activity;
}

/** A snapshot is considered in progress only while the handler is still writing it. */
export function runtimeActivityIsActive(activity: ChatbotRuntimeActivity | null, now: number): boolean {
  return Boolean(activity && activity.phase !== 'completed' && activity.phase !== 'error' && now - activity.updatedAt < ACTIVE_WINDOW_MS);
}
