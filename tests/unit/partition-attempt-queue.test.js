import { afterEach, describe, expect, it, vi } from 'vitest';
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import componentPolicy from '../../packages/reploid/src/mesh/partitions/partition-attempt-queue-policy.json' with { type: 'json' };
import { ATTEMPT_QUEUE_POLICY, ATTEMPT_QUEUE_POLICY_SCHEMA, createPartitionAttemptQueue,
  validateAttemptQueuePolicy } from '../../packages/reploid/src/mesh/partitions/partition-attempt-queue.js';

// Coordinator admission bookkeeping with an injected slot gate: proves bounded FIFO waiting and
// explicit failures, not route capacity or physical execution.
afterEach(() => { vi.useRealTimers(); });
const policy = (overrides = {}) => ({ schema: ATTEMPT_QUEUE_POLICY_SCHEMA, maxQueuedAttempts: 5, maxQueuedPerRequester: 5, maxQueueWaitMs: 60000, ...overrides });
/** One route with `slots` concurrent attempts: a ticket occupies a slot until released. */
const route = slots => ({ check: ({ admitted }) => admitted < slots });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('coordinator attempt queue policy', () => {
  it('loads the component policy and refuses a missing, partial, unknown or inconsistent policy', () => {
    expect(ATTEMPT_QUEUE_POLICY).toEqual(componentPolicy);
    expect(Object.isFrozen(ATTEMPT_QUEUE_POLICY)).toBe(true);
    const { maxQueueWaitMs: _omitted, ...partial } = policy();
    for (const bad of [undefined, null, [], partial, { ...policy(), extra: 1 }, { ...policy(), schema: 'other/v1' },
      policy({ maxQueuedAttempts: 0 }), policy({ maxQueueWaitMs: 1.5 }), policy({ maxQueuedPerRequester: 6 }),
      policy({ maxQueueWaitMs: 2 ** 31 })]) {
      expect(() => validateAttemptQueuePolicy(bad)).toThrow(ATTEMPT_QUEUE_POLICY_SCHEMA);
    }
    expect(() => createPartitionAttemptQueue({})).toThrow(ATTEMPT_QUEUE_POLICY_SCHEMA);
  });
});

