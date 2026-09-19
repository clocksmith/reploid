import { describe, it, expect } from 'vitest';
import { createBeliefPlanner } from '../../packages/reploid/src/agent/diagnostic-strategy.js';
import { diagnosticModel as model, diagnosticPolicy as policy } from '../fixtures/diagnostic-model.js';

describe('finite diagnostic belief planner', () => {
  it('separates useful evidence from irrelevant information and respects cost bounds', () => {
    const planner = createBeliefPlanner(model, policy);
    const ranking = planner.rank({ belief: planner.initialBelief(), remainingBudget: policy.costBudget });
    expect(ranking[0].actionId).toBe('reference');
    expect(ranking.some(a => a.actionId === 'full-suite')).toBe(false);
    const irrelevant = ranking.find(a => a.actionId === 'irrelevant-label');
    expect(irrelevant.informationGain).toBeCloseTo(Math.log(4));
    expect(irrelevant.decisionValue).toBeCloseTo(0);
    expect(irrelevant.score).toBeLessThan(0);
    const info = createBeliefPlanner(model, { ...policy, objective: 'utility-information', informationWeight: 1 });
    expect(info.rank({ belief: info.initialBelief(), remainingBudget: policy.costBudget })[0].actionId).toBe('irrelevant-label');
  });

  it('performs a hand-calculated noisy Bayesian update independently of preferences', () => {
    const noisy = { ...structuredClone(model), hypotheses: ['a', 'b'], prior: [0.6, 0.4],
      actions: [{ ...model.actions[0], outcomes: ['yes', 'no'], likelihoods: [[0.8, 0.2], [0.1, 0.9]] }],
      decisions: [{ id: 'a', utilities: [1, 0] }, { id: 'b', utilities: [0, 1] }] };
    const planner = createBeliefPlanner(noisy, policy);
    const branch = planner.update({ belief: noisy.prior, actionId: 'reference', outcomeId: 'yes' });
    expect(branch.probability).toBeCloseTo(0.52);
    expect(branch.posterior[0]).toBeCloseTo(12 / 13);
    noisy.decisions[0].utilities = [-100, 100];
    expect(createBeliefPlanner(noisy, policy).update({ belief: noisy.prior, actionId: 'reference', outcomeId: 'yes' })).toEqual(branch);
  });

  it('preserves priors on impossible observations and rejects undeclared outcomes', () => {
    const planner = createBeliefPlanner(model, policy);
    const belief = model.prior.map((_, i) => Number(i === 0));
    expect(() => planner.update({ belief, actionId: 'reference', outcomeId: 'match' })).toThrow('zero predictive probability');
    expect(() => planner.update({ belief, actionId: 'reference', outcomeId: 'unexpected' })).toThrow('unknown observation');
    expect(belief[0]).toBe(1);
  });

  it('does not silently treat correlated actions as independent', () => {
    const correlated = structuredClone(model);
    correlated.actions[1].evidenceGroup = 'reference';
    const planner = createBeliefPlanner(correlated, policy);
    expect(planner.rank({ belief: model.prior, remainingBudget: policy.costBudget, excludedActionIds: ['reference'] })
      .map(a => a.actionId)).not.toContain('shader-check');
  });

  it('freezes detached inputs and returns detached posterior and ranking data', () => {
    const input = structuredClone(model);
    const planner = createBeliefPlanner(input, policy);
    input.prior[0] = 1;
    expect(planner.initialBelief()[0]).toBe(1 / 16);
    expect(Object.isFrozen(planner.model.actions[0].likelihoods[0])).toBe(true);
    const ranking = planner.rank({ belief: model.prior, remainingBudget: policy.costBudget });
    ranking[0].outcomes[0].posterior.fill(0);
    expect(planner.rank({ belief: model.prior, remainingBudget: policy.costBudget })[0].score).toBeCloseTo(0.2);
  });

  it.each([
    m => { m.prior[0] = -1; },
    m => { m.prior[0] = 0.5; },
    m => { m.actions[0].likelihoods[0] = [1]; },
    m => { m.actions[0].likelihoods[0] = [0.5, 0.6]; },
    m => { m.actions[0].cost = Infinity; },
    m => { m.actions[0].extra = true; },
    m => { m.actions[0].id = m.actions[1].id; },
    m => { m.decisions[0].utilities = [1]; },
    m => { m.evidence.kind = 'calibrated'; }
  ])('fails closed on malformed model %#', mutate => {
    const bad = structuredClone(model); mutate(bad);
    expect(() => createBeliefPlanner(bad, policy)).toThrow();
  });

  it('rejects implicit policies, invalid beliefs and invalid budgets', () => {
    expect(() => createBeliefPlanner(model, { ...policy, informationWeight: 1 })).toThrow();
    expect(() => createBeliefPlanner(model, { ...policy, maxActions: 0.5 })).toThrow();
    const planner = createBeliefPlanner(model, policy);
    expect(() => planner.decide([1])).toThrow();
    expect(() => planner.rank({ belief: model.prior, remainingBudget: 100 })).toThrow();
  });
});
