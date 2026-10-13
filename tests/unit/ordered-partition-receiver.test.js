import { describe, it, expect, vi } from 'vitest';
import { createPartitionStepReceiver } from '../../packages/reploid/src/mesh/partitions/partition-step-receiver.js';
import { partitionFingerprint } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { fixture as runnerFixture } from '../fixtures/ordered-partition-ports.js';
function fixture() {
  const route = runnerFixture(3).route;
  const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'attempt', requesterId: 'requester', placementGeneration: 0, route };
  const executeStep = vi.fn(async request => ({ identity: request.identity, partitionIndex: 1, step: request.step, output: [1,2] }));
  const authorize = vi.fn(async () => true), settleAttempt = vi.fn(async () => {});
  const receiver = createPartitionStepReceiver({ executeStep, authorize, settleAttempt,
    fingerprint: request => partitionFingerprint(request), limits: { maxAttempts: 10, maxSteps: 5 }, ordered: { stage: route.stages[1] } });
  const request = { identity, partitionIndex: 1, step: 0, tokenPosition: 0, inputTokenCount: 2, maxTokens: 3, payload: [1,2], grant: {} };
  return { receiver, request, executeStep, authorize, settleAttempt };
}
describe('ordered receiver reuses authenticated ordering and settlement owner', () => {
  it('deduplicates an exact middle stage and refuses replay after disclosure revocation', async () => {
    const f = fixture(); const results = await Promise.all([f.receiver.receive(f.request), f.receiver.receive(f.request)]);
    expect(results[0]).toEqual(results[1]); expect(f.executeStep).toHaveBeenCalledTimes(1);
    f.authorize.mockResolvedValue(false); await expect(f.receiver.receive(f.request)).rejects.toThrow('authorization declined');
    await f.receiver.close();
  });
  it('rejects stage substitution, changed route, payload collision and out-of-order decode', async () => {
    const f = fixture();
    await expect(f.receiver.receive({ ...f.request, partitionIndex: 2 })).rejects.toThrow('stage');
    await f.receiver.receive(f.request);
    const changed = structuredClone(f.request); changed.identity.route.stages[0].executionId = 'changed';
    await expect(f.receiver.receive(changed)).rejects.toThrow('identity collision');
    await expect(f.receiver.receive({ ...f.request, payload: [9] })).rejects.toThrow('payload collision');
    await expect(f.receiver.receive({ ...f.request, step: 2, tokenPosition: 2, inputTokenCount: 1 })).rejects.toThrow('Out-of-order');
    await f.receiver.close();
  });
  it('retains cancellation tombstones and retries failed cleanup without reexecuting', async () => {
    const f = fixture(); await f.receiver.receive(f.request);
    f.settleAttempt.mockRejectedValueOnce(Error('unsettled'));
    await expect(f.receiver.closeAttempt(f.request.identity)).rejects.toThrow('unsettled');
    await expect(f.receiver.receive(f.request)).rejects.toThrow('retired');
    await f.receiver.closeAttempt(f.request.identity); expect(f.settleAttempt).toHaveBeenCalledTimes(2);
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    const fresh = { ...f.request.identity, attemptId: 'cancel-before-admit' };
    await f.receiver.closeAttempt(fresh);
    await expect(f.receiver.receive({ ...f.request, identity: fresh })).rejects.toThrow('retired');
    await f.receiver.close();
  });
});
