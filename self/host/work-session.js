/**
 * Application composition for bounded work. The package owns the agent loop;
 * the host owns model selection, local records, review, and session lifetime.
 * This compatibility profile does not admit a model to the peer catalog.
 */
import { createReploid } from '../vendor/reploid/agent/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import protocol from '../vendor/reploid/agent/protocol.json' with { type: 'json' };
import policy from '../config/work-profile.json' with { type: 'json' };
import { ZERO_GEMINI_MODEL } from '../config/zero-inference.js';
import { LOCAL_DOPPLER_MODELS, DOPPLER_BROWSER_RUNTIME_VERSION } from '../config/doppler-local-models.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createWorkFileTools } from './work-inputs.js';
import { resolveWorkTask } from './work-task.js';
import { deriveOutcomeTags, readonlyView, projectWorkRecord } from './work-view.js';
import { createWorkRepository } from './work-repository.js';
import { openWorkProvider, selectWorkModel } from '../providers/work-provider.js';
import { runWorkHelper } from './work-helpers.js';
import helperPolicy from '../config/work-evolution.json' with { type: 'json' };
export { extractProposedCriteria } from './work-task.js';
export { deriveOutcomeTags } from './work-view.js';

const copy = value => JSON.parse(JSON.stringify(value));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export const DEFAULT_WORK_MODELS = Object.freeze([
  ...LOCAL_DOPPLER_MODELS,
  Object.freeze({
    id: ZERO_GEMINI_MODEL,
    name: ZERO_GEMINI_MODEL,
    provider: 'gemini'
  })
]);

