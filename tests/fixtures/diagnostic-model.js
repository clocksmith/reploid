// Synthetic likelihoods and units for software tests, never GPU calibration.
export const causes = ['conversion', 'shader', 'memory', 'browser'];
export const states = causes.flatMap(cause => [0, 1, 2, 3].map(label => ({ cause, label })));
const action = (id, cost, outcomes, predictions) => ({
  id, tool: 'MeasureDiagnostic', args: { actionId: id }, cost,
  evidenceGroup: id, outcomes,
  likelihoods: states.map(state => outcomes.map(outcome => Number(predictions(state) === outcome)))
});
export const diagnosticModel = {
  schema: 'reploid.diagnostic-model/v1', id: 'synthetic-gpu-diagnosis-v1',
  hypotheses: states.map(({ cause, label }) => `${cause}-${label}`),
  prior: states.map(() => 1 / states.length),
  evidence: { kind: 'synthetic', reference: 'tests/fixtures/diagnostic-model.js; no measured GPU likelihoods' },
  actions: [
    action('reference', 0.05, ['mismatch', 'match'], s => ['conversion', 'shader'].includes(s.cause) ? 'mismatch' : 'match'),
    action('shader-check', 0.06, ['bad', 'ok'], s => s.cause === 'shader' ? 'bad' : 'ok'),
    action('reduced-input', 0.06, ['recovers', 'persists'], s => s.cause === 'memory' ? 'recovers' : 'persists'),
    action('cross-hardware', 0.08, ['recovers', 'persists'], s => s.cause === 'browser' ? 'recovers' : 'persists'),
    action('irrelevant-label', 0.01, ['0', '1', '2', '3'], s => String(s.label)),
    action('full-suite', 0.3, causes, s => s.cause)
  ],
  decisions: causes.map(cause => ({ id: cause, utilities: states.map(s => Number(s.cause === cause)) }))
};
export const diagnosticPolicy = {
  schema: 'reploid.diagnostic-policy/v1', objective: 'decision-value',
  costBudget: 0.16, maxActions: 2, informationWeight: 0, minimumScore: 0
};
// Independent environment table: the evaluator does not sample planner predictions.
const observations = {
  conversion: { reference: 'mismatch', 'shader-check': 'ok', 'reduced-input': 'persists', 'cross-hardware': 'persists' },
  shader: { reference: 'mismatch', 'shader-check': 'bad', 'reduced-input': 'persists', 'cross-hardware': 'persists' },
  memory: { reference: 'match', 'shader-check': 'ok', 'reduced-input': 'recovers', 'cross-hardware': 'persists' },
  browser: { reference: 'match', 'shader-check': 'ok', 'reduced-input': 'persists', 'cross-hardware': 'recovers' }
};
export function observeSynthetic(state, actionId) {
  if (actionId === 'irrelevant-label') return String(state.label);
  if (actionId === 'full-suite') return state.cause;
  return observations[state.cause][actionId];
}
