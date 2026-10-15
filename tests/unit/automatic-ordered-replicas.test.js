import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { coordinatorFixture } from '../fixtures/automatic-ordered-coordinator.js';
import { fixture as stagesFixture } from '../fixtures/ordered-partition-ports.js';

// Injected discovery and numerical stages in one process: proves replica choice and routing, not
// separate hardware, physical speedup or capacity.
const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, capabilities: [], observe: null, getSnapshot: () => structuredClone(owner.capabilities), getModels: () => [],
      refresh: vi.fn(async () => { if (owner.observe) owner.capabilities = owner.observe(); }), invalidateModel: vi.fn(), close: vi.fn(async () => {}) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; vi.useRealTimers(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Test cost values only; ranking requires a complete versioned cost policy.
const costs = { schema: 'reploid.route-cost-policy/v1', id: 'test-replica-costs/1', unit: 'test-unit', resolution: 0.001,
  prices: { latencyPerMs: 1, queueingPerMs: 1, transferPerMs: 1, preparationPerMs: 1, refundPerFailure: 0, retryPerFailure: 0 },
  unknown: { prefillMsPerToken: 1, decodeMsPerToken: 1, transferMsPerToken: 0, openingMs: 0, maxObservationAgeMs: 3600000 },
  readiness: { priorAttempts: 1, priorRefusals: 0 }, failure: { priorAttempts: 1, priorFailures: 0 }, reserve: { spareSlots: 0, perMissingSlot: 0 } };
const routeRanking = { margin: 0.2, smoothing: 1, maxObservations: 32, workload: { promptTokens: 2, expectedTokens: 3 }, costs };
const f = stagesFixture(3);
const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic', partitionPlan: { stageCount: 3 } };
const ready = (participantId, index, capacity = {}, at = Date.now()) => ({ participantId, transportId: 'transport-' + participantId, available: true,
  observedAt: at, expiresAt: at + 600000, description: { schema: 'reploid.partition-capability/v2', participantId, phase: 'ready',
    capacity: { active: 0, availableSlots: 2, closed: false, ...capacity }, models: [{ ...model, index, planId: f.route.planId,
      residentId: 'r-' + participantId, executionId: 'e-' + participantId, activation: f.route.activation, availability: 'ready' }] } });
const observedDescription = (description, at = Date.now()) => ({ participantId: description.participantId, transportId: 'transport-coordinator',
  available: true, observedAt: at, expiresAt: at + 600000, description: structuredClone(description) });

async function contributor(replicas, dwellMs = 0) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' }), residents = [];
  const loadProgram = vi.fn(async (_model, index, controls) => {
    const stage = controls.ordered.stage, reservations = { active: 0, availableSlots: 2, closed: false };
    const resident = { id: stage.participantId, index, transportId: stage.transportId, residentId: stage.residentId, executionId: stage.executionId,
      reservations, drain: vi.fn(async () => {}), close: vi.fn(async () => {}), subscribe: () => () => {},
      getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index, planId: f.route.planId, stageCount: 3 },
        reservations: { ...reservations } }) };
    residents.push(resident);
    return { resident, runtime: f.runtime, model, plan: f.plan, planId: f.route.planId };
  });
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], peers: () => [], loadProgram,
    policy: { pollMs: 60000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000, maxStageOffersPerPeer: 4, limits: f.limits,
      receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: {}, inputLimits: { descriptorTtlMs: 600000 } },
    createNetwork: () => ({ close: vi.fn(async () => {}), retire: vi.fn(async () => {}), connect: vi.fn() }),
    ordered: { stage: null, maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256,
      orchestration: { autoStage: { transportId: 'auto', dwellMs }, ...(replicas ? { replicas } : {}) } } });
  cleanups.push(() => mesh.close());
  return { identity, mesh, loadProgram, residents, discovery: discoveryOwners.at(-1) };
}

