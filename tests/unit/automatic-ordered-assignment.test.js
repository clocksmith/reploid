import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { fixture as stagesFixture } from '../fixtures/ordered-partition-ports.js';

// Injected discovery and numerical stages: proves the contributor's own stage choice, not GPU execution.
const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, capabilities: [], observe: null,
      getSnapshot: () => structuredClone(owner.capabilities), getModels: () => [],
      // Yields first, so concurrent joiners all enter waiting before any of them observes.
      refresh: vi.fn(async () => { await Promise.resolve(); if (owner.observe) owner.capabilities = owner.observe(); }),
      invalidateModel: vi.fn(), close: vi.fn(async () => {}) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; vi.useRealTimers(); });

const f = stagesFixture(3);
const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic', partitionPlan: { stageCount: 3 } };
const policy = { pollMs: 60000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000, maxStageOffersPerPeer: 4,
  limits: f.limits, receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: { maxControlBytes: 131072 },
  inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 32, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 } };
// A ready stage offer as discovery observes it from another participant.
function offer(participantId, index, at = Date.now()) {
  return { participantId, transportId: 'transport-' + participantId, available: true, observedAt: at, expiresAt: at + 600000,
    description: { schema: 'reploid.partition-capability/v2', participantId, phase: 'ready',
      capacity: { active: 0, availableSlots: 2, closed: false }, models: [{ ...model, index, planId: f.route.planId,
        residentId: 'resident-' + participantId, executionId: 'execution-' + participantId, activation: f.route.activation, availability: 'ready' }] } };
}
const observed = (description, at = Date.now()) => ({ participantId: description.participantId, transportId: 'transport-' + description.participantId,
  available: true, observedAt: at, expiresAt: at + 600000, description: structuredClone(description) });

async function contributor({ dwellMs = 60000, identity } = {}) {
  identity ||= await createSigningIdentity({ algorithm: 'ECDSA' });
  const residents = [];
  const loadProgram = vi.fn(async (_model, index, controls) => {
    const stage = controls.ordered.stage, reservations = { active: 0, availableSlots: 2, closed: false };
    const resident = { id: stage.participantId, index, transportId: stage.transportId, residentId: stage.residentId,
      executionId: stage.executionId, reservations, drain: vi.fn(async () => {}), close: vi.fn(async () => {}),
      reserve: vi.fn(), executeStage: vi.fn(), closeAttempt: vi.fn(async () => {}), subscribe: () => () => {},
      getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index,
        planId: f.route.planId, stageCount: 3 }, reservations: { ...reservations } }) };
    residents.push(resident);
    return { resident, runtime: f.runtime, model, plan: f.plan, planId: f.route.planId };
  });
  const networks = [];
  const createNetwork = vi.fn(options => { const owner = { options, close: vi.fn(async () => {}), retire: vi.fn(async () => {}),
    connect: vi.fn(async () => { throw Error('no route in this control'); }) }; networks.push(owner); return owner; });
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy, peers: () => [], createNetwork, loadProgram,
    ordered: { stage: null, maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256,
      orchestration: { autoStage: { transportId: 'auto-transport', dwellMs } } } });
  cleanups.push(() => mesh.close());
  return { identity, mesh, loadProgram, residents, networks, discovery: discoveryOwners.at(-1) };
}

