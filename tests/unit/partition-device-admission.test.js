import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createDeviceAdmission } from '../../packages/reploid/src/mesh/partitions/partition-device-admission.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';

const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, getSnapshot: () => [], getModels: () => [], refresh: vi.fn(async () => {}),
      invalidateModel: vi.fn(), close: vi.fn(async () => {}) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; });

// Injected Doppler sessions: proves admission accounting, not physical memory or GPU residency.
const sha = 'sha256:' + 'a'.repeat(64);
const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'm', stageCount: 3,
  partitions: [0, 1, 2].map(index => ({ index, layerRange: [index * 2, index * 2 + 1] })) };
const activation = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
const stages = [0, 1, 2].map(index => ({ index, participantId: 'p' + index, transportId: 't' + index, residentId: 'r' + index, executionId: 'e' + index }));
const route = { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha, stages, activation };
const orderedRuntime = { hashLayerPartitionPlan: () => sha, hashPartitionGeneration: () => sha, getPartitionActivationContract: () => activation };
const identity = attemptId => ({ schema: 'reploid.partition-attempt/v2', threadId: attemptId, attemptId, requesterId: 'requester', placementGeneration: 0, route });
const WEIGHTS = 400, ATTEMPT = 100;

// One device hosting two resident stages of one route, each with its own two local slots.
function resident(index, device, weights = WEIGHTS) {
  const session = { getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, modelId: 'm', modelIdentity: sha,
    planId: sha, index, stageCount: 3, layerRange: plan.partitions[index].layerRange, residentWeightBytes: weights, generationDigest: sha }),
  getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
  tokenize: vi.fn(), executeStage: vi.fn(), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const owner = createResidentPartition({ runtime: { openResidentPartition: vi.fn(async () => session) }, model: { id: 'm', identity: sha, generation: { maxTokens: 3 } },
    plan, planId: sha, index, participantId: 'p' + index, limits: { maxAttempts: 20, maxConcurrentAttempts: 2 },
    ordered: { runtime: orderedRuntime, stage: stages[index] }, ...(device ? { device, attemptBytes: ATTEMPT } : {}) });
  return { owner, session, reserve: id => owner.reserve({ identity: identity(id), partitionIndex: index }),
    close: id => owner.closeAttempt({ identity: identity(id) }) };
}

