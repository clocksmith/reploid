import { freezeJson, snapshotJson } from '../config/index.js';

const fail = message => { throw new TypeError(`Diagnostic model: ${message}`); };
const object = (value, keys) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) fail(`expected fields ${keys.join(', ')}`);
};
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(value)) fail('invalid identifier');
};
const number = (value, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('invalid finite number');
};
const list = (values, max) => {
  if (!Array.isArray(values) || !values.length || values.length > max) fail('invalid bounded list');
};
const unique = values => {
  for (const value of values) id(value);
  if (new Set(values).size !== values.length) fail('duplicate identifier');
};
const distribution = (values, size) => {
  if (!Array.isArray(values) || values.length !== size) fail('distribution dimensions differ');
  for (const value of values) number(value, 0, 1);
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-10) fail('probabilities must sum to one');
};
const entropy = values => -values.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);

/** Finite, static hidden-state diagnostics. No likelihood is inferred from LLM confidence.
 * @param {import('./diagnostic-strategy.js').DiagnosticModel} model
 * @param {import('./diagnostic-strategy.js').DiagnosticPolicy} policy
 */
export function createBeliefPlanner(model, policy) {
  model = snapshotJson(model);
  policy = snapshotJson(policy);
  object(model, ['schema', 'id', 'hypotheses', 'prior', 'actions', 'decisions', 'evidence']);
  if (model.schema !== 'reploid.diagnostic-model/v1') fail('unsupported schema');
  id(model.id);
  list(model.hypotheses, 128);
  unique(model.hypotheses);
  distribution(model.prior, model.hypotheses.length);
  object(model.evidence, ['kind', 'reference']);
  if (!['synthetic', 'host-supplied'].includes(model.evidence.kind)
    || typeof model.evidence.reference !== 'string' || !model.evidence.reference.trim()) fail('likelihood provenance required');
  list(model.actions, 64);
  unique(model.actions.map(action => action.id));
  for (const action of model.actions) {
    object(action, ['id', 'tool', 'args', 'cost', 'evidenceGroup', 'outcomes', 'likelihoods']);
    id(action.tool);
    id(action.evidenceGroup);
    if (!action.args || Array.isArray(action.args) || typeof action.args !== 'object') fail('tool args must be an object');
    number(action.cost, 0, 1e6);
    list(action.outcomes, 64);
    unique(action.outcomes);
    if (!Array.isArray(action.likelihoods) || action.likelihoods.length !== model.hypotheses.length) fail('likelihood dimensions differ');
    action.likelihoods.forEach(row => distribution(row, action.outcomes.length));
  }
  list(model.decisions, 128);
  unique(model.decisions.map(decision => decision.id));
  for (const decision of model.decisions) {
    object(decision, ['id', 'utilities']);
    if (!Array.isArray(decision.utilities) || decision.utilities.length !== model.hypotheses.length) fail('utility dimensions differ');
    decision.utilities.forEach(value => number(value, -1e6, 1e6));
  }
  object(policy, ['schema', 'objective', 'costBudget', 'maxActions', 'informationWeight', 'minimumScore']);
  if (policy.schema !== 'reploid.diagnostic-policy/v1'
    || !['task-value', 'decision-value', 'utility-information'].includes(policy.objective)) fail('unsupported policy');
  number(policy.costBudget, 0, 64e6);
  number(policy.maxActions, 0, 64);
  if (!Number.isInteger(policy.maxActions)) fail('maxActions must be an integer');
  number(policy.informationWeight, 0, 1e6);
  number(policy.minimumScore, 0, 1e6);
  if (policy.objective !== 'utility-information' && policy.informationWeight !== 0) fail('information weight requires utility-information objective');
  freezeJson(model);
  freezeJson(policy);

  const validateBelief = belief => distribution(belief, model.hypotheses.length);
  const decide = belief => {
    validateBelief(belief);
    // Stable declaration order breaks ties; recommendations confer no execution authority.
    return model.decisions.map(decision => ({
      decisionId: decision.id,
      expectedUtility: decision.utilities.reduce((sum, u, i) => sum + u * belief[i], 0)
    })).sort((a, b) => b.expectedUtility - a.expectedUtility)[0];
  };
  const branches = (belief, action) => action.outcomes.map((outcomeId, j) => {
    const weights = belief.map((p, i) => p * action.likelihoods[i][j]);
    const probability = weights.reduce((sum, p) => sum + p, 0);
    return { outcomeId, probability, posterior: probability > 0 ? weights.map(p => p / probability) : null };
  });
  return Object.freeze({
    model, policy,
    initialBelief: () => [...model.prior],
    decide,
    update({ belief, actionId, outcomeId }) {
      validateBelief(belief);
      const action = model.actions.find(item => item.id === actionId);
      if (!action) fail('unknown action');
      const branch = branches(belief, action).find(item => item.outcomeId === outcomeId);
      if (!branch) fail('unknown observation');
      if (!branch.posterior) fail('observation has zero predictive probability; revise the model explicitly');
      return branch;
    },
    rank({ belief, remainingBudget, excludedActionIds = [] }) {
      validateBelief(belief);
      number(remainingBudget, 0, policy.costBudget);
      if (!Array.isArray(excludedActionIds) || excludedActionIds.some(value => !model.actions.some(a => a.id === value))) fail('unknown excluded action');
      const current = decide(belief).expectedUtility;
      const usedGroups = new Set(model.actions.filter(a => excludedActionIds.includes(a.id)).map(a => a.evidenceGroup));
      return model.actions.filter(action => action.cost <= remainingBudget && !usedGroups.has(action.evidenceGroup)).map(action => {
        const outcomes = branches(belief, action);
        const expectedUtility = outcomes.reduce((sum, branch) => sum + (branch.posterior
          ? branch.probability * decide(branch.posterior).expectedUtility : 0), 0);
        const informationGain = Math.max(0, entropy(belief) - outcomes.reduce((sum, branch) =>
          sum + (branch.posterior ? branch.probability * entropy(branch.posterior) : 0), 0));
        const decisionValue = Math.max(0, expectedUtility - current);
        const score = (policy.objective === 'task-value' ? 0 : decisionValue)
          + policy.informationWeight * informationGain - action.cost;
        return { actionId: action.id, cost: action.cost, informationGain, decisionValue, expectedUtility, score, outcomes };
      }).sort((a, b) => b.score - a.score);
    }
  });
}
