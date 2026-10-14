import { describe, it, expect } from 'vitest';
import { createRouteObservations, rankPartitionRoutes, preferRoute } from '../../packages/reploid/src/mesh/partitions/partition-route-ranking.js';

const plan = 'sha256:' + 'p'.repeat(64);
const workload = { promptTokens: 24, expectedTokens: 100, allocationBytes: 1000 };
const limits = { maxParticipants: 8, maxRoutes: 8, maxSelectionSteps: 10000 };
const candidate = (participantId, index, extra = {}) => ({ participantId, index, capacity: { active: 0, availableSlots: 2, closed: false }, ...extra });
// Ordered summary phases (partition-summary.js) for one completed attempt on `route`.
const phases = (route, { decodeMs, executionMs, prefillMs, tokens = 24, steps = 7 }) => ({
  prompt: { inputTokens: tokens, stages: route.map((_, index) => ({ partitionIndex: index, elapsedMs: prefillMs[index], runtime: {} })) },
  decode: { steps, stages: route.map((_, index) => ({ partitionIndex: index,
    elapsedMs: { count: steps, total: decodeMs[index] * steps }, runtime: { executionMs: { count: steps, total: executionMs[index] * steps } } })) }
});
const stagesOf = ids => ({ stages: ids.map((participantId, index) => ({ index, participantId })) });

