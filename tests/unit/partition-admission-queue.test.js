import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceAdmission } from '../../packages/reploid/src/mesh/partitions/partition-device-admission.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';

// Admission accounting with injected sessions: proves bounded, fair waiting, not physical capacity.
afterEach(() => { vi.useRealTimers(); });
const owner = { stage: 1 };
const queue = { maxQueued: 4, maxQueuedPerRequester: 2, maxWaitMs: 30000 };
function device(options = {}) {
  const admission = createDeviceAdmission({ maxBytes: 1000, maxConcurrentAttempts: 1, queue, ...options });
  admission.admitResident(owner, 100);
  return admission;
}
const admit = (admission, attemptId, routeKey, requesterId = attemptId, extra = {}) =>
  admission.admit({ owner, attemptId, bytes: 10, routeKey, requesterId, ...extra });
const order = () => { const granted = []; return { granted, track: (promise, id) => promise.then(() => granted.push(id)) }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('fair bounded admission queue (opt-in)', () => {
  it('waits instead of failing, then grants the route with the fewest admitted attempts before arrival order', async () => {
    const d = device({ maxConcurrentAttempts: 2 }), seen = order();
    await admit(d, 'a1', 'route-a'); await admit(d, 'a2', 'route-a');
    // Route A floods the queue first; route B arrives later with nothing admitted.
    const waits = [seen.track(admit(d, 'a3', 'route-a'), 'a3'), seen.track(admit(d, 'a4', 'route-a', 'a3'), 'a4'),
      seen.track(admit(d, 'b1', 'route-b'), 'b1')];
    expect(d.getState()).toMatchObject({ active: 2, queued: 3, maxQueued: 4 });
    expect(d.available(10)).toBe(0);
    d.release(owner, 'a1'); await flush();
    expect(seen.granted).toEqual(['b1']); // route B (0 admitted) before route A's earlier arrivals
    d.release(owner, 'a2'); await flush();
    d.release(owner, 'b1'); await Promise.all(waits);
    expect(seen.granted).toEqual(['b1', 'a3', 'a4']); // then first come, first served
  });

  it('bounds queue length and waiting per requester with a clear unavailable code', async () => {
    const d = device(), seen = order();
    await admit(d, 'held', 'route-a');
    const waits = [seen.track(admit(d, 'r1', 'route-a', 'requester'), 'r1'), seen.track(admit(d, 'r2', 'route-a', 'requester'), 'r2')];
    await expect(admit(d, 'r3', 'route-a', 'requester')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    waits.push(seen.track(admit(d, 'x1', 'route-b'), 'x1'), seen.track(admit(d, 'x2', 'route-b'), 'x2'));
    await expect(admit(d, 'x3', 'route-b')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(d.getState().queued).toBe(4);
    // One slot: routes alternate, least recently served first, and every bounded wait is admitted.
    for (const id of ['held', 'x1', 'r1', 'x2']) { d.release(owner, id); await flush(); }
    await Promise.all(waits);
    expect(seen.granted).toEqual(['x1', 'r1', 'x2', 'r2']);
  });

  it('fails a wait that outlives maxWaitMs and removes a cancelled wait without charging it', async () => {
    vi.useFakeTimers();
    const d = device();
    await admit(d, 'held', 'route-a');
    const expired = admit(d, 'late', 'route-b');
    const failure = expect(expired).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    const controller = new AbortController(), cancelled = admit(d, 'cancelled', 'route-c', 'c', { signal: controller.signal });
    controller.abort(Error('requester cancelled'));
    await expect(cancelled).rejects.toThrow('requester cancelled');
    await vi.advanceTimersByTimeAsync(queue.maxWaitMs);
    await failure;
    expect(d.getState()).toMatchObject({ active: 1, queued: 0 });
    d.release(owner, 'held'); expect(d.getState().active).toBe(0);
  });

  it('without a queue configured, a full device refuses immediately', async () => {
    const d = createDeviceAdmission({ maxBytes: 1000, maxConcurrentAttempts: 1 });
    d.admitResident(owner, 100); await admit(d, 'held', 'route-a');
    await expect(admit(d, 'next', 'route-b')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(d.getState()).not.toHaveProperty('queued');
  });
});

describe('queued reservations through an ordered resident', () => {
  const sha = 'sha256:' + 'a'.repeat(64);
  const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'm', stageCount: 2,
    partitions: [0, 1].map(index => ({ index, layerRange: [index, index] })) };
  const activation = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
  const stages = [0, 1].map(index => ({ index, participantId: 'p' + index, transportId: 't' + index, residentId: 'r' + index, executionId: 'e' + index }));
  const orderedRuntime = { hashLayerPartitionPlan: () => sha, hashPartitionGeneration: () => sha, getPartitionActivationContract: () => activation };
  const identity = (attemptId, coordinator = 'p0') => ({ schema: 'reploid.partition-attempt/v2', threadId: attemptId, attemptId, requesterId: attemptId,
    placementGeneration: 0, route: { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha,
      stages: [{ ...stages[0], participantId: coordinator }, stages[1]], activation } });
  async function contributor(admission) {
    const session = { getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, modelId: 'm', modelIdentity: sha, planId: sha,
      index: 1, stageCount: 2, layerRange: [1, 1], residentWeightBytes: 100, generationDigest: sha }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: vi.fn(), executeStage: vi.fn(), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const resident = createResidentPartition({ runtime: { openResidentPartition: async () => session }, model: { id: 'm', identity: sha, generation: {} },
      plan, planId: sha, index: 1, participantId: 'p1', limits: { maxAttempts: 20, maxConcurrentAttempts: 4 },
      ordered: { runtime: orderedRuntime, stage: stages[1] }, device: admission, attemptBytes: 10 });
    await resident.prepare({ approved: true });
    return resident;
  }

  it('admits a waiting attempt from another coordinator once the first settles, and advertises the queue', async () => {
    const admission = createDeviceAdmission({ maxBytes: 1000, maxConcurrentAttempts: 1, queue });
    const resident = await contributor(admission);
    await resident.reserve({ identity: identity('first', 'coordinator-a'), partitionIndex: 1 });
    const waiting = resident.reserve({ identity: identity('second', 'coordinator-b'), partitionIndex: 1 });
    await Promise.resolve();
    expect(resident.getState().reservations).toMatchObject({ active: 1, availableSlots: 0, device: { queued: 1, maxQueued: 4 } });
    await resident.closeAttempt({ identity: identity('first', 'coordinator-a') });
    await expect(waiting).resolves.toMatchObject({ status: 'reserved', partitionIndex: 1 });
    expect(resident.getState().reservations.device).toMatchObject({ active: 1, queued: 0 });
  });

  it('closing the resident ends its waiting reservations instead of leaving them pending', async () => {
    const admission = createDeviceAdmission({ maxBytes: 1000, maxConcurrentAttempts: 1, queue });
    const resident = await contributor(admission);
    await resident.reserve({ identity: identity('first'), partitionIndex: 1 });
    const waiting = resident.reserve({ identity: identity('second'), partitionIndex: 1 });
    const failure = expect(waiting).rejects.toThrow();
    await resident.close(); await failure;
    expect(admission.getState()).toMatchObject({ residents: 0, active: 0, queued: 0 });
  });
});
