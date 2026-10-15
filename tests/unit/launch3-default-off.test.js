import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { snapshotWorkOrderedParticipation, bindWorkOrderedParticipation } from '../../self/host/work-partition-plan.js';
import { getOrderedParticipation } from '../../self/host/product-context.js';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };
import { fixture as stagesFixture } from '../fixtures/ordered-partition-ports.js';
import { coordinatorFixture } from '../fixtures/automatic-ordered-coordinator.js';

// Launch 1 candidate behavior with no `ordered.orchestration` member. Every Launch 3 mechanism
// must leave these observations unchanged until a host explicitly enables it.
const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, capabilities: [], getSnapshot: () => structuredClone(owner.capabilities), getModels: () => [],
      refresh: vi.fn(async () => {}), invalidateModel: vi.fn(), close: vi.fn(async () => {}) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; vi.useRealTimers(); });

const f = stagesFixture(3);
const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic',
  partitionPlan: { schema: 'doppler.layer-partition-contract/v3', stageCount: 3 } };
const policy = { pollMs: 60000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000, maxStageOffersPerPeer: 4,
  limits: f.limits, receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: { maxControlBytes: 131072 },
  inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 32, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 } };
const offer = (participantId, index, at = Date.now()) => ({ participantId, transportId: 'transport-' + participantId, available: true,
  observedAt: at, expiresAt: at + 6e8, description: { schema: 'reploid.partition-capability/v2', participantId, phase: 'ready',
    capacity: { active: 0, availableSlots: 2, closed: false }, models: [{ ...model, index, planId: f.route.planId,
      residentId: 'r-' + participantId, executionId: 'e-' + participantId, activation: f.route.activation, availability: 'ready' }] } });

async function launch1(stageIndex) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const stage = stageIndex === null ? null : { index: stageIndex, participantId: identity.peerId, transportId: 'operator-transport',
    residentId: 'operator-resident', executionId: 'operator-execution' };
  const resident = stage && { id: identity.peerId, index: stageIndex, transportId: stage.transportId, residentId: stage.residentId,
    executionId: stage.executionId, close: vi.fn(async () => {}), drain: vi.fn(async () => {}), subscribe: () => () => {},
    getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index: stageIndex,
      planId: f.route.planId, stageCount: 3 }, reservations: { active: 0, availableSlots: 2, closed: false } }) };
  const loadProgram = vi.fn(async () => ({ resident, runtime: f.runtime, model, plan: f.plan, planId: f.route.planId }));
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy, peers: () => [], loadProgram,
    createNetwork: () => ({ close: vi.fn(async () => {}), retire: vi.fn(async () => {}), connect: vi.fn(async () => { throw Error('none'); }) }),
    ordered: { stage, maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256 } });
  cleanups.push(() => mesh.close());
  return { mesh, loadProgram, resident, discovery: discoveryOwners.at(-1) };
}

