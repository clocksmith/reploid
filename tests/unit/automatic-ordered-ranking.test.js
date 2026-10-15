import { afterEach, describe, expect, it, vi } from 'vitest';
import { coordinatorFixture } from '../fixtures/automatic-ordered-coordinator.js';

const discoveryOwners = vi.hoisted(() => []);
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery(options) {
    const owner = { options, capabilities: [], getSnapshot: () => structuredClone(owner.capabilities), getModels: () => [],
      refresh: vi.fn(async () => {}), invalidateModel: vi.fn(), close: vi.fn(async () => {}) };
    discoveryOwners.push(owner); return owner;
  }
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); discoveryOwners.length = 0; });
// Test values only. Injected stages take milliseconds, so priors are small and a failure's refund dominates.
const costs = { schema: 'reploid.route-cost-policy/v1', id: 'test-coordinator-costs/1', unit: 'test-unit', resolution: 0.001,
  prices: { latencyPerMs: 1, queueingPerMs: 1, transferPerMs: 1, preparationPerMs: 1, refundPerFailure: 10000, retryPerFailure: 0 },
  unknown: { prefillMsPerToken: 1, decodeMsPerToken: 1, transferMsPerToken: 0, openingMs: 0, maxObservationAgeMs: 3600000 },
  readiness: { priorAttempts: 2, priorRefusals: 0.1 }, failure: { priorAttempts: 2, priorFailures: 0.1 },
  reserve: { spareSlots: 0, perMissingSlot: 0 } };
const routeRanking = { margin: 0.2, smoothing: 1, maxObservations: 32, workload: { promptTokens: 2, expectedTokens: 3 }, costs };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const holdStage = (port, attemptId) => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = port.executeStage.getMockImplementation();
  port.executeStage.mockImplementation(async args => {
    if (args.identity.attemptId === attemptId && args.step === 1) { entered.resolve(); await release.promise; }
    return original(args);
  });
  return { entered: entered.promise, release: release.resolve };
};
const attemptsOn = port => port.executeStage.mock.calls.map(([call]) => call.identity.attemptId);

