import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/ordered-partition-ports.js';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };

// Injected numerical stages and in-process timers: these prove the runner's bounds and
// settlement order, not physical stage timing.
const bounded = (count = 3, stageTimeoutMs = 40) => {
  const f = fixture(count);
  f.limits.stageTimeoutMs = stageTimeoutMs;
  return { ...f, runner: createLayerPartitionRunner(f) };
};
// A stage port that ignores its abort signal until released, like a GPU submission in flight.
function hold(stage) {
  const run = stage.executeStage.getMockImplementation();
  let release; const released = new Promise(resolve => { release = resolve; });
  let entered; const started = new Promise(resolve => { entered = resolve; });
  stage.executeStage.mockImplementationOnce(async args => { entered(); await released; return run(args); });
  return { release, started };
}

describe('declared stage execution bound on every stage', () => {
  it('fails a coordinator-local stage past its bound as REQUEST_TIMEOUT and settles it only after its call settles', async () => {
    const f = bounded(3, 40), local = hold(f.stages[0]);
    const pending = f.runner.execute(f.request), failed = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await local.started;
    await new Promise(resolve => setTimeout(resolve, 50));
    // Past the bound the attempt has failed, and stage zero's cleanup is still waiting for its call.
    expect(f.stages[0].closeAttempt).not.toHaveBeenCalled();
    local.release();
    await failed;
    expect(f.stages.map(stage => stage.closeAttempt.mock.calls.length)).toEqual([1, 1, 1]);
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
    expect(f.runner.getState().attempts[0]).toMatchObject({ phase: 'failed', failure: failureMessages.REQUEST_TIMEOUT });
  });
  it('leaves a local call that outlives the cleanup bound unsettled and retryable, never released early', async () => {
    const f = bounded(3, 20), local = hold(f.stages[0]);
    await expect(f.runner.execute(f.request)).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(f.stages[0].closeAttempt).not.toHaveBeenCalled();
    expect(f.runner.getState()).toMatchObject({ unsettled: 1 });
    expect(f.runner.getState().attempts[0].cleanup[0]).toMatchObject({ status: 'unknown' });
    local.release();
    await f.runner.retryCleanup('attempt');
    expect(f.stages[0].closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.runner.getState()).toMatchObject({ unsettled: 0 });
  });
  it('bounds a remote stage port the same way when its transport does not', async () => {
    const f = bounded(), remote = hold(f.stages[1]);
    const pending = f.runner.execute(f.request), failed = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await remote.started; await new Promise(resolve => setTimeout(resolve, 50)); remote.release();
    await failed;
    expect(f.stages.map(stage => stage.closeAttempt.mock.calls.length)).toEqual([1, 1, 1]);
  });
  it('requires an explicit bound', () => {
    const f = fixture(); delete f.limits.stageTimeoutMs;
    expect(() => createLayerPartitionRunner(f)).toThrow('stage execution bound');
  });
});

describe('answer deadline', () => {
  it('fails at the deadline as ANSWER_DEADLINE_EXCEEDED, records a failure rather than a stop, and settles every stage', async () => {
    const f = bounded(3, 1000), slow = hold(f.stages[1]);
    const pending = f.runner.execute({ ...f.request, deadlineAt: Date.now() + 30 });
    const failed = expect(pending).rejects.toMatchObject({ code: 'ANSWER_DEADLINE_EXCEEDED', message: 'Response timed out. Retry starts a new attempt.' });
    await slow.started; await new Promise(resolve => setTimeout(resolve, 40)); slow.release();
    await failed;
    expect(f.stages.map(stage => stage.closeAttempt.mock.calls.length)).toEqual([1, 1, 1]);
    expect(f.runner.getState().attempts[0]).toMatchObject({ phase: 'failed' });
    expect(f.runner.getState()).toMatchObject({ active: 0, unsettled: 0 });
  });
  it('a caller stop before the deadline remains a cancellation', async () => {
    const f = bounded(3, 1000), slow = hold(f.stages[1]), controller = new AbortController();
    const pending = f.runner.execute({ ...f.request, deadlineAt: Date.now() + 10000, signal: controller.signal });
    const failed = expect(pending).rejects.toThrow('stopped');
    await slow.started; controller.abort(new Error('stopped')); slow.release();
    await failed;
    expect(f.runner.getState().attempts[0]).toMatchObject({ phase: 'cancelled' });
  });
});
