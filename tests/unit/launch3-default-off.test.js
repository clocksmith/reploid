import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { snapshotWorkOrderedParticipation, bindWorkOrderedParticipation } from '../../self/host/work-partition-plan.js';
import { getOrderedParticipation } from '../../self/host/product-context.js';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };
import { fixture as stagesFixture } from '../fixtures/ordered-partition-ports.js';

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
