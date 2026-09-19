import { createBeliefPlanner } from './belief-planner.js';
import { createExecutionEngine, TURN_STOP } from './engine.js';
import { requireResolvedConfig, snapshotJson } from '../config/index.js';

export { createBeliefPlanner } from './belief-planner.js';

/** Optional investigation strategy; all execution remains in the shared engine.
 * Host tools own measurements, receipt validation and disclosure authorization.
 * @param {import('./diagnostic-strategy.js').DiagnosticOptions} options
 */
export function createDiagnosticInvestigation({ model, policy, config, ports }) {
  const executionPolicy = requireResolvedConfig(config);
  if (!ports || typeof ports.authorize !== 'function' || typeof ports.executeTool !== 'function'
    || typeof ports.instanceId !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(ports.instanceId)) {
    throw new TypeError('Diagnostic investigation requires explicit host ports and instanceId');
  }
  const planner = createBeliefPlanner(model, policy);
  ports = { ...ports };
  const engine = createExecutionEngine({ onEvent: ports.onExecutionEvent });
  let belief = planner.initialBelief();
  let spent = 0;
  let status = 'idle';
  let closed = false;
  let active = null;
  const history = [];
  const attempted = [];
  const evidence = new Set();
  const snapshot = () => snapshotJson({
    schema: 'reploid.diagnostic-state/v1', modelId: planner.model.id, status,
    belief, spent, attempted, history, recommendation: planner.decide(belief)
  });
  return Object.freeze({
    getSnapshot: snapshot,
    getExecutionEvents: () => engine.getEvents(),
    run() {
      if (closed) return Promise.reject(new Error('Investigation is closed'));
      if (active) return active;
      status = 'running';
      active = engine.start(async signal => {
        try {
          const authorized = await engine.invoke(() => ports.authorize({
            action: 'agent.execute', instanceId: ports.instanceId, goal: `Investigate ${planner.model.id}`
          }));
          if (authorized !== true) throw new Error('Host denied diagnostic investigation');
          await engine.turns({
            canContinue: () => attempted.length < Math.min(planner.policy.maxActions, executionPolicy.agent.maxCycles),
            async turn() {
              const ranking = planner.rank({ belief, remainingBudget: Math.max(0, planner.policy.costBudget - spent), excludedActionIds: attempted });
              const choice = ranking[0];
              if (!choice || choice.score <= planner.policy.minimumScore) return TURN_STOP;
              const action = planner.model.actions.find(item => item.id === choice.actionId);
              // Reserve declared cost before dispatch. Failed/denied/cancelled attempts
              // remain charged conservatively; repeated measurements cannot double-count.
              spent += action.cost;
              attempted.push(action.id);
              const entry = { actionId: action.id, cost: action.cost, ranking, status: 'pending', observation: null, error: null };
              history.push(entry);
              try {
                const result = await engine.tool({
                  call: { name: action.tool, args: action.args }, policy: executionPolicy,
                  instanceId: ports.instanceId, authorize: ports.authorize,
                  execute: ports.executeTool, listToolNames: () => planner.model.actions.map(item => item.tool)
                });
                signal.throwIfAborted();
                if (result.status !== 'completed') {
                  entry.status = result.status;
                  entry.error = String(result.error);
                  return TURN_STOP;
                }
                const observation = snapshotJson(result.value);
                if (!observation || typeof observation.evidenceId !== 'string' || !observation.evidenceId.trim()
                  || observation.evidenceId.length > 512 || evidence.has(observation.evidenceId)) {
                  throw new TypeError('Observation requires a fresh bounded evidenceId');
                }
                entry.observation = { outcomeId: observation.outcomeId, evidenceId: observation.evidenceId };
                if (typeof observation.outcomeId !== 'string') {
                  entry.observation = null;
                  throw new TypeError('Observation requires an outcomeId');
                }
                const update = planner.update({ belief, actionId: action.id, outcomeId: observation.outcomeId });
                entry.status = 'observed';
                evidence.add(observation.evidenceId);
                belief = update.posterior;
              } catch (error) {
                entry.status = signal.aborted ? 'cancelled' : 'rejected';
                entry.error = String(error);
                throw error;
              }
            }
          });
          status = history.at(-1)?.status === 'denied' || history.at(-1)?.status === 'failed' ? 'blocked' : 'stopped';
        } catch (error) {
          status = signal.aborted ? 'cancelled' : 'blocked';
          throw error;
        }
        return snapshot();
      }).finally(() => { active = null; });
      return active;
    },
    cancel() { if (active) status = 'cancelled'; engine.cancel(); },
    checkpoint() {
      if (closed) throw new Error('Investigation is closed');
      const record = engine.checkpoint({ model: planner.model, policy: planner.policy, state: snapshot() });
      if (new TextEncoder().encode(JSON.stringify(record)).byteLength > executionPolicy.memory.maxCheckpointBytes) {
        throw new Error('Diagnostic checkpoint exceeds configured byte limit');
      }
      return record;
    },
    async close() { closed = true; await engine.close(); status = 'closed'; }
  });
}
