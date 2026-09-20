// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { projectPlacementBeliefs, resolvePlacementBeliefPolicy } from '../../packages/reploid/src/mesh/placement-beliefs.js';
import { placementBeliefPolicy } from '../fixtures/placement-beliefs.js';

const observation = (evidenceId, outcomeId = 'fast', changes = {}) => ({ evidenceId, dependencyId: evidenceId,
  providerId: 'peer', contextId: 'context', observedAt: 100, outcomeId, ...changes });
const project = (observations = [], changes = {}) => projectPlacementBeliefs({ policy: placementBeliefPolicy,
  candidates: [{ providerId: 'peer', contextId: 'context' }], observations, now: 1000, ...changes });

describe('Bayesian placement beliefs', () => {
  it('updates Dirichlet completion and costs, retaining posterior uncertainty', () => {
    const prior = project().candidates[0];
    const updated = project([observation('a'), observation('b')]).candidates[0];
    expect(prior.completionProbability).toBeCloseTo(2 / 3);
    expect(updated.posterior.map(row => row.alpha)).toEqual([3, 1, 1]);
    expect(updated.completionProbability).toBeCloseTo(4 / 5);
    expect(updated.expectedLatencyMs).toBeCloseTo(660);
    expect(updated.expectedTotalCost).toBeCloseTo(10.6);
    expect(updated.expectedUtility).toBeCloseTo(62.8);
    expect(updated.posterior[0].probabilityVariance).toBeCloseTo(0.6 * 0.4 / 6);
    expect(updated.utilityVariance).toBeGreaterThan(0);
    expect(Object.isFrozen(updated.posterior[0])).toBe(true);
  });

  it('counts replicated observations once and rejects conflicting identities or dependencies', () => {
    const first = observation('a');
    const copies = [first, { ...first }, observation('b', 'fast', { dependencyId: 'a' })];
    const projected = project(copies);
    expect(projected.candidates[0].posterior.map(row => row.alpha)).toEqual([2, 1, 1]);
    expect(projected.candidates[0].evidenceIds).toEqual(['a']);
    expect(projected.ignored).toEqual([{ evidenceId: 'b', reason: 'shared-evidence' }]);
    expect(project([...copies].reverse())).toEqual(projected);
    expect(() => project([first, { ...first, outcomeId: 'failed' }])).toThrow('conflicting evidence identity');
    expect(() => project([first, observation('b', 'failed', { dependencyId: 'a' })])).toThrow('joint model');
    expect(() => project([first, observation('b', 'fast', { dependencyId: 'a', providerId: 'other' })])).toThrow('joint model');
  });

  it('does not treat stale, unrelated or censored observations as successes or failures', () => {
    const result = project([observation('a', null), observation('b', 'fast', { contextId: 'other' }),
      observation('c', 'failed', { observedAt: 0 }), observation('d', 'fast', { providerId: 'absent' })],
    { now: 60001 });
    expect(result.candidates[0].posterior.map(row => row.alpha)).toEqual([1, 1, 1]);
    expect(result.ignored.map(row => row.reason)).toEqual(['censored', 'different-context', 'stale', 'different-context']);
    expect(() => project([observation('future', 'fast', { observedAt: 1001 })])).toThrow('observation time');
  });

  it('rejects unknown fields, outcomes, unbounded inputs and invalid priors', () => {
    expect(() => project([observation('a', 'invented')])).toThrow('unknown outcome');
    expect(() => project([observation('a', 'fast', { confidence: 1 })])).toThrow('expected fields');
    expect(() => project(Array.from({ length: 101 }, (_, i) => observation(`e${i}`)))).toThrow('bounded observations');
    for (const prior of [0, -1, Infinity]) {
      const policy = structuredClone(placementBeliefPolicy); policy.outcomes[0].prior = prior;
      expect(() => resolvePlacementBeliefPolicy(policy)).toThrow();
    }
  });
});
