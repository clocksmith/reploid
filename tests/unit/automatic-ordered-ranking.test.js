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
const routeRanking = { margin: 0.2, smoothing: 1, maxObservations: 32, workload: { promptTokens: 2, expectedTokens: 3 } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('measured route preference in coordinator reconcile (opt-in)', () => {
  it('spills new attempts to an admissible replica, keeps active attempts, then prefers the measured cheaper route over peer-id order', async () => {
    const f = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking } });
    // node-1 sorts before node-1b, so first-valid matching would always pick it; it is also the slow one.
    const slow = f.stages[1].executeStage.getMockImplementation();
    f.stages[1].executeStage.mockImplementation(async args => { await delay(25); return slow(args); });
    await f.mesh.contribute('model', true);
    expect(f.stageOne()).toBe('node-1'); // nothing measured: ties break by participant id
    // An attempt holds route A while node-1 reports itself full.
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = f.stages[2].executeStage.getMockImplementation();
    f.stages[2].executeStage.mockImplementation(async args => {
      if (args.identity.attemptId === 'held' && args.step === 1) { entered.resolve(); await release.promise; }
      return original(args);
    });
    const held = f.generate('held');
    await entered.promise;
    f.capacity.set('node-1', 0);
    expect((await f.generate('spilled')).content).toBe('012');
    expect(f.stageOne()).toBe('node-1b');
    expect(f.replica.executeStage.mock.calls.every(([call]) => call.identity.attemptId === 'spilled')).toBe(true);
    release.resolve();
    expect((await held).content).toBe('012'); // finished on the route it was admitted to
    expect(f.stages[1].executeStage.mock.calls.map(([call]) => call.identity.attemptId)).toEqual(['held', 'held', 'held']);
    // node-1 is admissible again; both routes are measured and the replica route is cheaper.
    f.capacity.set('node-1', 2);
    expect((await f.generate('measured')).content).toBe('012');
    const state = f.mesh.getState();
    expect(state.placementDecision.reason).toBe('retain-ranked-route');
    expect(f.stageOne()).toBe('node-1b');
    expect(f.replica.executeStage.mock.calls.filter(([call]) => call.identity.attemptId === 'measured')).toHaveLength(3);
    const decode = id => state.routeObservations.find(row => row.participantId === id && row.index === 1).decodeMs;
    expect(decode('node-1')).toBeGreaterThan(decode('node-1b'));
    // The idle route that is no longer preferred was retired; its stage owners were not closed.
    expect(f.networks[1].retire).toHaveBeenCalledWith('transport-1', expect.anything());
    expect(f.stages[1].close).not.toHaveBeenCalled();
  });

  it('records only completed attempts as observations', async () => {
    const f = await coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking } });
    await f.mesh.contribute('model', true);
    f.stages[2].executeStage.mockRejectedValueOnce(Error('stage failed'));
    await expect(f.generate('failed')).rejects.toThrow();
    expect(f.mesh.getState().routeObservations).toEqual([]);
    await f.generate('completed');
    expect(f.mesh.getState().routeObservations.map(row => row.index).sort()).toEqual([0, 1, 2]);
  });

  it('rejects a ranking policy without an explicit margin and workload', async () => {
    await expect(coordinatorFixture({ discoveryOwners, cleanups, orchestration: { routeRanking: { margin: 1, smoothing: 1, maxObservations: 1,
      workload: { promptTokens: 1, expectedTokens: 1 } } } })).rejects.toThrow('explicit margin and workload');
  });
});