describe('useful replicas (opt-in, injected discovery and stages)', () => {
  it('a ranking coordinator advertises measured stage costs; an automatic joiner becomes the bottleneck replica', async () => {
    const coordinator = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking }, replicaIndex: 2 });
    const slow = coordinator.stages[2].executeStage.getMockImplementation();
    coordinator.stages[2].executeStage.mockImplementation(async args => { await delay(20); return slow(args); });
    await coordinator.mesh.contribute('model', true);
    await coordinator.generate('measured');
    const described = coordinator.discovery.options.describe();
    expect(described.stageCosts).toMatchObject({ schema: 'reploid.stage-costs/v1', modelId: 'model', planId: coordinator.route.planId });
    expect(described.stageCosts.decodeMs[2]).toBeGreaterThan(2 * Math.max(described.stageCosts.decodeMs[0], described.stageCosts.decodeMs[1]));
    // Every stage is supplied; without replicas a joiner fills the lowest index, with them it joins stage 2.
    const observe = () => [observedDescription(described), ready('node-1', 1), ready('node-2', 2)];
    const withReplicas = await contributor({ queueBound: 4, bottleneckRatio: 2 }, 60000), without = await contributor(null, 60000);
    withReplicas.discovery.observe = observe; without.discovery.observe = observe;
    await withReplicas.mesh.contribute('model', true); await without.mesh.contribute('model', true);
    expect(withReplicas.loadProgram.mock.calls[0][1]).toBe(2);
    expect(withReplicas.mesh.getState().assignment).toMatchObject({ reason: 'replicate-bottleneck', demand: { index: 2, reason: 'bottleneck' } });
    expect(without.loadProgram.mock.calls[0][1]).toBe(0);
  });

  it('an idle contributor moves to a queued stage while its own stage stays supplied; the coordinator routes new attempts to either replica', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const c = await contributor({ queueBound: 1, bottleneckRatio: 2 }, 60000);
    c.discovery.observe = () => [ready('coordinator', 0), ready('node-2', 2)];
    await c.mesh.contribute('model', true);
    expect(c.loadProgram.mock.calls[0][1]).toBe(1);
    // Another contributor joins stage 1 and stage 2 reports a queue above the bound.
    c.discovery.observe = () => [ready('coordinator', 0), ready('!low', 1), ready('node-2', 2, { availableSlots: 0, queued: 3, maxQueued: 8 })];
    await vi.advanceTimersByTimeAsync(60000);
    expect(c.loadProgram).toHaveBeenCalledTimes(2);
    expect(c.loadProgram.mock.calls[1][1]).toBe(2);
    expect(c.mesh.getState().assignment).toMatchObject({ reason: 'replicate-queue', index: 2 });
    vi.useRealTimers();
    // At the coordinator, the queued stage is not admissible for new attempts; a held attempt stays on it.
    const k = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking }, replicaIndex: 2 });
    await k.mesh.contribute('model', true);
    expect(k.stageAt(2)).toBe('node-2');
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = k.stages[2].executeStage.getMockImplementation();
    k.stages[2].executeStage.mockImplementation(async args => {
      if (args.identity.attemptId === 'held' && args.step === 1) { entered.resolve(); await release.promise; }
      return original(args);
    });
    const held = k.generate('held'); await entered.promise;
    k.capacity.set('node-2', 0); k.queued.set('node-2', 3);
    expect((await k.generate('new')).content).toBe('012');
    expect(k.stageAt(2)).toBe('node-2b');
    expect(k.replica.executeStage.mock.calls.every(([call]) => call.identity.attemptId === 'new')).toBe(true);
    release.resolve(); expect((await held).content).toBe('012');
    expect(k.stages[2].executeStage.mock.calls.every(([call]) => call.identity.attemptId === 'held')).toBe(true);
  });

  it('requires automatic stage assignment and explicit demand bounds', async () => {
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    const base = { identity, meshId: 'mesh', models: [model], peers: () => [], createNetwork: () => ({ close() {} }), loadProgram() {},
      policy: { pollMs: 1, maxPeers: 1, connectTimeoutMs: 1, grantMs: 1, maxStageOffersPerPeer: 1, limits: f.limits } };
    const ordered = orchestration => ({ stage: null, maxRouteBytes: 1, maxRoutes: 1, maxSelectionSteps: 1, orchestration });
    expect(() => createAutomaticPartitions({ ...base, ordered: ordered({ replicas: { queueBound: 1, bottleneckRatio: 2 } }) })).toThrow('automatic stage assignment');
    expect(() => createAutomaticPartitions({ ...base, ordered: ordered({ autoStage: { transportId: 't', dwellMs: 0 },
      replicas: { queueBound: 1, bottleneckRatio: 1 } }) })).toThrow('explicit demand bounds');
  });
});