describe('Launch 3 mechanisms are off by default (Launch 1 candidate behavior)', () => {
  it('only an operator-assigned stage contributes, whatever discovery observes', async () => {
    const c = await launch1(null);
    c.discovery.capabilities = [offer('coordinator', 0), offer('b', 1)];
    await expect(c.mesh.contribute('model', true)).rejects.toThrow('Approve an explicitly assigned stage before contributing');
    expect(c.loadProgram).not.toHaveBeenCalled();
    expect(c.discovery.options.describe()).not.toHaveProperty('assignment');
  });

  it('an assigned stage keeps the Launch 1 capability shape and never moves, even when over-supplied and idle', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const c = await launch1(1);
    c.discovery.capabilities = [offer('coordinator', 0), offer('!a', 1), offer('!b', 1)];
    await c.mesh.contribute('model', true);
    await vi.advanceTimersByTimeAsync(10 * policy.pollMs);
    expect(c.loadProgram).toHaveBeenCalledOnce();
    expect(c.resident.close).not.toHaveBeenCalled(); expect(c.resident.drain).not.toHaveBeenCalled();
    expect(Object.keys(c.discovery.options.describe())).toEqual(['schema', 'participantId', 'phase', 'models', 'capacity']);
    expect(c.mesh.getState()).not.toHaveProperty('assignment');
  });

  it('a coordinator keeps its healthy first-valid route: no ranking, no spill, no observations', async () => {
    const c = await coordinatorFixture({ discoveryOwners, cleanups });
    await c.mesh.contribute('model', true);
    expect(c.stageOne()).toBe('node-1');
    await c.generate('first');
    c.capacity.set('node-1', 0); // a stage hint alone does not move new attempts off a healthy route
    expect((await c.generate('second')).content).toBe('012');
    expect(c.stageOne()).toBe('node-1');
    expect(c.replica.executeStage).not.toHaveBeenCalled();
    expect(c.mesh.getState().placementDecision.reason).toBe('retain-prepared-route');
    expect(c.mesh.getState()).not.toHaveProperty('routeObservations');
    expect(Object.keys(c.discovery.options.describe())).toEqual(['schema', 'participantId', 'phase', 'models', 'capacity']);
  });

  it('without a shared device, each resident admits by its own slots and loaders receive no device', async () => {
    const c = await launch1(1);
    await c.mesh.contribute('model', true);
    expect(c.loadProgram.mock.calls[0][2]).not.toHaveProperty('device');
    expect(c.loadProgram.mock.calls[0][2]).not.toHaveProperty('attemptBytes');
    expect(c.discovery.options.describe().capacity).toEqual({ active: 0, availableSlots: 2, closed: false });
  });

  it('a full ordered resident without a shared device refuses immediately with the Launch 1 error, never queues', async () => {
    const sha = 'sha256:' + 'a'.repeat(64), stage = { index: 1, participantId: 'p1', transportId: 't1', residentId: 'r1', executionId: 'e1' };
    const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'm', stageCount: 2, partitions: [0, 1].map(index => ({ index, layerRange: [index, index] })) };
    const activation = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
    const resident = createResidentPartition({ runtime: { openResidentPartition: async () => ({ getDescriptor: () => ({ schema: 'doppler.resident-partition/v2',
      ready: true, modelId: 'm', modelIdentity: sha, planId: sha, index: 1, stageCount: 2, layerRange: [1, 1], residentWeightBytes: 1, generationDigest: sha }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize() {}, executeStage() {}, closeAttempt: async () => {}, close: async () => {} }) }, model: { id: 'm', identity: sha, generation: {} },
    plan, planId: sha, index: 1, participantId: 'p1', limits: { maxAttempts: 8, maxConcurrentAttempts: 1 },
    ordered: { runtime: { hashLayerPartitionPlan: () => sha, hashPartitionGeneration: () => sha, getPartitionActivationContract: () => activation }, stage } });
    cleanups.push(() => resident.close());
    await resident.prepare({ approved: true });
    const identity = attemptId => ({ schema: 'reploid.partition-attempt/v2', threadId: attemptId, attemptId, requesterId: 'q', placementGeneration: 0,
      route: { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha, activation,
        stages: [{ index: 0, participantId: 'p0', transportId: 't0', residentId: 'r0', executionId: 'e0' }, stage] } });
    await resident.reserve({ identity: identity('a'), partitionIndex: 1 });
    await expect(resident.reserve({ identity: identity('b'), partitionIndex: 1 })).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(resident.getState().reservations).not.toHaveProperty('device');
  });

  it('host configuration without orchestration binds exactly the Launch 1 ordered options', () => {
    const stage = { modelId: model.id, index: 1, residentId: 'resident', executionId: 'execution' };
    const storage = value => ({ getItem: key => key === orderedPolicy.stageStorageKey ? value : null });
    const saved = getOrderedParticipation(storage(JSON.stringify(stage)), [model]);
    expect(saved).toEqual({ stage, ...orderedPolicy.limits });
    const bound = bindWorkOrderedParticipation(snapshotWorkOrderedParticipation(saved, null, [model]), 'participant', 'transport', { limits: {} });
    expect(bound.ordered).toEqual({ stage: { index: 1, participantId: 'participant', transportId: 'transport', residentId: 'resident',
      executionId: 'execution' }, maxRouteBytes: orderedPolicy.limits.maxRouteBytes, maxSelectionSteps: orderedPolicy.limits.maxSelectionSteps,
    maxRoutes: orderedPolicy.limits.maxRoutes });
    // The auto choice alone, without its orchestration policy, enables nothing.
    expect(() => snapshotWorkOrderedParticipation(getOrderedParticipation(storage(JSON.stringify({ modelId: model.id, assignment: 'auto' })), [model]),
      null, [model])).toThrow('Automatic ordered stage requires both the operator auto choice and its orchestration policy');
  });
});