describe('coordinator attempt queue', () => {
  it('admits at once when a slot is free and waits in arrival order for five requesters when none is', async () => {
    const queue = createPartitionAttemptQueue({ policy: policy() }), gate = route(1), order = [], queued = [];
    const first = await queue.admit({ key: 'route', attemptId: 'a0', requesterId: 'r0', ...gate });
    expect(first).toMatchObject({ queued: false, queuedMs: 0 });
    const waits = ['a1', 'a2', 'a3', 'a4', 'a5'].map((attemptId, index) => queue.admit({ key: 'route', attemptId,
      requesterId: `r${index + 1}`, ...gate, onQueued: state => queued.push([attemptId, state.position]) })
      .then(ticket => { order.push(attemptId); return ticket; }));
    expect(queued).toEqual([['a1', 1], ['a2', 2], ['a3', 3], ['a4', 4], ['a5', 5]]);
    expect(queue.getState()).toMatchObject({ queued: 5, admitted: 1 });
    let held = first;
    for (let index = 0; index < 5; index++) {
      held.release(); await flush();
      expect(order).toHaveLength(index + 1);
      held = await waits[index];
      expect(held.queued).toBe(true);
    }
    expect(order).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    held.release();
    expect(queue.getState()).toMatchObject({ queued: 0, admitted: 0, opening: 0 });
  });

  it('lets a later route use capacity a blocked route cannot, and never lets a later entry of the same route overtake', async () => {
    let shared = 2;
    const queue = createPartitionAttemptQueue({ policy: policy() }), order = [];
    // Route A allows one attempt; route B two; both draw on `shared` coordinator-stage slots.
    const gate = limit => ({ check: ({ admitted, opening }) => admitted < limit && shared - opening > 0 });
    const a0 = await queue.admit({ key: 'A', attemptId: 'a0', requesterId: 'r0', ...gate(1) });
    a0.opened(); shared--;
    const track = (key, attemptId, limit) => queue.admit({ key, attemptId, requesterId: attemptId, ...gate(limit) })
      .then(ticket => { order.push(attemptId); return ticket; });
    const a1 = track('A', 'a1', 1), a2 = track('A', 'a2', 1), b0 = track('B', 'b0', 2);
    const b0ticket = await b0; b0ticket.opened(); shared--;
    expect(order).toEqual(['b0']);
    // Freeing route A's slot also frees its coordinator-stage slot: A's earliest entry goes first.
    a0.release(); shared++;
    queue.pump(); await flush();
    expect(order).toEqual(['b0', 'a1']);
    (await a1).release(); await flush();
    expect(order).toEqual(['b0', 'a1', 'a2']);
    (await a2).release(); b0ticket.release();
  });

  it('fails explicitly when the queue or one requester\'s share is full, without disturbing waiting entries', async () => {
    const queue = createPartitionAttemptQueue({ policy: policy({ maxQueuedAttempts: 3, maxQueuedPerRequester: 2 }) }), gate = route(1);
    const held = await queue.admit({ key: 'route', attemptId: 'held', requesterId: 'r0', ...gate });
    const waits = [queue.admit({ key: 'route', attemptId: 'x1', requesterId: 'rx', ...gate }),
      queue.admit({ key: 'route', attemptId: 'x2', requesterId: 'rx', ...gate })];
    const perRequester = queue.admit({ key: 'route', attemptId: 'x3', requesterId: 'rx', ...gate });
    await expect(perRequester).rejects.toMatchObject({ code: 'CAPACITY_QUEUE_FULL', message: failureMessages.CAPACITY_QUEUE_FULL });
    waits.push(queue.admit({ key: 'route', attemptId: 'y1', requesterId: 'ry', ...gate }));
    await expect(queue.admit({ key: 'route', attemptId: 'z1', requesterId: 'rz', ...gate }))
      .rejects.toMatchObject({ code: 'CAPACITY_QUEUE_FULL' });
    expect(queue.getState()).toMatchObject({ queued: 3, admitted: 1 });
    held.release();
    for (const wait of waits) (await wait).release();
    expect(queue.getState()).toMatchObject({ queued: 0, admitted: 0 });
  });

  it('times a wait out at the policy bound, or first at the attempt\'s own deadline, and removes it', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const queue = createPartitionAttemptQueue({ policy: policy({ maxQueueWaitMs: 30000 }) }), gate = route(1);
    const held = await queue.admit({ key: 'route', attemptId: 'held', requesterId: 'r0', ...gate });
    const byPolicy = queue.admit({ key: 'route', attemptId: 'p', requesterId: 'r1', ...gate });
    const byDeadline = queue.admit({ key: 'route', attemptId: 'd', requesterId: 'r2', deadlineAt: Date.now() + 5000, ...gate });
    const expectations = [
      expect(byDeadline).rejects.toMatchObject({ code: 'CAPACITY_QUEUE_TIMEOUT', bound: 'authorization', message: failureMessages.CAPACITY_QUEUE_TIMEOUT }),
      expect(byPolicy).rejects.toMatchObject({ code: 'CAPACITY_QUEUE_TIMEOUT', bound: 'policy' })];
    await vi.advanceTimersByTimeAsync(5000);
    await expectations[0];
    expect(queue.getState().queued).toBe(1);
    await vi.advanceTimersByTimeAsync(25000);
    await expectations[1];
    expect(queue.getState()).toMatchObject({ queued: 0, admitted: 1 });
    // A deadline already past cannot wait at all.
    await expect(queue.admit({ key: 'route', attemptId: 'late', requesterId: 'r3', deadlineAt: Date.now(), ...gate }))
      .rejects.toMatchObject({ code: 'CAPACITY_QUEUE_TIMEOUT', bound: 'authorization' });
    held.release();
  });

  it('removes a cancelled wait with its reason, holds nothing for it, and admits the next arrival instead', async () => {
    const queue = createPartitionAttemptQueue({ policy: policy() }), gate = route(1);
    const held = await queue.admit({ key: 'route', attemptId: 'held', requesterId: 'r0', ...gate });
    const controller = new AbortController();
    const cancelled = queue.admit({ key: 'route', attemptId: 'gone', requesterId: 'r1', signal: controller.signal, ...gate });
    const next = queue.admit({ key: 'route', attemptId: 'next', requesterId: 'r2', ...gate });
    controller.abort(new Error('Response stopped'));
    await expect(cancelled).rejects.toThrow('Response stopped');
    expect(queue.getState()).toMatchObject({ queued: 1, admitted: 1, opening: 1 });
    held.release();
    const ticket = await next;
    expect(queue.getState()).toMatchObject({ queued: 0, admitted: 1 });
    ticket.opened(); ticket.opened();
    expect(queue.getState().opening).toBe(0);
    ticket.release(); ticket.release();
    expect(queue.getState()).toMatchObject({ admitted: 0, opening: 0 });
    // An aborted signal admits nothing.
    await expect(queue.admit({ key: 'route', attemptId: 'aborted', requesterId: 'r3', signal: AbortSignal.abort(new Error('stopped')), ...gate }))
      .rejects.toThrow('stopped');
  });

  it('refuses a waiting entry with the gate\'s own error when its route can no longer run it', async () => {
    let closed = false;
    const queue = createPartitionAttemptQueue({ policy: policy() });
    const gate = { check: ({ admitted }) => { if (closed) throw Object.assign(new Error(failureMessages.CAPACITY_UNAVAILABLE), { code: 'CAPACITY_UNAVAILABLE' }); return admitted < 1; } };
    const held = await queue.admit({ key: 'route', attemptId: 'held', requesterId: 'r0', ...gate });
    const waiting = queue.admit({ key: 'route', attemptId: 'w', requesterId: 'r1', ...gate });
    closed = true; queue.pump();
    await expect(waiting).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(queue.getState().queued).toBe(0);
    held.release();
  });
});