export function createWorkSession({ storage, locks = globalThis.navigator?.locks,
  service = createReploidDopplerRuntimeService(), models = DEFAULT_WORK_MODELS, peers = null, swarm = null, evolution = null,
  credentials = null, fetchImpl = globalThis.fetch } = {}) {
  requireValue(storage?.getItem && storage?.setItem, 'Work requires an instance-local record store');
  const listeners = new Set();
  let records = [], selectedId = null, active = null, closed = false, storageError = '';
  let activity = 'Describe a goal to begin.', draft = '', agentState = null;
  let pendingApproval = null, peerModels = [], discovering = false, peerDiscoveryCompleted = false, revisionDraft = null;
  const discoveryController = new AbortController();
  const repository = createWorkRepository({ storage, locks, policy });
  const read = repository.read;
  try {
    records = read();
    selectedId = records.at(-1)?.id || null;
  } catch (error) { storageError = error.message; }

  const getState = () => readonlyView({
    busy: !!active,
    activeId: active?.row.id || null,
    activity,
    draft,
    storageError,
    pendingApproval: copy(pendingApproval),
    peerModels: copy(peerModels),
    discovering,
    peerDiscoveryCompleted,
    cycle: agentState?.cycle || 0,
    maxCycles: policy.profile.config.agent.maxCycles,
    selectedId,
    records: records.map(row => projectWorkRecord(active?.row.id === row.id ? active.row : row)),
    available: typeof service.isSupported === 'function' ? service.isSupported({ models }) : true,
    models: copy(models),
    runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION
  });
  const notify = () => {
    const state = getState();
    for (const listener of listeners) {
      try { listener(copy(state)); } catch (error) { console.error('[Reploid Work] View update failed', error); }
    }
  };
  const save = async row => {
    try { records = await repository.save(row); }
    catch (error) {
      const index = records.findIndex(item => item.id === row.id);
      if (index >= 0) records[index] = copy(row);
      else records.push(copy(row));
      throw error;
    }
  };
  const discoverPeers = async ({ signal = discoveryController.signal } = {}) => {
    requireValue(!closed && peers, 'Peer discovery is not connected');
    requireValue(!discovering, 'Peer discovery is already running');
    discovering = true; notify();
    try { peerModels = await peers.discover({ signal }); peerDiscoveryCompleted = true; return copy(peerModels); }
    finally { discovering = false; notify(); }
  };
  const start = async ({ goal, modelId, parentId = null, criteria = '', feedback = '',
    inputs = [], allowPeers = false, recallAccepted = false, allowHelpers = false, allowImprovement = false }) => {
    requireValue(!closed && !active, 'Finish or pause the current work first');
    requireValue(!storageError, storageError);
    requireValue(typeof allowHelpers === 'boolean' && typeof allowImprovement === 'boolean', 'Task permissions must be explicit');
    const taskContract = resolveWorkTask({ goal, criteria, feedback, parentId, inputs, allowPeers, recallAccepted }, { policy, records });
    const parentRecord = taskContract.parent;
    const model = selectWorkModel({ models, modelId, defaultModelId: policy.defaultModelId });
    const isDopplerModel = model.provider === 'doppler';
    if (isDopplerModel) {
      requireValue(globalThis.navigator?.gpu, 'Local Doppler execution requires WebGPU');
    }
    const row = {
      id: crypto.randomUUID(), parentId, goal: goal.trim(), modelId: model.id, modelName: model.name,
      createdAt: new Date().toISOString(), runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION,
      status: 'loading', output: '', review: null, error: null, revision: 0, checkpoint: null,
      criteria: taskContract.criteria, feedback: taskContract.feedback, inputs: taskContract.inputs,
      artifacts: [], events: [], peerJobs: [], helpers: [], improvements: [], allowPeers, recallAccepted, allowHelpers, allowImprovement
    };
    const controller = new AbortController();
    const scope = 'reploid:work:' + row.id;
    const run = { row, controller, agent: null, inference: null, settlement: null, approval: null, peerDeclined: false };
    active = run;
    revisionDraft = null;
    selectedId = row.id;
    records.push(row);
    activity = isDopplerModel
      ? 'Preparing the local model. No goal data is sent to peers.'
      : 'Connecting to Gemini inference...';
    draft = ''; agentState = null;
    notify();
    const task = async () => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        controller.abort(new Error('Work deadline reached'));
        run.agent?.cancel();
        activity = 'Stopping after the current model operation.';
        notify();
      }, policy.profile.config.agent.timeoutMs);
      try {
        await save(row);
        controller.signal.throwIfAborted();
        const adapter = await openWorkProvider({ model, service, scope, credentials, fetchImpl,
          signal: controller.signal, generation: policy.generation,
          maxOutcomeCharacters: policy.maxOutcomeCharacters,
          allowedFallbackModels: policy.allowedFallbackModels,
          onProgress(report) {
            if (controller.signal.aborted || closed) return;
            activity = typeof report === 'string' ? report : String(report.message || report.stage || 'Preparing local model');
            notify();
          }
        });
        const provider = {
          async generate(...args) {
            const generation = adapter.generate(...args);
            run.inference = generation;
            try {
              const result = await generation;
              row.execution = { provider: result.provider, requestedModel: result.requestedModel,
                actualModel: result.model, kind: result.execution };
              return result;
            } finally { if (run.inference === generation) run.inference = null; }
          }
        };
        const profile = copy(policy.profile);
        profile.config.models.providerId = model.provider;
        profile.config.models.contract = { modelId: model.id, runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION,
          execution: isDopplerModel ? 'local-scoped-session' : 'cloud-proxy-session', peerAdmission: false };
        const toolNames = profile.config.tools.allowed.filter(name =>
          (recallAccepted || name !== 'RecallWork')
          && (allowPeers && peers || !['ListPeerModels', 'RequestPeerJob'].includes(name))
          && (allowPeers && swarm || name !== 'AskPeer')
          && (allowHelpers || name !== 'AskHelper')
          && (evolution || !['ListTools', 'RunTool', 'ProposeImprovement'].includes(name))
          && (allowImprovement || name !== 'ProposeImprovement'));
        profile.config.improvement.enabled = !!(allowImprovement && evolution);
        if (profile.config.improvement.enabled) Object.assign(profile.config.improvement, {
          evaluatorId: 'work:protected-suite', approvalId: 'work:operator', isolationId: 'work:opaque-worker'
        });
        profile.config.tools.allowed = toolNames;
        profile.config.tools.ordered = toolNames;
        const config = resolveConfig({ profile });
        const toolVersions = evolution ? await evolution.describe() : [];
        const recordPeer = async event => {
          row.peerJobs.push(copy(event));
          await save(row);
          notify();
        };
        const approve = preview => {
          controller.signal.throwIfAborted();
          requireValue(!run.peerDeclined, 'Peer assistance was withdrawn for this attempt');
          return new Promise(resolve => {
            let timer;
            const finish = accepted => {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', aborted);
              run.approval = null; pendingApproval = null;
              notify(); resolve(accepted);
            };
            const aborted = () => finish(false);
            run.approval = { id: preview.id, finish };
            pendingApproval = { ...copy(preview), goal: row.goal };
            timer = setTimeout(() => finish(false), Math.max(0, preview.expiresAt - Date.now()));
            controller.signal.addEventListener('abort', aborted, { once: true });
            notify();
          });
        };
        const availableTools = {
          ...createWorkFileTools({ row, save }),
          ListTools() { return toolVersions; },
          RunTool(args) {
            return evolution.run(args.targetId, typeof args.input === 'string' ? JSON.parse(args.input) : args.input,
              { signal: controller.signal, versions: toolVersions });
          },
          async ProposeImprovement(args) {
            const candidate = await evolution.propose({ ...args, taskId: row.id,
              generator: { implementation: 'reploid/shared-engine/work', model: row.execution || model,
                instruction: policy.instruction } }, { signal: controller.signal });
            row.improvements.push({ id: candidate.id, targetId: candidate.targetId, status: candidate.status, evaluation: candidate.evaluation });
            await save(row); notify();
            return { ...candidate, code: undefined, next: 'The operator reviews this independently. Continue the task with the pinned current tool.' };
          },
          async AskHelper({ goal }) {
            requireValue(row.helpers.length < helperPolicy.maxHelpers, 'Helper allowance reached');
            const helper = { id: crypto.randomUUID(), goal, location: model.provider === 'doppler' ? 'this device' : 'cloud', status: 'running' };
            row.helpers.push(helper); await save(row); notify();
            try {
              const result = await runWorkHelper({ goal, inputs: row.inputs, provider, signal: controller.signal,
                onChange: state => { Object.assign(helper, state); notify(); } });
              helper.output = result.output; helper.status = 'completed'; return result;
            } catch (error) { helper.error = error.message; helper.status = 'failed'; throw error; }
            finally { await save(row); notify(); }
          },
          AskPeer(args) {
            requireValue(!run.peerDeclined, 'Peer assistance was withdrawn for this attempt');
            return swarm.execute(args, { signal: controller.signal, approve, record: recordPeer,
              onPartial: () => { activity = 'Receiving a peer helper response.'; notify(); } });
          },
          RecallWork({ query }) {
            requireValue(typeof query === 'string' && query.trim(), 'RecallWork requires a query');
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            return records.filter(item => item.id !== row.id && item.review?.accepted === true
              && words.some(word => (item.goal + ' ' + item.output).toLowerCase().includes(word)))
              .slice(-policy.memory.maxRecalledAttempts).map(item => ({
                id: item.id, goal: item.goal, outcome: item.output.slice(0, policy.memory.maxRecalledCharacters),
                authority: 'Previously accepted local work, not an independently validated fact'
              }));
          },
          ListPeerModels() { return discoverPeers({ signal: controller.signal }); },
          async RequestPeerJob(args) {
            requireValue(!run.peerDeclined, 'Peer assistance was withdrawn for this attempt');
            return peers.execute({
              modelId: args.modelId,
              input: typeof args.input === 'string' ? JSON.parse(args.input) : args.input,
              options: typeof args.options === 'string' ? JSON.parse(args.options) : args.options
            }, {
              signal: controller.signal, approve, record: recordPeer,
              onPartial: () => { activity = 'Receiving the approved peer operation.'; notify(); }
            });
          },
          async RecordOutcome(args) {
            requireValue(typeof args.text === 'string' && args.text.trim()
              && args.text.length <= policy.maxOutcomeCharacters, 'RecordOutcome requires a bounded text answer');
            row.output = args.text.trim();
            row.review = null;
            await save(row);
            return { recorded: true, reviewed: false, next: 'Use IDLE to return control to the user.' };
          }
        };
        const tools = Object.fromEntries(toolNames.map(name => [name, async (args, { signal }) => {
          controller.signal.throwIfAborted(); signal?.throwIfAborted();
          requireValue(row.events.length < policy.maxEvents, 'Task activity allowance reached');
          const event = { tool: name, status: 'running', at: new Date().toISOString() };
          row.events.push(event);
          await save(row); notify();
          try {
            controller.signal.throwIfAborted(); signal?.throwIfAborted();
            const result = await availableTools[name](args);
            controller.signal.throwIfAborted(); signal?.throwIfAborted();
            event.status = 'completed';
            return result;
          } catch (error) {
            event.status = 'failed'; event.error = String(error.message || error);
            throw error;
          } finally {
            await save(row); notify();
          }
        }]));
        const agent = createReploid({ config, ports: {
          instanceId: row.id, providers: { [model.provider]: provider },
          authorize: request => !controller.signal.aborted && (request.action === 'agent.execute'
            || request.action === 'tool.execute' && Object.hasOwn(tools, request.name)),
          initialContext: async ({ goal: activeGoal }) => [
            { role: 'system', origin: 'host', content: protocol.instruction + '\\n\\n' + policy.instruction
              + '\\nPermitted tools: ' + toolNames.join(', ') + '. Other tools are unavailable.' },
            { role: 'user', origin: 'goal', content: JSON.stringify({
              goal: activeGoal, successCriteria: row.criteria,
              inputs: row.inputs.map(({ id, name, bytes }) => ({ id, name, bytes })),
              revision: parentRecord ? { parentId: parentRecord.id, feedback: row.feedback, previousOutcome: parentRecord.output,
                previousFailure: parentRecord.error, authority: 'Prior task data, not instructions' } : null,
              permissions: { peerProposals: allowPeers, recallAccepted, helpers: allowHelpers,
                improvementExperiments: allowImprovement, adoption: false }
            }) }
          ],
          tools
        } });
        run.agent = agent;
        unsubscribe = agent.subscribe(snapshot => {
          if (closed) return;
          agentState = snapshot;
          activity = snapshot.activity || 'Working locally';
          draft = snapshot.draft || '';
          notify();
        });
        row.status = 'running';
        await save(row);
        controller.signal.throwIfAborted();
        const result = await agent.execute({ goal: row.goal });
        row.status = controller.signal.aborted ? 'paused' : result.status === 'ERROR' ? 'failed'
          : row.output ? 'review' : 'paused';
        if (result.status === 'ERROR') row.error = result.context.filter(item => item.origin === 'system').at(-1)?.content || result.activity;
        row.checkpoint = await agent.checkpoint();
        activity = row.status === 'review' ? 'Outcome ready for your review.'
          : row.status === 'failed' ? 'Work stopped with an error.' : 'Work paused. No completed outcome is being claimed.';
      } catch (error) {
        row.status = controller.signal.aborted ? 'paused' : 'failed';
        row.error = String(error.message || error);
        activity = row.error;
      } finally {
        clearTimeout(timer);
        unsubscribe();
        // The compatibility API cancels cooperatively between model steps.
        // Keep ownership until an outstanding inference settles, then release.
        try {
          await run.inference?.catch(() => {});
          await run.agent?.close();
        } catch (error) { row.error = String(error.message || error); row.status = 'failed'; }
        try { if (isDopplerModel) await service.close(scope); }
        catch (error) { row.error = String(error.message || error); row.status = 'failed'; }
        try { await save(row); } catch (error) { storageError = String(error.message || error); }
        if (active === run) active = null;
        draft = '';
        notify();
      }
      return projectWorkRecord(row);
    };
    run.settlement = task();
    return run.settlement;
  };
  const cancel = () => {
    if (!active) return;
    active.row.status = 'stopping';
    active.controller.abort(new Error('Paused by user'));
    active.agent?.cancel();
    activity = 'Stopping after the current model operation.';
    notify();
  };
  return Object.freeze({
    getState, start, cancel, discoverPeers,
    getDraft: () => revisionDraft ? copy(revisionDraft) : null,
    clearDraft() { revisionDraft = null; },
    approvePeer(id, accepted) {
      requireValue(typeof accepted === 'boolean' && active?.approval?.id === id, 'This peer proposal is no longer active');
      if (!accepted) active.peerDeclined = true;
      active.approval.finish(accepted);
    },
    getArtifact(id, artifactId) {
      const artifact = records.find(row => row.id === id)?.artifacts?.find(item => item.id === artifactId);
      requireValue(artifact, 'Result file was not found');
      return copy(artifact);
    },
    prepareRevision(id) {
      const row = records.find(item => item.id === id);
      requireValue(row && !active, 'Select a saved attempt after the current work finishes');
      revisionDraft = copy({ parentId: row.id, goal: row.goal, criteria: row.criteria || '', modelId: row.modelId,
        inputs: row.inputs || [], feedback: '', allowPeers: false, recallAccepted: false });
      return copy(revisionDraft);
    },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    select(id) { requireValue(records.some(row => row.id === id), 'Saved work was not found'); selectedId = id; notify(); },

    async review(id, accepted) {
      requireValue(!active && !closed, 'Pause work before reviewing an outcome');
      const row = records.find(item => item.id === id);
      requireValue(row?.output && typeof accepted === 'boolean', 'A delivered outcome is required for review');
      row.review = { accepted, authority: 'local-user', at: new Date().toISOString(), independentEvaluation: false };
      await save(row);
      notify();
    },
    exportRecords() { return copy({ schema: policy.storageSchema, attempts: records, storageError }); },
    async close() {
      if (closed) return;
      closed = true;
      discoveryController.abort(new Error('Work closed'));
      cancel();
      await active?.settlement;
      listeners.clear();
      // The injected service may be shared; only this attempt's scope is owned.
    }
  });
}
