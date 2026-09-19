import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionEngine, TURN_RETURN } from '../../packages/reploid/src/agent/engine.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import ToolExecutor from '../../self/infrastructure/tool-executor.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const policy = resolveConfig({ overrides: { tools: { allowed: ['WriteFile'] } } }).value;
afterEach(() => vi.useRealTimers());

describe('execution authority', () => {
  it('rechecks host grants for every retry and never retries a denial', async () => {
    const engine = createExecutionEngine();
    const authorize = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const execute = vi.fn().mockRejectedValue(new Error('Temporary failure'));
    const result = await engine.start(() => engine.tool({ call: { name: 'WriteFile' }, policy,
      authorize, execute, retry: { maxRetries: 2, delayMs: 0 } }));
    expect(result.status).toBe('denied'); expect(execute).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledTimes(2);
    await engine.close();
  });
  it('preserves pending work after a tool timeout and refuses a committed checkpoint until settlement', async () => {
    vi.useFakeTimers();
    const engine = createExecutionEngine(), borrowed = deferred(), started = deferred();
    const executor = ToolExecutor.factory({ Utils: { logger: { warn() {}, error() {} } },
      ToolRunner: { execute: () => { started.resolve(); return borrowed.promise; } } });
    const active = engine.start(() => engine.tool({ call: { name: 'WriteFile' }, policy, authorize: () => true,
      retry: { maxRetries: 2, delayMs: 10 }, execute: async (name, args, control) => {
        const result = await executor.executeWithRetry({ name, args }, { ...control, maxRetries: 0,
          timeoutMs: 10, invoke: engine.invoke });
        if (result.error) throw result.error;
        return result.rawResult;
      } }));
    await started.promise; await vi.advanceTimersByTimeAsync(10);
    expect((await active).status).toBe('failed');
    expect(() => engine.checkpoint({ committed: true })).toThrow('Pause');
    let closed = false;
    const closing = engine.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    borrowed.resolve('settled'); await closing;
    expect(engine.getEvents().filter(event => event.type === 'tool.started')).toHaveLength(1);
  });
  it('tries only declared provider candidates after transient errors; authentication cannot select another provider', async () => {
    const engine = createExecutionEngine();
    const request = vi.fn().mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
      .mockResolvedValueOnce({ content: 'ok' });
    await engine.start(async () => {
      expect(await engine.generate({ candidates: ['primary', 'approved'], request })).toMatchObject({ model: 'approved' });
      const unauthorized = vi.fn().mockRejectedValue(Object.assign(new Error('quota credentials'), { status: 401 }));
      await expect(engine.generate({ candidates: ['primary', 'approved'], request: unauthorized })).rejects.toThrow('credentials');
      expect(unauthorized).toHaveBeenCalledOnce();
    });
    await engine.close();
  });
  it('bounds authorized follow-ups and skips later mutations after a failure', async () => {
    const engine = createExecutionEngine();
    const executed = [];
    const result = await engine.start(() => engine.batch({ groups: [
      { mode: 'sequential', calls: ['parent', 'failure', 'later'] }
    ], execute: async call => { executed.push(call); return { call, failed: call === 'failure' }; },
    failed: entry => entry.failed, stopOnFailure: true, maxFollowups: 1,
    next: entry => entry.call === 'parent' ? ['child1', 'child2'] : [],
    skipped: call => ({ call, skipped: true }) }));
    expect(executed).toEqual(['parent', 'child1', 'failure']);
    expect(result.at(-1)).toEqual({ call: 'later', skipped: true });
    await engine.close();
  });
  it('owns retry timers and clears them on cancellation', async () => {
    vi.useFakeTimers();
    const engine = createExecutionEngine(), resume = vi.fn();
    await engine.start(() => engine.turns({ canContinue: () => true, turn: async () => {
      engine.scheduleRetry(100, resume); return TURN_RETURN;
    } }));
    expect(engine.retryPending).toBe(true);
    expect(() => engine.checkpoint({})).toThrow('Pause');
    engine.cancel(); await vi.advanceTimersByTimeAsync(100);
    expect(resume).not.toHaveBeenCalled(); expect(engine.retryPending).toBe(false);
    await engine.close();
  });
  it('refuses a checkpoint while an attempt is queued and refuses effects outside an attempt', async () => {
    const engine = createExecutionEngine();
    const active = engine.start(async () => {});
    expect(() => engine.checkpoint({})).toThrow('Pause');
    await active;
    expect(engine.checkpoint({ ready: true })).toEqual({ ready: true });
    await expect(engine.provider(async () => 'late')).rejects.toThrow('No active attempt');
    await engine.close();
  });
  it('does not lose a retry window that opens while the previous attempt is finalizing', async () => {
    vi.useFakeTimers();
    const engine = createExecutionEngine(), finalizer = deferred(), scheduled = deferred(), resume = vi.fn();
    const active = engine.start(async () => {
      engine.scheduleRetry(1, resume); scheduled.resolve(); await finalizer.promise;
    });
    await scheduled.promise; await vi.advanceTimersByTimeAsync(1);
    expect(resume).not.toHaveBeenCalled(); expect(engine.retryPending).toBe(true);
    finalizer.resolve(); await active; await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenCalledOnce(); expect(engine.retryPending).toBe(false);
    await engine.close();
  });
  it('cleans up delay listeners and deadlines and isolates event observers', async () => {
    vi.useFakeTimers();
    const engine = createExecutionEngine({ onEvent() { throw new Error('view failed'); } });
    const active = engine.start(async () => { await engine.delay(10); }, { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(10); await active;
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.getEvents().map(event => event.type)).toEqual(['attempt.started', 'attempt.settled']);
    await engine.close();
  });
});
