import { describe, it, expect } from 'vitest';
import { createRouteObservations, rankPartitionRoutes, preferRoute, routeSelectionRecord, validateRouteCostPolicy,
  ROUTE_RANKING_WORK_LIMIT } from '../../packages/reploid/src/mesh/partitions/partition-route-ranking.js';

const plan = 'sha256:' + 'p'.repeat(64);
const workload = { promptTokens: 24, expectedTokens: 100, allocationBytes: 1000 };
const limits = { maxParticipants: 8, maxRoutes: 8, maxSelectionSteps: 10000 };
// Test values only: no adopted prices exist. Every member is required.
const policy = { schema: 'reploid.route-cost-policy/v1', id: 'test-route-costs/1', unit: 'test-unit', resolution: 0.001,
  prices: { latencyPerMs: 1, queueingPerMs: 1, transferPerMs: 1, preparationPerMs: 1, refundPerFailure: 1000, retryPerFailure: 500 },
  unknown: { prefillMsPerToken: 2000, decodeMsPerToken: 5000, transferMsPerToken: 500, openingMs: 1000, maxObservationAgeMs: 3600000 },
  readiness: { priorAttempts: 2, priorRefusals: 0.1 }, failure: { priorAttempts: 2, priorFailures: 0.1 },
  reserve: { spareSlots: 1, perMissingSlot: 100 } };
const at = 1_000_000;
const rank = (options, overrides = {}) => rankPartitionRoutes({ planId: plan, workload, limits, policy, now: at, ...options, ...overrides });
const candidate = (participantId, index, extra = {}) => ({ participantId, index, capacity: { active: 0, availableSlots: 2, closed: false }, ...extra });
// Ordered summary phases (partition-summary.js) for one completed attempt on `route`.
const phases = (route, { decodeMs, executionMs, prefillMs, tokens = 24, steps = 7 }) => ({
  prompt: { inputTokens: tokens, stages: route.map((_, index) => ({ partitionIndex: index, elapsedMs: prefillMs[index], runtime: {} })) },
  decode: { steps, stages: route.map((_, index) => ({ partitionIndex: index,
    elapsedMs: { count: steps, total: decodeMs[index] * steps },
    runtime: executionMs ? { executionMs: { count: steps, total: executionMs[index] * steps } } : {} })) }
});
const stagesOf = ids => ({ stages: ids.map((participantId, index) => ({ index, participantId })) });
const ids = route => route.stages.map(stage => stage.participantId);