describe('measured route ranking', () => {
  // Placement A as measured on 2026-10-14 (artifacts/phase-timing-20261014): mac, amd, intel-with-head.
  const measuredA = { decodeMs: [559, 394, 2344], executionMs: [543, 158, 2138], prefillMs: [14497, 3311, 23293] };
  const observe = () => {
    const observations = createRouteObservations({ maxEntries: 64, smoothing: 0.5 });
    observations.record({ planId: plan, route: stagesOf(['mac', 'amd', 'intel']), phases: phases(['mac', 'amd', 'intel'], measuredA), at: 1 });
    return observations;
  };

  it('folds per-stage decode, transfer and prefill cost from ordered summaries', () => {
    const row = observe().get(plan, 'intel', 2);
    expect(row).toMatchObject({ samples: 1, decodeMs: 2344, transferMs: 206 });
    expect(row.prefillMsPerToken).toBeCloseTo(23293 / 24);
  });

  it('prefers the cheaper complete route by expected completion time, not by peer id', () => {
    const observations = observe();
    // Placement B measured separately: intel without the head, amd with it.
    observations.record({ planId: plan, route: stagesOf(['mac', 'intel', 'amd']),
      phases: phases(['mac', 'intel', 'amd'], { decodeMs: [559, 1229, 560], executionMs: [543, 1023, 324], prefillMs: [14497, 21832, 6000] }), at: 2 });
    const ranked = rankPartitionRoutes({ planId: plan, workload, limits, observations,
      candidates: [[candidate('mac', 0)], [candidate('amd', 1), candidate('intel', 1)], [candidate('amd', 2), candidate('intel', 2)]] });
    expect(ranked.map(route => route.stages.map(stage => stage.participantId))).toEqual([['mac', 'intel', 'amd'], ['mac', 'amd', 'intel']]);
    expect(ranked.every(route => route.measured)).toBe(true);
    expect(ranked[0].cost).toBeLessThan(ranked[1].cost);
  });

  it('ranks unmeasured placements after measured ones and breaks ties by peer id only', () => {
    const ranked = rankPartitionRoutes({ planId: plan, workload, limits, observations: observe(),
      candidates: [[candidate('mac', 0)], [candidate('amd', 1), candidate('intel', 1)], [candidate('amd', 2), candidate('intel', 2)]] });
    expect(ranked[0]).toMatchObject({ measured: true });
    expect(ranked[0].stages.map(stage => stage.participantId)).toEqual(['mac', 'amd', 'intel']);
    expect(ranked[1]).toMatchObject({ measured: false, cost: null });
  });

  it('charges queueing on busy stages and excludes full or memory-short candidates', () => {
    const observations = observe();
    const busy = rankPartitionRoutes({ planId: plan, workload, limits, observations,
      candidates: [[candidate('mac', 0)], [candidate('amd', 1, { capacity: { active: 1, availableSlots: 1, closed: false } })], [candidate('intel', 2)]] });
    const idle = rankPartitionRoutes({ planId: plan, workload, limits, observations,
      candidates: [[candidate('mac', 0)], [candidate('amd', 1)], [candidate('intel', 2)]] });
    expect(busy[0].stageCosts[1]).toBeCloseTo(2 * idle[0].stageCosts[1]);
    expect(rankPartitionRoutes({ planId: plan, workload, limits, observations,
      candidates: [[candidate('mac', 0)], [candidate('amd', 1, { capacity: { active: 2, availableSlots: 0, closed: false } })], [candidate('intel', 2)]] })).toEqual([]);
    expect(rankPartitionRoutes({ planId: plan, workload, limits, observations,
      candidates: [[candidate('mac', 0)], [candidate('amd', 1, { memory: { availableBytes: 999 } })], [candidate('intel', 2)]] })).toEqual([]);
  });

  it('never assigns one participant to two stages', () => {
    const ranked = rankPartitionRoutes({ planId: plan, workload, limits, observations: observe(),
      candidates: [[candidate('mac', 0)], [candidate('amd', 1)], [candidate('amd', 2)]] });
    expect(ranked).toEqual([]);
  });

  it('keeps the current route while it has active attempts and switches only past the margin', () => {
    const route = (ids, cost) => ({ ...stagesOf(ids), measured: cost !== null, cost });
    const current = stagesOf(['mac', 'amd', 'intel']);
    const ranked = [route(['mac', 'intel', 'amd'], 900), route(['mac', 'amd', 'intel'], 1000)];
    expect(preferRoute({ current, ranked, active: true, margin: 0.05 })).toBe(current);
    expect(preferRoute({ current, ranked, active: false, margin: 0.05 })).toBe(ranked[0]);
    expect(preferRoute({ current, ranked, active: false, margin: 0.2 })).toBe(current);
  });

  it('breaks ties stage by stage in code-unit order, independent of locale and id prefixes', () => {
    const ranked = rankPartitionRoutes({ planId: plan, workload, limits, observations: createRouteObservations({ maxEntries: 4, smoothing: 1 }),
      candidates: [[candidate('mac', 0)], [candidate('node-1b', 1), candidate('node-1', 1)], [candidate('node-2', 2)]] });
    expect(ranked.map(route => route.stages[1].participantId)).toEqual(['node-1', 'node-1b']);
  });

  it('sends new attempts to the best admissible route when the current one is full, even while it is active', () => {
    const route = (ids, cost) => ({ ...stagesOf(ids), measured: cost !== null, cost });
    const current = stagesOf(['mac', 'amd', 'intel']), spill = route(['mac', 'intel', 'amd'], null);
    expect(preferRoute({ current, ranked: [spill], active: true, margin: 0.05 })).toBe(spill);
    expect(preferRoute({ current, ranked: [spill, route(['mac', 'amd', 'intel'], null)], active: false, margin: 0.05 })).toBe(current);
  });

  it('bounds observations and enumeration work explicitly', () => {
    const observations = createRouteObservations({ maxEntries: 2, smoothing: 1 });
    observations.record({ planId: plan, route: stagesOf(['mac', 'amd', 'intel']), phases: phases(['mac', 'amd', 'intel'], measuredA), at: 1 });
    expect(observations.snapshot()).toHaveLength(2);
    expect(() => rankPartitionRoutes({ planId: plan, workload, observations, limits: { ...limits, maxSelectionSteps: 2 },
      candidates: [[candidate('mac', 0)], [candidate('amd', 1), candidate('intel', 1)], [candidate('amd', 2), candidate('intel', 2)]] }))
      .toThrow('Route ranking work limit exceeded');
  });
});
