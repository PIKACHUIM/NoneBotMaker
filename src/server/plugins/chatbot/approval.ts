import type { JsonObject, ToolCall } from '../../../shared/types';
import { sanitize } from './network';

export interface PendingToolApproval {
  id: string;
  call: ToolCall;
  requestedBy: string;
  requestedAt: number;
  expiresAt: number;
  status: 'pending' | 'executing' | 'approved' | 'rejected' | 'expired' | 'failed';
  decidedBy?: string;
  result?: string;
  isError?: boolean;
}

export interface ApprovalContext {
  scopeKey: string;
  getState(): Promise<JsonObject>;
  setState(state: JsonObject): Promise<void>;
  now?: () => number;
}

export interface ApprovedToolResult {
  call: ToolCall;
  content: string;
  isError: boolean;
}

const MAX_APPROVALS = 20;
const APPROVAL_TTL_MS = 5 * 60_000;
const deciding = new Set<string>();

export class ToolApprovalManager {
  private readonly now: () => number;

  constructor(private readonly context: ApprovalContext) {
    this.now = context.now ?? Date.now;
  }

  private entries(state: JsonObject): PendingToolApproval[] {
    if (!Array.isArray(state.toolApprovals)) return [];
    return (state.toolApprovals as PendingToolApproval[]).filter((entry) => entry && typeof entry.id === 'string' &&
      typeof entry.call?.id === 'string' && typeof entry.call.function?.name === 'string' &&
      typeof entry.call.function?.arguments === 'string' && Number.isFinite(entry.expiresAt)).map((entry) => ({ ...entry,
      status: entry.status === 'pending' && entry.expiresAt <= this.now() ? 'expired' : entry.status,
    }));
  }

  async list(): Promise<PendingToolApproval[]> {
    return this.entries(await this.context.getState());
  }

  async request(call: ToolCall, requestedBy: string, secrets: string[] = []): Promise<PendingToolApproval> {
    if (!call.id || call.id.length > 256 || !/^[A-Za-z0-9_.-]{1,64}$/.test(call.function.name) || call.function.arguments.length > 16_384) {
      throw new Error('Invalid tool approval request.');
    }
    const args: unknown = JSON.parse(call.function.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool approval arguments must be an object.');
    const safe = sanitize(args, secrets);
    if (JSON.stringify(args) !== JSON.stringify(safe)) throw new Error('Sensitive tool arguments cannot be stored in an approval request.');
    const state = await this.context.getState();
    const entries = this.entries(state);
    const existing = entries.find((entry) => entry.status === 'pending' && entry.call.function.name === call.function.name && entry.call.function.arguments === call.function.arguments);
    if (existing) return existing;
    if (entries.filter((entry) => entry.status === 'pending' || entry.status === 'executing').length >= MAX_APPROVALS) throw new Error('Too many pending tool approvals.');
    const at = this.now();
    const approval: PendingToolApproval = {
      id: crypto.randomUUID(), call: structuredClone(call), requestedBy: requestedBy.slice(0, 256),
      requestedAt: at, expiresAt: at + APPROVAL_TTL_MS, status: 'pending',
    };
    await this.context.setState({ ...state, toolApprovals: [...entries.filter((entry) => entry.status === 'pending' || entry.status === 'executing'), approval] });
    return approval;
  }

  async decide(
    id: string,
    approve: boolean,
    decidedBy: string,
    isOwner: boolean,
    execute: (call: ToolCall) => Promise<{ content: string; isError: boolean }>,
    secrets: string[] = [],
  ): Promise<ApprovedToolResult | null> {
    if (!isOwner) throw new Error('Only a conversation owner can decide tool approvals.');
    const key = JSON.stringify([this.context.scopeKey, id]);
    if (deciding.has(key)) throw new Error('Tool approval is already being decided.');
    deciding.add(key);
    try {
      return await this.performDecision(id, approve, decidedBy, execute, secrets);
    } finally { deciding.delete(key); }
  }

  private async performDecision(
    id: string,
    approve: boolean,
    decidedBy: string,
    execute: (call: ToolCall) => Promise<{ content: string; isError: boolean }>,
    secrets: string[],
  ): Promise<ApprovedToolResult | null> {
    let state = await this.context.getState();
    let entries = this.entries(state);
    const approval = entries.find((entry) => entry.id === id);
    if (!approval) throw new Error('Tool approval does not exist in this conversation.');
    if (approval.status !== 'pending') throw new Error(`Tool approval is ${approval.status}; it cannot be executed again.`);
    approval.decidedBy = decidedBy.slice(0, 256);
    approval.status = approve ? 'executing' : 'rejected';
    await this.context.setState({ ...state, toolApprovals: entries });
    if (!approve) return null;
    let result: { content: string; isError: boolean };
    try {
      result = await execute(structuredClone(approval.call));
    } catch (error) {
      result = { content: error instanceof Error ? error.message : 'Approved tool execution failed.', isError: true };
    }
    result.content = String(sanitize(result.content, secrets));
    state = await this.context.getState();
    entries = this.entries(state);
    const stored = entries.find((entry) => entry.id === id);
    if (!stored || stored.status !== 'executing') throw new Error('Tool approval state changed during execution; refusing a retry.');
    stored.status = result.isError ? 'failed' : 'approved';
    stored.result = result.content;
    stored.isError = result.isError;
    await this.context.setState({ ...state, toolApprovals: entries });
    return { call: approval.call, content: result.content, isError: result.isError };
  }
}
