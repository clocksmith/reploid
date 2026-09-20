import { describe, it, expect, vi } from 'vitest';
import { createAttemptLifecycle, executeTurns, TURN_NEXT, TURN_RETURN } from '../../packages/reploid/src/agent/lifecycle.js';
import { dispatchTool } from '../../packages/reploid/src/agent/tool-dispatch.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { isTransientProviderFailure, providerRetryDelay } from '../../packages/reploid/src/agent/provider-recovery.js';
import { createReploid } from '../../packages/reploid/src/agent/index.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
describe('shared execution lifecycle', () => {
  it('uses one active attempt and never starts a cancelled queued turn', async () => {
    const owner = createAttemptLifecycle(), gate = deferred(), started = deferred(), turn = vi.fn();
    const first = owner.start(async signal => { started.resolve(); await gate.promise; return executeTurns({ signal, canContinue: () => true, turn }); });
    expect(owner.start(async () => 'second')).toBe(first);
    await started.promise;
    owner.cancel(); gate.resolve(); await first;
    expect(turn).not.toHaveBeenCalled();
    await owner.close();
    await expect(owner.start(async () => {})).rejects.toThrow('closed');
  });
  it('cancels observation but waits for borrowed provider settlement before closing', async () => {
    const owner = createAttemptLifecycle(), gate = deferred(), started = deferred();
    const active = owner.start(signal => owner.invoke(() => { started.resolve(); return gate.promise; }, signal));
    const rejected = expect(active).rejects.toThrow('cancel');
    await started.promise; owner.cancel(); await rejected;
    let closed = false;
    const closing = owner.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    gate.resolve('late'); await closing; expect(closed).toBe(true);
  });
  it('executes a bounded strategy and preserves explicit terminal state', async () => {
    let count = 0;
    const result = await executeTurns({ signal: new AbortController().signal, canContinue: () => count < 4,
      turn: async () => ++count === 2 ? TURN_RETURN : TURN_NEXT });
    expect(count).toBe(2); expect(result).toBe(TURN_RETURN);
  });
  it('settles cancelled borrowed work before a replacement attempt can execute', async () => {
    const owner = createAttemptLifecycle(), borrowed = deferred(), started = deferred(), replacement = vi.fn();
    const first = owner.start(signal => owner.invoke(() => { started.resolve(); return borrowed.promise; }, signal));
    const rejected = expect(first).rejects.toThrow('cancel');
    await started.promise;
    owner.cancel(); await rejected;
    const next = owner.start(async () => replacement());
    await Promise.resolve(); await Promise.resolve();
    expect(replacement).not.toHaveBeenCalled();
    borrowed.resolve(); await next;
    expect(replacement).toHaveBeenCalledOnce();
    await owner.close();
  });
  it('rechecks cancellation after asynchronous host authorization and keeps arguments detached', async () => {
    const gate = deferred(), controller = new AbortController(), execute = vi.fn(), args = { nested: { value: 1 } };
    const pending = dispatchTool({ call: { name: 'ReadFile', args }, policy: resolveConfig().value,
      authorize: async request => { request.args.nested.value = 2; await gate.promise; return true; },
      execute, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    controller.abort(); gate.resolve(); await rejected;
    expect(execute).not.toHaveBeenCalled(); expect(args.nested.value).toBe(1);
  });
  it('does not retry authentication errors even when their message contains quota language', () => {
    expect(isTransientProviderFailure({ status: 401, message: 'quota' })).toBe(false);
    expect(isTransientProviderFailure({ status: 503, message: 'unavailable' })).toBe(true);
    expect(providerRetryDelay({ retryAfter: '2' }, { baseMs: 100, maxMs: 1500 })).toBe(1500);
  });
  it('Work uses the same tool authorization gate and retains a checkpoint after parking', async () => {
    const execute = vi.fn();
    let calls = 0;
    const agent = createReploid({ config: resolveConfig({ overrides: { models: { providerId: 'test' }, tools: { allowed: ['ReadFile'] } } }),
      ports: { instanceId: 'work-contract', authorize: request => request.action === 'agent.execute',
        providers: { test: { generate: async () => ({ content: calls++ === 0 ? 'REPLOID/0\nTOOL: ReadFile\npath: /private' : 'REPLOID/0\nIDLE: review' }) } },
        tools: { ReadFile: execute } } });
    const result = await agent.execute({ goal: 'Inspect permitted input' });
    expect(result.status).toBe('PARKED'); expect(execute).not.toHaveBeenCalled();
    const checkpoint = await agent.checkpoint(); expect(checkpoint.schema).toBe('reploid.checkpoint/v1');
    await agent.close();
  });
  it('settles cancelled provider work before producing a restorable checkpoint', async () => {
    const started = deferred(), borrowed = deferred();
    const config = resolveConfig({ overrides: { models: { providerId: 'test' } } });
    const ports = { instanceId: 'cancelled-work', authorize: () => true,
      providers: { test: { generate: () => { started.resolve(); return borrowed.promise; } } } };
    const agent = createReploid({ config, ports });
    const attempt = agent.execute({ goal: 'Observe cancellation' });
    await started.promise; agent.cancel(); await attempt;
    await expect(agent.checkpoint()).rejects.toThrow('Pause');
    let settled = false;
    const settlement = agent.settle().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    borrowed.resolve({ content: 'Late output must not enter the checkpoint' });
    await settlement;
    const checkpoint = await agent.checkpoint();
    expect(JSON.stringify(checkpoint)).not.toContain('Late output');
    await agent.close();
    const restored = createReploid({ config, ports });
    await restored.restore(checkpoint);
    expect(restored.getSnapshot().cycle).toBe(1);
    await restored.close();
  });
});
