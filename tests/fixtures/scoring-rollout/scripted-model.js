/**
 * A scripted whole model for the scoring-rollout runs (run.js): it stands where server/native-whole-model.js stands in
 * the native participant of EITHER checkout, the current one or an older one, so one host process can be the real
 * fleet native host of that version with no weights and no GPU. host.js puts it in place with a module resolve hook.
 *
 * Generation answers "one two three". Target scoring returns a fixed, Doppler-shaped target score, by the port each
 * version calls: `executeOperation({ operation: 'scoreTargetSequence' })` (the current mesh-operation envelope) and
 * `scoreTarget()` (the receipt-bound score an older host serves). Every call that would run the model is printed as a
 * `model-call` line, so a run can show that a refused request ran nothing.
 */
const WORDS = ['one', 'two', 'three'];
export const SCRIPTED_SCORE = Object.freeze({ schema: 'doppler.target-sequence-score/v1', interpretation: 'teacher-forced-target-log-probability',
  tokenCount: 3, promptTokenCount: 21, targetTokenIds: [40, 9, 13], tokenLogProbs: [-0.1, -0.2, -0.03], totalLogProb: -0.33,
  meanLogProb: -0.11, roundedTotalLogProb: -0.33 });

const report = (operation, extra = {}) => process.stdout.write(JSON.stringify({ event: 'model-call', operation, at: new Date().toISOString(), ...extra }) + '\n');

export function createScriptedWholeModel({ model, onChange = () => {} }) {
  let offering = false, executing = false, completed = 0, closed = false;
  const operations = ['generate', 'scoreTargetSequence'];
  const phase = () => { if (executing) return 'executing'; return offering ? 'ready' : 'idle'; };
  const getState = () => ({ phase: phase(), mode: 'whole-model', offering, ready: offering && !closed,
    modelId: model.id, modelIdentity: offering ? model.identity : null, adapterIdentities: [], completed, supportedOperations: operations });
  const score = async ({ operation, signal }) => {
    report(operation);
    signal?.throwIfAborted();
    if (!offering || closed) throw new Error('Scripted model is not ready');
    return { ...structuredClone(SCRIPTED_SCORE), modelIdentity: model.identity };
  };
  return Object.freeze({
    getState,
    // An output limit is the one setting a Daily turn names (server/daily/fleet.js pins it).
    getGenerationSettingsCapability: () => ({ schema: 'reploid.generation-settings/v1', maxOutputTokens: true, tools: false, outputSchema: false, thinking: false }),
    getExecutionState() { const state = getState(); return { ...state, phase: state.ready ? 'ready' : state.phase, activity: { phase: state.phase, completed, error: null } }; },
    async contribute(approved) {
      if (approved !== true) throw new Error('Approve contribution before serving');
      offering = true; onChange(getState());
      return getState();
    },
    async generate(messages, onUpdate, controls) {
      report('generate');
      const prompt = String(messages.at(-1)?.content ?? '');
      executing = true; onChange(getState());
      try {
        let content = '';
        for (const [index, word] of WORDS.entries()) {
          controls?.signal?.throwIfAborted();
          const chunk = (index ? ' ' : '') + word;
          content += chunk; onUpdate(chunk);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        completed += 1;
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content,
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: Math.max(1, prompt.split(/\s+/).length), generatedTokenCount: WORDS.length, stopReason: 'eos-token' } };
      } finally { executing = false; onChange(getState()); }
    },
    supportedOperations: () => [...operations],
    executeOperation({ operation, signal }) {
      if (operation !== 'scoreTargetSequence') return Promise.reject(new Error(`The scripted model cannot run ${operation}`));
      return score({ operation: 'executeOperation:scoreTargetSequence', signal });
    },
    scoreTarget: ({ signal } = {}) => score({ operation: 'scoreTarget', signal }),
    async stop() { offering = false; onChange(getState()); },
    async close() { closed = true; offering = false; }
  });
}

/** The name the native participant of every version imports. */
export const createNativeWholeModel = createScriptedWholeModel;