describe('expected-cost route ranking', () => {
  // Placement A as measured on 2026-10-14 (artifacts/phase-timing-20261014): mac, amd, intel-with-head.
  const measuredA = { decodeMs: [559, 394, 2344], executionMs: [543, 158, 2138], prefillMs: [14497, 3311, 23293] };
  const observe = () => {
    const observations = createRouteObservations({ maxEntries: 64, smoothing: 0.5 });
    observations.record({ planId: plan, route: stagesOf(['mac', 'amd', 'intel']), phases: phases(['mac', 'amd', 'intel'], measuredA), at });
    return observations;
  };
  const three = [[candidate('mac', 0, { local: true })], [candidate('amd', 1), candidate('intel', 1)], [candidate('amd', 2), candidate('intel', 2)]];

  it('folds per-stage decode, transfer and prefill cost from ordered summaries', () => {
    const row = observe().get(plan, 'intel', 2);
    expect(row).toMatchObject({ samples: 1, decodeMs: 2344, transferMs: 206, admissions: 0, refusals: 0 });
    expect(row.prefillMsPerToken).toBeCloseTo(23293 / 24);
  });

  it('prefers the cheaper complete route by expected cost, not by peer id', () => {
    const observations = observe();
    // Placement B measured separately: intel without the head, amd with it.
    observations.record({ planId: plan, route: stagesOf(['mac', 'intel', 'amd']),
      phases: phases(['mac', 'intel', 'amd'], { decodeMs: [559, 1229, 560], executionMs: [543, 1023, 324], prefillMs: [14497, 21832, 6000] }), at });
    const ranked = rank({ observations, candidates: three });
    // 'amd' sorts before 'intel', so peer-id order would pick placement A.
    expect(ranked.map(ids)).toEqual([['mac', 'intel', 'amd'], ['mac', 'amd', 'intel']]);
    expect(ranked.every(route => route.measured)).toBe(true);
    expect(ranked[0].cost).toBeLessThan(ranked[1].cost);
    expect(ranked[0].components.latency).toBeLessThan(ranked[1].components.latency);
  });

  it('computes every component from measured inputs or declared priors', () => {
    const ranked = rank({ observations: createRouteObservations({ maxEntries: 8, smoothing: 1 }),
      candidates: [[candidate('mac', 0, { local: true })], [candidate('amd', 1)], [candidate('intel', 2)]] });
    const [route] = ranked, stage = 2000 * 24 + 5000 * 100, transfer = 500 * 100;
    const admit = 0.95 ** 3, failure = 0.05, attempts = 1 / (admit * (1 - failure)), service = 3 * stage + 3 * transfer, penalty = 1500;
    expect(route.expected).toMatchObject({ latencyMs: 3 * stage, transferMs: 3 * transfer, queueingMs: 0, preparationMs: 2000, reserveSlots: 0 });
    expect(route.components.preparation).toBe(2000); // the local stage opens no channel; two remote stages use the opening prior
    expect(route.components.readiness).toBeCloseTo(attempts * (1 - admit) * penalty, 6);
    expect(route.components.failure).toBeCloseTo(attempts * admit * failure * (service + penalty), 6);
    expect(route.cost).toBeCloseTo(service + 2000 + route.components.readiness + route.components.failure, 6);
    expect(route.inputs.stages.map(row => [row.latency.source, row.opening.source])).toEqual([['prior', 'local'], ['prior', 'prior'], ['prior', 'prior']]);
  });

  describe('each component orders otherwise identical routes', () => {
    // Stage 1 has two equally measured candidates; 'a' sorts first, so 'b' wins only by cost.
    const timings = { decodeMs: [10, 20, 30], executionMs: [10, 15, 25], prefillMs: [240, 480, 720] };
    const base = () => {
      const observations = createRouteObservations({ maxEntries: 64, smoothing: 1 });
      for (const id of ['a', 'b']) observations.record({ planId: plan, route: stagesOf(['mac', id, 'z']), phases: phases(['mac', id, 'z'], timings), at });
      return observations;
    };
    const stages = (a = {}, b = {}) => [[candidate('mac', 0, { local: true })], [candidate('a', 1, a), candidate('b', 1, b)], [candidate('z', 2)]];
    const cases = {
      latency: { observe(o) { o.record({ planId: plan, route: stagesOf(['mac', 'a', 'z']), phases: phases(['mac', 'a', 'z'], { ...timings, decodeMs: [10, 40, 30], executionMs: [10, 35, 25] }), at }); } },
      queueing: { a: { capacity: { active: 1, availableSlots: 2, closed: false } } },
      transfer: { policy: { prices: { ...policy.prices, transferPerMs: 2 } },
        observe(o) { o.record({ planId: plan, route: stagesOf(['mac', 'a', 'z']), phases: phases(['mac', 'a', 'z'], { ...timings, executionMs: [10, 5, 25] }), at }); } },
      preparation: { open: [[{ participantId: 'mac' }, { participantId: 'b' }, { participantId: 'z' }]] },
      readiness: { observe(o) { o.recordOutcome({ planId: plan, route: stagesOf(['mac', 'a', 'z']), admitted: 1, refused: true, execution: null, at }); } },
      failure: { observe(o) { o.recordOutcome({ planId: plan, route: stagesOf(['mac', 'a', 'z']), admitted: 3, refused: false, execution: 'failed', at }); } },
      reserve: { a: { capacity: { active: 0, availableSlots: 1, closed: false } } }
    };
    for (const [component, change] of Object.entries(cases)) {
      it(component, () => {
        const observations = base();
        change.observe?.(observations);
        const ranked = rank({ observations, candidates: stages(change.a, change.b), open: change.open ?? [],
          policy: { ...policy, ...change.policy } });
        expect(ranked.map(route => route.participants[1])).toEqual(['b', 'a']);
        expect(ranked[1].components[component]).toBeGreaterThan(ranked[0].components[component]);
      });
    }
    it('ties without a cost difference break by peer id only', () => {
      expect(rank({ observations: base(), candidates: stages() }).map(route => route.participants[1])).toEqual(['a', 'b']);
    });
  });

  it('labels unknown measurements: unmeasured and stale latency use priors; an unsplit decode keeps transfer inside it', () => {
    const observations = observe();
    const ranked = rank({ observations, candidates: three });
    expect(ids(ranked[0])).toEqual(['mac', 'amd', 'intel']);
    expect(ranked[0].inputs.stages[2].latency).toMatchObject({ source: 'measured', decodeMsPerToken: 2344 - 206, transferMsPerToken: 206 });
    expect(ranked[1].inputs.stages[1].latency).toMatchObject({ source: 'prior', decodeMsPerToken: 5000, transferMsPerToken: 500, transfer: 'prior' });
    const later = rank({ observations, candidates: three }, { now: at + policy.unknown.maxObservationAgeMs + 1 });
    expect(later.every(route => route.inputs.stages.every(row => ['stale', 'prior'].includes(row.latency.source)))).toBe(true);
    expect(later[0].inputs.stages[0].latency).toMatchObject({ source: 'stale', decodeMsPerToken: 5000 });
    const unsplit = createRouteObservations({ maxEntries: 8, smoothing: 1 });
    unsplit.record({ planId: plan, route: stagesOf(['mac', 'amd', 'intel']), phases: phases(['mac', 'amd', 'intel'], { ...measuredA, executionMs: null }), at });
    const [route] = rank({ observations: unsplit, candidates: [[candidate('mac', 0)], [candidate('amd', 1)], [candidate('intel', 2)]] });
    expect(route.inputs.stages[2].latency).toMatchObject({ source: 'measured', transfer: 'within-decode', decodeMsPerToken: 2344, transferMsPerToken: null });
    expect(route.expected.transferMs).toBe(0);
  });

  it('attributes refusal to the refusing stage, failure to the route, and nothing to cancellation', () => {
    const observations = createRouteObservations({ maxEntries: 8, smoothing: 1 }), route = stagesOf(['mac', 'amd', 'intel']);
    observations.recordOutcome({ planId: plan, route, admitted: 1, refused: true, execution: null, at });
    observations.recordOutcome({ planId: plan, route, admitted: 2, refused: false, execution: null, at }); // cancelled at stage 2
    observations.recordOutcome({ planId: plan, route, admitted: 3, refused: false, execution: 'failed', at });
    observations.recordOutcome({ planId: plan, route, admitted: 3, refused: false, execution: 'completed', at });
    expect(['mac', 'amd', 'intel'].map((id, index) => observations.get(plan, id, index)).map(row => [row.admissions, row.refusals]))
      .toEqual([[4, 0], [4, 1], [2, 0]]);
    expect(observations.getRoute(plan, ['mac', 'amd', 'intel'])).toMatchObject({ executions: 2, failures: 1 });
    expect(() => observations.recordOutcome({ planId: plan, route, admitted: 2, refused: false, execution: 'failed', at })).toThrow('Route outcome binding required');
    const [ranked] = rank({ observations, candidates: [[candidate('mac', 0)], [candidate('amd', 1)], [candidate('intel', 2)]] });
    expect(ranked.expected.failureProbability).toBeCloseTo((1 + 0.1) / (2 + 2));
    expect(ranked.expected.refusalProbability).toBeCloseTo(1 - (1 - 0.1 / 6) * (1 - 1.1 / 6) * (1 - 0.1 / 4));
  });

  describe('a slow device', () => {
    const observations = () => {
      const o = createRouteObservations({ maxEntries: 16, smoothing: 1 });
      o.record({ planId: plan, route: stagesOf(['mac', 'fast', 'z']), phases: phases(['mac', 'fast', 'z'], measuredA), at });
      o.record({ planId: plan, route: stagesOf(['mac', 'slow', 'z']), phases: phases(['mac', 'slow', 'z'], { ...measuredA, decodeMs: [559, 3940, 2344], executionMs: [543, 3700, 2138] }), at });
      return o;
    };
    it('is avoided only through another complete route and stays eligible', () => {
      const ranked = rank({ observations: observations(), candidates: [[candidate('mac', 0)], [candidate('slow', 1), candidate('fast', 1)], [candidate('z', 2)]] });
      expect(ranked.map(route => route.participants[1])).toEqual(['fast', 'slow']);
    });
    it('is chosen when its memory provides otherwise unavailable capacity', () => {
      const short = { memory: { availableBytes: workload.allocationBytes - 1 } }, room = { memory: { availableBytes: workload.allocationBytes } };
      const ranked = rank({ observations: observations(), candidates: [[candidate('mac', 0)], [candidate('slow', 1, room), candidate('fast', 1, short)], [candidate('z', 2)]] });
      expect(ranked.map(route => route.participants[1])).toEqual(['slow']);
      const full = rank({ observations: observations(), candidates: [[candidate('mac', 0)],
        [candidate('slow', 1), candidate('fast', 1, { capacity: { active: 2, availableSlots: 0, closed: false } })], [candidate('z', 2)]] });
      expect(full.map(route => route.participants[1])).toEqual(['slow']);
    });
    it('is never dropped to leave layers uncovered: no admissible stage means no route', () => {
      expect(rank({ observations: observations(), candidates: [[candidate('mac', 0)],
        [candidate('fast', 1, { memory: { availableBytes: 0 } })], [candidate('z', 2)]] })).toEqual([]);
    });
  });

  it('never assigns one participant to two stages', () => {
    expect(rank({ observations: observe(), candidates: [[candidate('mac', 0)], [candidate('amd', 1)], [candidate('amd', 2)]] })).toEqual([]);
  });

  it('keeps the current route while it has active attempts and switches only past the margin', () => {
    const route = (participants, cost) => ({ ...stagesOf(participants), cost });
    const current = stagesOf(['mac', 'amd', 'intel']);
    const ranked = [route(['mac', 'intel', 'amd'], 900), route(['mac', 'amd', 'intel'], 1000)];
    expect(preferRoute({ current, ranked, active: true, margin: 0.05 })).toBe(current);
    expect(preferRoute({ current, ranked, active: false, margin: 0.05 })).toBe(ranked[0]);
    expect(preferRoute({ current, ranked, active: false, margin: 0.2 })).toBe(current);
  });

  it('sends new attempts to the best admissible route when the current one is no longer admissible, even while it is active', () => {
    const current = stagesOf(['mac', 'amd', 'intel']), spill = { ...stagesOf(['mac', 'intel', 'amd']), cost: 5 };
    expect(preferRoute({ current, ranked: [spill], active: true, margin: 0.05 })).toBe(spill);
  });

  it('records the policy, the chosen route inputs and breakdown, and bounded alternatives', () => {
    const ranked = rank({ observations: observe(), candidates: three });
    const record = routeSelectionRecord({ policy, workload, ranked, chosen: ranked[0], reason: 'ranked-route', decidedAt: at, maxRoutes: 1 });
    expect(record).toMatchObject({ schema: 'reploid.route-selection/v1', policy, reason: 'ranked-route', decidedAt: at, considered: 2,
      workload: { promptTokens: 24, expectedTokens: 100 }, chosen: { participants: ['mac', 'amd', 'intel'], measured: true } });
    expect(Object.keys(record.chosen.components)).toEqual(['latency', 'queueing', 'transfer', 'preparation', 'readiness', 'failure', 'reserve']);
    expect(record.chosen.inputs.stages).toHaveLength(3);
    expect(record.alternatives).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it('fails fast without a complete versioned cost policy', () => {
    expect(() => validateRouteCostPolicy(undefined)).toThrow('Explicit route cost policy required');
    expect(() => rank({ observations: observe(), candidates: three }, { policy: undefined })).toThrow('Explicit route cost policy required');
    const { reserve: _reserve, ...partial } = policy;
    for (const invalid of [partial, { ...policy, extra: 1 }, { ...policy, schema: 'reploid.route-cost-policy/v0' },
      { ...policy, prices: { ...policy.prices, refundPerFailure: undefined } }, { ...policy, unknown: { ...policy.unknown, decodeMsPerToken: 0 } },
      { ...policy, failure: { priorAttempts: 1, priorFailures: 1 } }, { ...policy, resolution: 0 }]) {
      expect(() => validateRouteCostPolicy(invalid)).toThrow('Explicit route cost policy required');
    }
    expect(Object.isFrozen(validateRouteCostPolicy(policy).prices)).toBe(true);
  });

  it('bounds observations and enumeration work explicitly', () => {
    const observations = createRouteObservations({ maxEntries: 2, smoothing: 1 });
    observations.record({ planId: plan, route: stagesOf(['mac', 'amd', 'intel']), phases: phases(['mac', 'amd', 'intel'], measuredA), at });
    expect(observations.snapshot()).toHaveLength(2);
    expect(() => rank({ observations, candidates: three }, { limits: { ...limits, maxSelectionSteps: 2 } })).toThrow(ROUTE_RANKING_WORK_LIMIT);
  });
});
