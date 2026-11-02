import { describe, expect, it, vi } from 'vitest';
import type { JsonObject, ToolCall } from '../../../shared/types';
import { ToolApprovalManager, type ApprovalContext } from './approval';

function fixture() {
  let state: JsonObject = { role: 'keep role', memory: 'keep memory' };
  let now = 1000;
  const context: ApprovalContext = { scopeKey: crypto.randomUUID(), getState: async () => structuredClone(state), setState: async (next) => { state = structuredClone(next); }, now: () => now };
  return { context, manager: new ToolApprovalManager(context), getState: () => state, advance: (delta: number) => { now += delta; } };
}
function call(id = 'call-1', name = 'mcp_side_effect', argumentsValue: JsonObject = { text: 'hello' }): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(argumentsValue) } };
}

describe('persistent tool approval lifecycle', () => {
  it('persists a pending request and only executes after owner approval', async () => {
    const { manager, context, getState } = fixture();
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    const pending = await manager.request(call(), 'member');
    expect(execute).not.toHaveBeenCalled();
    const restored = new ToolApprovalManager(context);
    expect((await restored.list())[0].status).toBe('pending');
    expect(await restored.decide(pending.id, true, 'owner', true, execute)).toMatchObject({ content: 'done', isError: false });
    expect(execute).toHaveBeenCalledOnce();
    expect(getState().role).toBe('keep role');
    expect((await restored.list())[0]).toMatchObject({ status: 'approved', decidedBy: 'owner' });
    await expect(restored.decide(pending.id, true, 'owner', true, execute)).rejects.toThrow('cannot be executed again');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('denies a non-owner and supports rejection without execution', async () => {
    const { manager } = fixture();
    const pending = await manager.request(call(), 'member');
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    await expect(manager.decide(pending.id, true, 'member', false, execute)).rejects.toThrow('owner');
    expect(await manager.decide(pending.id, false, 'owner', true, execute)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect((await manager.list())[0].status).toBe('rejected');
  });

  it('expires pending requests and deduplicates identical requested operations', async () => {
    const { manager, advance } = fixture();
    const first = await manager.request(call(), 'member');
    const duplicate = await manager.request(call('call-2'), 'member');
    expect(duplicate.id).toBe(first.id);
    advance(5 * 60_000 + 1);
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    await expect(manager.decide(first.id, true, 'owner', true, execute)).rejects.toThrow('expired');
    expect(execute).not.toHaveBeenCalled();
  });

  it('never executes a pending request from another conversation', async () => {
    const first = fixture();
    const second = fixture();
    const pending = await first.manager.request(call(), 'member');
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    await expect(second.manager.decide(pending.id, true, 'owner', true, execute)).rejects.toThrow('does not exist');
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks concurrent approval replay across manager instances in one session', async () => {
    const { manager, context } = fixture();
    const pending = await manager.request(call(), 'member');
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    const result = await Promise.allSettled([
      manager.decide(pending.id, true, 'owner', true, execute),
      new ToolApprovalManager(context).decide(pending.id, true, 'owner', true, execute),
    ]);
    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('records an execution failure and does not blindly retry a side effect', async () => {
    const { manager } = fixture();
    const pending = await manager.request(call(), 'member');
    const execute = vi.fn(async () => { throw new Error('network outcome unknown'); });
    expect(await manager.decide(pending.id, true, 'owner', true, execute)).toMatchObject({ isError: true });
    expect((await manager.list())[0].status).toBe('failed');
    await expect(manager.decide(pending.id, true, 'owner', true, execute)).rejects.toThrow('failed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('refuses to persist secrets or oversized arguments for approval', async () => {
    const { manager } = fixture();
    await expect(manager.request(call('call-1', 'mcp_side_effect', { apiKey: 'do-not-persist' }), 'member')).rejects.toThrow('Sensitive');
    await expect(manager.request(call('call-2', 'mcp_side_effect', { text: 'known-secret' }), 'member', ['known-secret'])).rejects.toThrow('Sensitive');
    await expect(manager.request(call('call-3', 'mcp_side_effect', { text: 'a'.repeat(20_000) }), 'member')).rejects.toThrow('Invalid');
    expect(await manager.list()).toEqual([]);
  });

  it('survives restart in executing state without repeating a tool', async () => {
    const { manager, context } = fixture();
    const pending = await manager.request(call(), 'member');
    const state = await context.getState();
    (state.toolApprovals as Array<{ status: string }>)[0].status = 'executing';
    await context.setState(state);
    const execute = vi.fn(async () => ({ content: 'done', isError: false }));
    await expect(new ToolApprovalManager(context).decide(pending.id, true, 'owner', true, execute)).rejects.toThrow('executing');
    expect(execute).not.toHaveBeenCalled();
  });
});