describe('expected-cost route preference in coordinator reconcile (opt-in)', () => {
  it('spills new attempts to an admissible replica, keeps active attempts, then prefers the measured cheaper route over peer-id order', async () => {
    const f = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking } });
    // node-1 sorts before node-1b, so first-valid matching would always pick it; it is also the slow one.
    const slow = f.stages[1].executeStage.getMockImplementation();
    f.stages[1].executeStage.mockImplementation(async args => { await delay(25); return slow(args); });
    await f.mesh.contribute('model', true);
    expect(f.stageOne()).toBe('node-1'); // equal priors: ties break by participant id
    // An attempt holds route A while node-1 reports itself full.
    const hold = holdStage(f.stages[2], 'held');
    const held = f.generate('held');
    await hold.entered;
    f.capacity.set('node-1', 0);
    expect((await f.generate('spilled')).content).toBe('012');
    expect(f.stageOne()).toBe('node-1b');
    expect(attemptsOn(f.replica).every(id => id === 'spilled')).toBe(true);
    hold.release();
    expect((await held).content).toBe('012'); // finished on the route it was admitted to
    expect(attemptsOn(f.stages[1])).toEqual(['held', 'held', 'held']);
    // node-1 is admissible again; both routes are measured and the replica route is cheaper.
    f.capacity.set('node-1', 2);
    const measured = await f.generate('measured');
    expect(measured.content).toBe('012');
    const state = f.mesh.getState();
    expect(state.placementDecision.reason).toBe('retain-ranked-route');
    expect(f.stageOne()).toBe('node-1b');
    expect(attemptsOn(f.replica).filter(id => id === 'measured')).toHaveLength(3);
    const decode = id => state.routeObservations.find(row => row.participantId === id && row.index === 1).decodeMs;
    expect(decode('node-1')).toBeGreaterThan(decode('node-1b'));
    // The decision that chose the route travels with the attempt's execution record.
    const selection = measured.execution.routeSelection;
    expect(selection).toMatchObject({ schema: 'reploid.route-selection/v1', reason: 'retain-ranked-route', policy: costs,
      chosen: { participants: [f.identity.peerId, 'node-1b', 'node-2'], measured: true, prepared: true } });
    expect(selection.chosen.inputs.stages.map(row => row.latency.source)).toEqual(['measured', 'measured', 'measured']);
    const slower = selection.alternatives.find(row => row.participants[1] === 'node-1');
    expect(slower.components.latency).toBeGreaterThan(selection.chosen.components.latency);
    // The idle route that is no longer preferred was retired; its stage owners were not closed.
    expect(f.networks[1].retire).toHaveBeenCalledWith('transport-1', expect.anything());
    expect(f.stages[1].close).not.toHaveBeenCalled();
  });

  it('failure history raises a route\'s expected cost: the active attempt keeps its route, the next new attempt moves', async () => {
    const f = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking } });
    await f.mesh.contribute('model', true);
    expect(f.stageOne()).toBe('node-1');
    const hold = holdStage(f.stages[2], 'held');
    const held = f.generate('held');
    await hold.entered;
    const original = f.stages[1].executeStage.getMockImplementation();
    f.stages[1].executeStage.mockImplementation(async args => {
      if (args.identity.attemptId === 'bad') throw Error('stage failed');
      return original(args);
    });
    await expect(f.generate('bad')).rejects.toThrow();
    hold.release();
    expect((await held).content).toBe('012');
    expect(attemptsOn(f.stages[1]).filter(id => id === 'held')).toHaveLength(3); // never rerouted
    expect(f.mesh.getState().routeOutcomes).toEqual([expect.objectContaining({
      participants: [f.identity.peerId, 'node-1', 'node-2'], executions: 2, failures: 1 })]);
    // Idle now: the unmeasured replica route's prior failure cost is lower than node-1's observed failures.
    expect((await f.generate('after')).content).toBe('012');
    expect(f.stageOne()).toBe('node-1b');
    expect(attemptsOn(f.replica)).toEqual(['after', 'after', 'after']);
    const { selection } = f.mesh.getState().placementDecision;
    const failed = selection.alternatives.find(row => row.participants[1] === 'node-1');
    expect(selection.chosen.participants[1]).toBe('node-1b');
    expect(failed.expected.failureProbability).toBeCloseTo(1.1 / 4);
    expect(failed.components.failure).toBeGreaterThan(selection.chosen.components.failure);
  });

  it('counts a refused reservation against the refusing stage only, and a failure is never a latency sample', async () => {
    const f = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking } });
    await f.mesh.contribute('model', true);
    f.stages[1].reserve.mockRejectedValueOnce(Object.assign(Error('full'), { code: 'CAPACITY_UNAVAILABLE' }));
    await expect(f.generate('refused')).rejects.toThrow();
    const state = f.mesh.getState(), row = (id, index) => state.routeObservations.find(item => item.participantId === id && item.index === index);
    expect(row(f.identity.peerId, 0)).toMatchObject({ admissions: 1, refusals: 0, samples: 0 });
    expect(row('node-1', 1)).toMatchObject({ admissions: 1, refusals: 1, samples: 0 });
    expect(row('node-2', 2)).toMatchObject({ admissions: 0, refusals: 0, samples: 0 }); // only its channel opening is measured
    expect(row('node-2', 2).openingMs).toBeGreaterThanOrEqual(0);
    expect(state.routeOutcomes).toEqual([]);
  });

  it('rejects a ranking policy without an explicit margin, workload and cost policy', async () => {
    await expect(coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking: { ...routeRanking, margin: 1 } } }))
      .rejects.toThrow('explicit margin and workload');
    const { costs: _costs, ...unpriced } = routeRanking;
    await expect(coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking: unpriced } }))
      .rejects.toThrow('Explicit route cost policy required');
    await expect(coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking: { ...routeRanking,
      costs: { ...costs, unknown: { ...costs.unknown, maxObservationAgeMs: undefined } } } } })).rejects.toThrow('Explicit route cost policy required');
  });
});