describe('shared device admission (opt-in)', () => {
  it('charges one device budget across two resident stages instead of per-stage slots', async () => {
    // Room for both residents' weights and exactly one attempt allocation.
    const device = createDeviceAdmission({ maxBytes: 2 * WEIGHTS + ATTEMPT, maxConcurrentAttempts: 4 });
    const one = resident(1, device), two = resident(2, device);
    await one.owner.prepare({ approved: true }); await two.owner.prepare({ approved: true });
    expect(device.getState()).toMatchObject({ residents: 2, residentBytes: 800, availableBytes: ATTEMPT });
    await one.reserve('first');
    // Stage 2 still has two local slots, but the device has no bytes left: a clear unavailable state.
    expect(two.owner.getState().reservations.availableSlots).toBe(0);
    await expect(two.reserve('second')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(two.owner.getState().reservations.active).toBe(0);
    await one.close('first');
    expect(two.owner.getState().reservations.availableSlots).toBe(1);
    await two.reserve('second');
    expect(device.getState()).toMatchObject({ active: 1, attemptBytes: ATTEMPT });
    await two.close('second'); await one.owner.close(); await two.owner.close();
    expect(device.getState()).toMatchObject({ residents: 0, residentBytes: 0, active: 0, availableBytes: 2 * WEIGHTS + ATTEMPT });
  });

  it('shares the device slot count across residents and routes', async () => {
    const device = createDeviceAdmission({ maxBytes: 10_000, maxConcurrentAttempts: 2 });
    const one = resident(1, device), two = resident(2, device);
    await one.owner.prepare({ approved: true }); await two.owner.prepare({ approved: true });
    await one.reserve('a'); await two.reserve('b');
    await expect(one.reserve('c')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    // Re-admitting an attempt already charged does not charge it twice.
    await one.reserve('a');
    expect(device.getState().active).toBe(2);
  });

  it('never offers a resident whose weights do not fit the remaining device budget', async () => {
    const device = createDeviceAdmission({ maxBytes: WEIGHTS + 50, maxConcurrentAttempts: 2 });
    const one = resident(1, device), two = resident(2, device);
    await one.owner.prepare({ approved: true });
    await expect(two.owner.prepare({ approved: true })).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
    expect(two.owner.getState().ready).toBe(false); expect(two.session.close).toHaveBeenCalledOnce();
    expect(device.getState()).toMatchObject({ residents: 1, residentBytes: WEIGHTS });
  });

  it('keeps an attempt charged while its cleanup is unknown and releases it only after settlement', async () => {
    const device = createDeviceAdmission({ maxBytes: 10_000, maxConcurrentAttempts: 1 });
    const one = resident(1, device);
    await one.owner.prepare({ approved: true }); await one.reserve('a');
    one.session.closeAttempt.mockRejectedValueOnce(Error('cleanup unknown'));
    await expect(one.close('a')).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(device.getState().active).toBe(1);
    await one.close('a');
    expect(device.getState().active).toBe(0);
    // Weights stay charged if the provider close fails, and are released once it succeeds.
    one.session.close.mockRejectedValueOnce(Error('provider close unknown'));
    await expect(one.owner.close()).rejects.toThrow('provider close unknown');
    expect(device.getState().residents).toBe(1);
    await one.owner.close(); expect(device.getState().residents).toBe(0);
  });

  it('rejects a shared device without an explicit attempt allocation', () => {
    const device = createDeviceAdmission({ maxBytes: 1, maxConcurrentAttempts: 1 });
    expect(() => createResidentPartition({ runtime: { openResidentPartition() {} }, model: { id: 'm', identity: sha }, plan, planId: sha, index: 1,
      participantId: 'p1', limits: {}, ordered: { runtime: orderedRuntime, stage: stages[1] }, device })).toThrow('explicit attempt allocation');
    expect(() => createDeviceAdmission({ maxBytes: 0, maxConcurrentAttempts: 1 })).toThrow('Explicit device admission budget required');
  });
});

describe('automatic owner with shared device admission (opt-in)', () => {
  it.each([[undefined, {}], [{ maxQueued: 2, maxQueuedPerRequester: 1, maxWaitMs: 1000 }, { queued: 0, maxQueued: 2 }]])(
    'hands one device budget to the resident it prepares and advertises device-limited capacity (queue %o)', async (queue, advertised) => {
    const peer = await createSigningIdentity({ algorithm: 'ECDSA' });
    const stage = { ...stages[1], participantId: peer.peerId }, residents = [];
    const loadProgram = vi.fn(async (_model, index, controls) => {
      expect(controls.attemptBytes).toBe(ATTEMPT);
      const session = { getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, modelId: 'm', modelIdentity: sha,
        planId: sha, index, stageCount: 3, layerRange: plan.partitions[index].layerRange, residentWeightBytes: WEIGHTS, generationDigest: sha }),
      getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
      tokenize: vi.fn(), executeStage: vi.fn(), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
      const owner = createResidentPartition({ runtime: { openResidentPartition: async () => session }, model: { id: 'm', identity: sha, generation: {} },
        plan, planId: sha, index, participantId: peer.peerId, limits: { maxAttempts: 20, maxConcurrentAttempts: 2 },
        ordered: { runtime: orderedRuntime, stage: controls.ordered.stage }, device: controls.device, attemptBytes: controls.attemptBytes });
      await owner.prepare({ approved: true }); residents.push(owner);
      return { resident: owner, runtime: orderedRuntime, model: { id: 'm', identity: sha }, plan, planId: sha };
    });
    const mesh = createAutomaticPartitions({ identity: peer, meshId: 'mesh', models: [{ id: 'm', identity: sha }], loadProgram, peers: () => [],
      policy: { pollMs: 3600000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000, maxStageOffersPerPeer: 4,
        limits: { maxTokens: 10, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 100, maxAttempts: 100, maxConcurrentAttempts: 2, maxStages: 8, stageTimeoutMs: 1000 },
        receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: {}, inputLimits: { descriptorTtlMs: 60000 } },
      createNetwork: () => ({ close: vi.fn(async () => {}), retire: vi.fn(async () => {}), connect: vi.fn() }),
      ordered: { stage, maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256,
        orchestration: { admission: { maxBytes: WEIGHTS + ATTEMPT, maxConcurrentAttempts: 2, attemptBytes: ATTEMPT, ...(queue ? { queue } : {}) } } } });
    cleanups.push(() => mesh.close());
    await mesh.contribute('m', true);
    expect(loadProgram.mock.calls[0][2].device.getState()).toMatchObject({ residents: 1, residentBytes: WEIGHTS });
    // Two local slots, but the device budget holds one attempt next to the weights.
    expect(discoveryOwners.at(-1).options.describe().capacity).toEqual({ active: 0, availableSlots: 1, closed: false, ...advertised });
    const only = identity('only'); only.route = { ...route, stages: route.stages.map(row => row.index === 1 ? stage : row) };
    await residents[0].reserve({ identity: only, partitionIndex: 1 });
    expect(discoveryOwners.at(-1).options.describe().capacity).toEqual({ active: 1, availableSlots: 0, closed: false, ...advertised });
  });
});
