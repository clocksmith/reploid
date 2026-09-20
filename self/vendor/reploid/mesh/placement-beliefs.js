import { snapshotJson, freezeJson } from '../config/index.js';

const fail = message => { throw new TypeError(`Placement beliefs: ${message}`); };
const fields = (value, names) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(key => !names.includes(key))
    || names.some(key => !Object.hasOwn(value, key))) fail(`expected fields ${names.join(', ')}`);
};
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(value)) fail('bounded identifier required');
};
const bounded = (value, minimum, maximum) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail('finite bounded number required');
};
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** A categorical likelihood with Dirichlet priors. Outcome costs are host-declared
 * estimates, not measured hardware facts. The host owns observation admission.
 * @param {import('./placement-beliefs.js').PlacementBeliefPolicy} input
 */
export function resolvePlacementBeliefPolicy(input) {
  const policy = snapshotJson(input);
  fields(policy, ['schema', 'id', 'cohortId', 'maxObservations', 'maxAgeMs', 'completionValue',
    'timeCostPerMs', 'costUnit', 'outcomes']);
  if (policy.schema !== 'reploid.placement-belief-policy/v1') fail('unsupported policy');
  id(policy.id); id(policy.cohortId); id(policy.costUnit);
  bounded(policy.maxObservations, 1, 4096); bounded(policy.maxAgeMs, 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(policy.maxObservations) || !Number.isSafeInteger(policy.maxAgeMs)) fail('integer bounds required');
  bounded(policy.completionValue, 0, 1e9); bounded(policy.timeCostPerMs, 0, 1e6);
  if (!Array.isArray(policy.outcomes) || policy.outcomes.length < 2 || policy.outcomes.length > 64
    || new Set(policy.outcomes.map(row => row.id)).size !== policy.outcomes.length) fail('bounded distinct outcomes required');
  for (const outcome of policy.outcomes) {
    fields(outcome, ['id', 'prior', 'completed', 'latencyMs', 'totalCost']);
    id(outcome.id); bounded(outcome.prior, 1e-6, 1e6);
    if (typeof outcome.completed !== 'boolean') fail('explicit completion outcome required');
    bounded(outcome.latencyMs, 0, 1e9); bounded(outcome.totalCost, 0, 1e9);
  }
  return freezeJson(policy);
}

/** Pure, replayable projection. No clocks, storage, CI, network or authority grants.
 * Cancellation is censored (null outcome), never invented as a failed completion.
 * @param {import('./placement-beliefs.js').PlacementBeliefInput} input
 * @returns {import('./placement-beliefs.js').PlacementBeliefProjection}
 */
export function projectPlacementBeliefs(input) {
  const { observations, candidates, now } = snapshotJson(input);
  const policy = resolvePlacementBeliefPolicy(input.policy);
  if (!Number.isSafeInteger(now) || now < 0) fail('explicit time required');
  if (!Array.isArray(observations) || observations.length > policy.maxObservations) fail('bounded observations required');
  if (!Array.isArray(candidates) || candidates.length > 4096
    || new Set(candidates.map(row => row.providerId)).size !== candidates.length) fail('bounded unique candidates required');
  for (const candidate of candidates) {
    fields(candidate, ['providerId', 'contextId']); id(candidate.providerId); id(candidate.contextId);
  }
  const outcomes = new Map(policy.outcomes.map((row, i) => [row.id, i]));
  const evidence = new Map(), dependencies = new Map(), ignored = [];
  // Sort first so repeated delivery and caller iteration order cannot choose evidence.
  const sorted = [...observations].sort((a, b) => lexical(a.evidenceId, b.evidenceId));
  for (const row of sorted) {
    fields(row, ['evidenceId', 'dependencyId', 'providerId', 'contextId', 'observedAt', 'outcomeId']);
    for (const key of ['evidenceId', 'dependencyId', 'providerId', 'contextId']) id(row[key]);
    if (!Number.isSafeInteger(row.observedAt) || row.observedAt < 0 || row.observedAt > now) fail('invalid observation time');
    if (row.outcomeId !== null && !outcomes.has(row.outcomeId)) fail('unknown outcome');
    const prior = evidence.get(row.evidenceId);
    if (prior) {
      if (['dependencyId', 'providerId', 'contextId', 'observedAt', 'outcomeId'].some(key => prior[key] !== row[key])) fail('conflicting evidence identity');
      continue;
    }
    evidence.set(row.evidenceId, row);
    const related = dependencies.get(row.dependencyId);
    if (related && ['providerId', 'contextId', 'outcomeId', 'observedAt'].some(key => related[key] !== row[key])) {
      fail('dependent observations require a joint model; conflicting reports cannot be independent trials');
    }
    if (related) { ignored.push({ evidenceId: row.evidenceId, reason: 'shared-evidence' }); continue; }
    dependencies.set(row.dependencyId, row);
  }
  const counts = new Map(candidates.map(row => [row.providerId, policy.outcomes.map(() => 0)]));
  const used = new Map(candidates.map(row => [row.providerId, []]));
  for (const row of dependencies.values()) {
    const candidate = candidates.find(item => item.providerId === row.providerId);
    const reason = now - row.observedAt > policy.maxAgeMs ? 'stale'
      : !candidate || candidate.contextId !== row.contextId ? 'different-context'
        : row.outcomeId === null ? 'censored' : null;
    if (reason) { ignored.push({ evidenceId: row.evidenceId, reason }); continue; }
    counts.get(row.providerId)[outcomes.get(row.outcomeId)] += 1;
    used.get(row.providerId).push(row.evidenceId);
  }
  const rows = [...candidates].sort((a, b) => lexical(a.providerId, b.providerId)).map(candidate => {
    const alpha = policy.outcomes.map((row, i) => row.prior + counts.get(candidate.providerId)[i]);
    const concentration = alpha.reduce((sum, value) => sum + value, 0);
    const probability = alpha.map(value => value / concentration);
    const mean = values => values.reduce((sum, value, i) => sum + value * probability[i], 0);
    const utility = policy.outcomes.map(row => (row.completed ? policy.completionValue : 0)
      - row.totalCost - policy.timeCostPerMs * row.latencyMs);
    const expectedUtility = mean(utility);
    return { ...candidate, evidenceIds: used.get(candidate.providerId),
      posterior: policy.outcomes.map((row, i) => ({ outcomeId: row.id, alpha: alpha[i], probability: probability[i],
        probabilityVariance: probability[i] * (1 - probability[i]) / (concentration + 1) })),
      completionProbability: mean(policy.outcomes.map(row => Number(row.completed))),
      expectedLatencyMs: mean(policy.outcomes.map(row => row.latencyMs)),
      expectedTotalCost: mean(policy.outcomes.map(row => row.totalCost)), expectedUtility,
      utilityVariance: mean(utility.map(value => (value - expectedUtility) ** 2)) / (concentration + 1) };
  });
  return freezeJson({ schema: 'reploid.placement-beliefs/v1', policy, selectedAt: now, candidates: rows,
    ignored: ignored.sort((a, b) => lexical(a.evidenceId, b.evidenceId)) });
}