describe('autonomous cold stage assignment (opt-in, injected discovery)', () => {
  it('prepares the least-supplied stage from observed ready offers and advertises its own claim', async () => {
    const c = await contributor();
    c.discovery.capabilities = [offer('coordinator', 0), offer('b', 1)];
    await c.mesh.contribute('model', true);
    expect(c.loadProgram).toHaveBeenCalledOnce();
    const [, index, controls] = c.loadProgram.mock.calls[0];
    expect(index).toBe(2);
    expect(controls.ordered.stage).toMatchObject({ index: 2, participantId: c.identity.peerId, transportId: 'auto-transport' });
    expect(controls.ordered.stage.residentId).toMatch(/^auto-[a-f0-9]{32}$/);
    const described = c.discovery.options.describe();
    expect(described.assignment).toEqual({ schema: 'reploid.stage-assignment/v1', modelId: 'model', modelIdentity: model.identity, index: 2 });
    expect(described.models[0]).toMatchObject({ index: 2, availability: 'ready' });
    expect(c.mesh.getState()).toMatchObject({ phase: 'ready', assignment: { index: 2, reason: 'cold-least-supplied', supply: [1, 1, 0] } });
    await c.mesh.stop();
    expect(c.mesh.getState().assignment).toBeNull();
    expect(c.discovery.options.describe().assignment).toBeUndefined();
  });

  it('spreads simultaneous joiners that observe each other across stages', async () => {
    const one = await contributor(), two = await contributor();
    // Each observes the coordinator and the other's live unassigned claim.
    one.discovery.observe = () => [offer('coordinator', 0), observed(two.discovery.options.describe())];
    two.discovery.observe = () => [offer('coordinator', 0), observed(one.discovery.options.describe())];
    one.discovery.capabilities = one.discovery.observe(); two.discovery.capabilities = two.discovery.observe();
    // Both enter waiting before either observes.
    await Promise.all([one.mesh.contribute('model', true), two.mesh.contribute('model', true)]);
    const chosen = [one, two].map(c => c.loadProgram.mock.calls[0][1]);
    expect(new Set(chosen)).toEqual(new Set([1, 2]));
    const lower = one.identity.peerId < two.identity.peerId ? one : two;
    expect(lower.loadProgram.mock.calls[0][1]).toBe(1);
  });

  it('never moves an active conversation; moves an idle resident only after dwell and past hysteresis', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const c = await contributor({ dwellMs: 120000 });
    c.discovery.observe = () => [offer('coordinator', 0), offer('~late', 2)];
    await c.mesh.contribute('model', true);
    expect(c.loadProgram.mock.calls[0][1]).toBe(1);
    // A lower-id contributor joins stage 1; stage 2 departs. This one has the highest id on its stage.
    c.discovery.observe = () => [offer('coordinator', 0), offer('!early', 1)];
    await vi.advanceTimersByTimeAsync(60000);
    expect(c.loadProgram).toHaveBeenCalledOnce(); // dwell not yet elapsed
    c.residents[0].reservations.active = 1;
    await vi.advanceTimersByTimeAsync(120000);
    expect(c.loadProgram).toHaveBeenCalledOnce(); // an admitted attempt pins the stage
    expect(c.residents[0].close).not.toHaveBeenCalled();
    c.residents[0].reservations.active = 0;
    await vi.advanceTimersByTimeAsync(60000);
    expect(c.residents[0].drain).toHaveBeenCalledOnce();
    expect(c.residents[0].close).toHaveBeenCalledOnce();
    expect(c.loadProgram).toHaveBeenCalledTimes(2);
    expect(c.loadProgram.mock.calls[1][1]).toBe(2);
    expect(c.mesh.getState()).toMatchObject({ phase: 'ready', assignment: { reason: 'rebalance', index: 2 } });
    expect(c.loadProgram.mock.calls[1][2].ordered.stage.residentId).not.toBe(c.loadProgram.mock.calls[0][2].ordered.stage.residentId);
  });

  it('keeps its stage when only the lower id shares it or the gap is within hysteresis', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const c = await contributor({ dwellMs: 0 });
    c.discovery.observe = () => [offer('coordinator', 0), offer('~late', 2)];
    await c.mesh.contribute('model', true);
    c.discovery.observe = () => [offer('coordinator', 0), offer('~high', 1)];
    await vi.advanceTimersByTimeAsync(180000);
    c.discovery.observe = () => [offer('coordinator', 0), offer('!early', 1), offer('~late', 2)];
    await vi.advanceTimersByTimeAsync(180000);
    expect(c.loadProgram).toHaveBeenCalledOnce();
    expect(c.mesh.getState().assignment).toMatchObject({ reason: 'retain', index: 1 });
  });

  it('rejects an auto policy without an authenticated transport or alongside an assigned stage', async () => {
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    const base = { identity, meshId: 'mesh', models: [model], policy, peers: () => [], createNetwork: () => ({ close() {} }), loadProgram() {} };
    expect(() => createAutomaticPartitions({ ...base, ordered: { stage: null, maxRouteBytes: 1, maxRoutes: 1, maxSelectionSteps: 1,
      orchestration: { autoStage: { dwellMs: 0 } } } })).toThrow('authenticated transport');
    expect(() => createAutomaticPartitions({ ...base, ordered: { stage: null, maxRouteBytes: 1, maxRoutes: 1, maxSelectionSteps: 1,
      orchestration: { replicate: {} } } })).toThrow('Unknown ordered orchestration policy');
  });
});
