// Exhaustive synthetic comparison. Does not qualify real GPU diagnoses or learning.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createBeliefPlanner } from '../packages/reploid/src/agent/diagnostic-strategy.js';
import { rankSignedCandidateActions, DISCOVERY_COST_COMPONENTS } from '../self/pool/discovery-candidate-action.js';
import { diagnosticModel as model, diagnosticPolicy as basePolicy, states, causes, observeSynthetic } from './fixtures/diagnostic-model.js';

const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
// Predeclared ordinal mapping exercises the existing ranker, not a rewritten
// approximation of it. These synthetic records carry no signature/admission claim.
function heuristicChoice(ranking) {
  const candidates = ranking.map(row => ({ recordHash: digest(row.actionId), action: {
    schema: 'poolday.discovery_candidate_action/v1', status: 'proposed',
    contractHash: row.actionId, title: row.actionId, affectedHypothesisHashes: [],
    scientificCost: Object.fromEntries(DISCOVERY_COST_COMPONENTS.map(key => [key, {
      amount: key === 'compute' ? row.cost : 0, unit: 'synthetic-utility-unit',
      burden: key === 'compute' ? Math.min(5, Math.ceil(20 * row.cost)) : 0
    }])),
    expectedValue: {
      uncertaintyReduction: Math.min(5, Math.round(5 * row.informationGain / Math.log(4))),
      decisionRelevance: Math.min(5, Math.round(5 * row.decisionValue)), duplicateWorkAvoidance: 0
    }
  } }));
  const projection = rankSignedCandidateActions({ candidates });
  const selected = projection.selectedAction;
  return selected?.rankingScore > 0 ? ranking.find(row => row.actionId === selected.actionId) : null;
}

const results = [];
for (const objective of ['task-value', 'existing-heuristic', 'decision-value', 'utility-information']) {
  const policy = { ...basePolicy, objective: objective === 'existing-heuristic' ? 'decision-value' : objective,
    informationWeight: objective === 'utility-information' ? 1 : 0 };
  const planner = createBeliefPlanner(model, policy);
  const episodes = states.map(state => {
    let belief = planner.initialBelief();
    let spent = 0;
    const trace = [];
    for (let step = 0; step < policy.maxActions; step++) {
      const ranking = planner.rank({ belief, remainingBudget: Math.max(0, policy.costBudget - spent),
        excludedActionIds: trace.map(row => row.actionId) });
      const candidate = objective === 'existing-heuristic' ? heuristicChoice(ranking) : ranking[0];
      if (!candidate || (objective !== 'existing-heuristic' && candidate.score <= policy.minimumScore)) break;
      const outcomeId = observeSynthetic(state, candidate.actionId);
      belief = planner.update({ belief, actionId: candidate.actionId, outcomeId }).posterior;
      spent += candidate.cost;
      trace.push({ ...candidate, outcomeId });
    }
    const recommendation = planner.decide(belief);
    const correct = recommendation.decisionId === state.cause;
    const causeProbabilities = causes.map(cause => states.reduce((sum, s, i) => sum + (s.cause === cause ? belief[i] : 0), 0));
    const brier = causeProbabilities.reduce((sum, probability, i) => sum + (probability - Number(causes[i] === state.cause)) ** 2, 0);
    assert.ok(spent <= policy.costBudget + 1e-12 && trace.length <= policy.maxActions);
    return { state, recommendation, correct, spent, brier, belief, trace };
  });
  const mean = fn => episodes.reduce((sum, row) => sum + fn(row), 0) / episodes.length;
  results.push({ objective, accuracy: mean(row => Number(row.correct)), meanCost: mean(row => row.spent),
    meanActions: mean(row => row.trace.length), meanBrier: mean(row => row.brier),
    meanNetUtility: mean(row => Number(row.correct) - row.spent), episodes });
}
assert.equal(results.find(row => row.objective === 'decision-value').accuracy, 1);
assert.equal(results.find(row => row.objective === 'task-value').accuracy, 0.25);
const sources = ['packages/reploid/src/agent/belief-planner.js', 'packages/reploid/src/agent/diagnostic-strategy.js',
  'self/pool/discovery-candidate-action.js', 'tests/fixtures/diagnostic-model.js', 'tests/diagnostic-planning-comparison.js'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, digest(await readFile(file))])));
const report = {
  schema: 'reploid.synthetic-diagnostic-comparison/v1',
  scope: 'Exhaustive deterministic finite fixture; likelihoods are synthetic; no physical GPU or learned model execution.',
  controls: { model, policy: basePolicy, population: states, sameToolsAndPermissions: true,
    heuristicMapping: 'uncertainty=round(5*informationNats/log(4)); relevance=round(5*decisionValue); costBurden=ceil(20*cost); capped at 5',
    taskValueBaseline: 'Myopic utility at the current belief minus diagnostic cost; no future decision value.',
    utilityInformationWeight: 1 },
  limitations: ['No inference of general improvement from this designed fixture', 'No empirical calibration claim',
    'No Bayes-optimal multi-step planning claim', 'Heuristic results depend on declared ordinal mapping',
    'No peer independence, receipt admission, or deployment evidence'],
  sourceHashes, results
};
await mkdir('artifacts/diagnostic-planning', { recursive: true });
await writeFile('artifacts/diagnostic-planning/comparison.json', JSON.stringify(report, null, 2) + '\n');
console.table(results.map(({ episodes: _, ...summary }) => summary));
console.log('Evidence: artifacts/diagnostic-planning/comparison.json');
