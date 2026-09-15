/**
 * Application composition for bounded work. The package owns the agent loop;
 * the host owns model selection, local records, review, and session lifetime.
 * This compatibility profile does not admit a model to the peer catalog.
 */
import { createReploid } from '../vendor/reploid/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import protocol from '../vendor/reploid/agent/protocol.json' with { type: 'json' };
import policy from '../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS, DOPPLER_BROWSER_RUNTIME_VERSION } from '../config/doppler-local-models.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';

const copy = value => JSON.parse(JSON.stringify(value));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function createWorkSession({ storage, locks = globalThis.navigator?.locks,
  service = createReploidDopplerRuntimeService(), models = LOCAL_DOPPLER_MODELS } = {}) {
  requireValue(storage?.getItem && storage?.setItem, 'Work requires an instance-local record store');
  const listeners = new Set();
  let records = [], selectedId = null, active = null, closed = false, storageError = '';
  let activity = 'Describe a goal to begin.', draft = '', agentState = null;
  const read = () => {
    const raw = storage.getItem(policy.storageKey);
    if (!raw) return [];
    requireValue(new TextEncoder().encode(raw).byteLength <= policy.maxHistoryBytes, 'Saved work exceeds its storage limit');
    const value = JSON.parse(raw);
    requireValue(value.schema === policy.storageSchema && Array.isArray(value.attempts)
      && value.attempts.length <= policy.maxSavedAttempts, 'Saved work has an unsupported format');
    const ids = new Set();
    for (const row of value.attempts) {
      requireValue(row && typeof row.id === 'string' && !ids.has(row.id)
        && typeof row.goal === 'string' && row.goal.length <= policy.maxGoalCharacters
        && typeof row.output === 'string' && row.output.length <= policy.maxOutcomeCharacters
        && typeof row.modelId === 'string' && Number.isSafeInteger(row.revision),
      'Saved work contains an invalid attempt');
      ids.add(row.id);
    }
    return value.attempts;
  };
  try {
    records = read();
    selectedId = records.at(-1)?.id || null;
  } catch (error) { storageError = error.message; }
  const project = row => ({
    id: row.id, parentId: row.parentId, goal: row.goal, modelId: row.modelId,
    modelName: row.modelName, createdAt: row.createdAt, output: row.output,
    status: !active && ['loading', 'running', 'stopping'].includes(row.status) ? 'interrupted' : row.status,
    review: row.review, error: row.error, checkpointAvailable: !!row.checkpoint
  });
  const getState = () => ({
    busy: !!active, activity, draft, storageError,
    cycle: agentState?.cycle || 0, maxCycles: policy.profile.config.agent.maxCycles,
    selectedId, records: records.map(project),
    available: !!globalThis.navigator?.gpu,
    models: models.map(model => ({ id: model.id, name: model.name })),
    runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION
  });
  const notify = () => {
    const state = getState();
    for (const listener of listeners) {
      try { listener(copy(state)); } catch (error) { console.error('[Reploid Work] View update failed', error); }
    }
  };
  const save = async row => {
    requireValue(typeof locks?.request === 'function', 'Safe work retention requires browser Web Locks');
    await locks.request(policy.storageKey, async () => {
      const current = read();
      const index = current.findIndex(item => item.id === row.id);
      requireValue(index < 0 || current[index].revision === row.revision,
        'This saved attempt changed in another tab. Reload before editing it.');
      requireValue(index >= 0 || current.length < policy.maxSavedAttempts,
        'Work history is full. Existing attempts were preserved; export them before starting more work.');
      const next = copy({ ...row, revision: row.revision + 1 });
      if (index < 0) current.push(next); else current[index] = next;
      const serialized = JSON.stringify({ schema: policy.storageSchema, attempts: current });
      requireValue(new TextEncoder().encode(serialized).byteLength <= policy.maxHistoryBytes,
        'Work history is full. The current attempt remains in memory for export.');
      storage.setItem(policy.storageKey, serialized);
      row.revision = next.revision;
      records = current.map(item => item.id === row.id ? row : item);
    });
  };
  const start = async ({ goal, modelId, parentId = null }) => {
    requireValue(!closed && !active, 'Finish or pause the current work first');
    requireValue(!storageError, storageError);
    requireValue(typeof goal === 'string' && goal.trim() && goal.length <= policy.maxGoalCharacters, 'Enter a bounded goal');
    const model = models.find(item => item.id === modelId);
    requireValue(model, 'Choose an application-configured local model');
    requireValue(globalThis.navigator?.gpu, 'Local Doppler execution requires WebGPU');
    const row = {
      id: crypto.randomUUID(), parentId, goal: goal.trim(), modelId: model.id, modelName: model.name,
      createdAt: new Date().toISOString(), runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION,
      status: 'loading', output: '', review: null, error: null, revision: 0, checkpoint: null
    };
    const controller = new AbortController();
    const scope = 'reploid:work:' + row.id;
    const run = { row, controller, agent: null, inference: null, settlement: null };
    active = run;
    selectedId = row.id;
    records.push(row);
    activity = 'Preparing the local model. No goal data is sent to peers.';
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
        const session = await service.open({ scope, source: model.id, options: {
          onProgress(report) {
            if (controller.signal.aborted || closed) return;
            activity = typeof report === 'string' ? report : String(report.message || report.stage || 'Preparing local model');
            notify();
          }
        } });
        controller.signal.throwIfAborted();
        requireValue(typeof session.stream === 'function', 'Configured Doppler session does not expose text streaming');
        const profile = copy(policy.profile);
        profile.config.models.contract = { modelId: model.id, runtimeVersion: DOPPLER_BROWSER_RUNTIME_VERSION,
          execution: 'local-scoped-session', peerAdmission: false };
        const config = resolveConfig({ profile });
        const provider = {
          async generate(messages, onUpdate, { signal }) {
            const generation = (async () => {
              controller.signal.throwIfAborted();
              signal.throwIfAborted();
              let text = '';
              for await (const event of session.stream(messages, policy.generation)) {
                controller.signal.throwIfAborted();
                signal.throwIfAborted();
                if (event.type !== 'text-delta') continue;
                requireValue(typeof event.text === 'string', 'Doppler emitted an invalid text delta');
                text += event.text;
                requireValue(text.length <= policy.maxOutcomeCharacters, 'Model response exceeded the configured size limit');
                onUpdate(event.text);
              }
              requireValue(text.trim(), 'Doppler returned no text');
              return { content: text, raw: text, model: model.id, provider: 'doppler' };
            })();
            run.inference = generation;
            try { return await generation; } finally { if (run.inference === generation) run.inference = null; }
          }
        };
        const agent = createReploid({ config, ports: {
          instanceId: row.id,
          providers: { doppler: provider },
          authorize: request => !controller.signal.aborted && (request.action === 'agent.execute'
            || request.action === 'tool.execute' && request.name === 'RecordOutcome'),
          initialContext: async ({ goal: activeGoal }) => [
            { role: 'system', origin: 'host', content: protocol.instruction + '\n\n' + policy.instruction },
            { role: 'user', origin: 'goal', content: activeGoal }
          ],
          tools: {
            async RecordOutcome(args, { signal }) {
              controller.signal.throwIfAborted();
              signal?.throwIfAborted();
              requireValue(typeof args.text === 'string' && args.text.trim()
                && args.text.length <= policy.maxOutcomeCharacters, 'RecordOutcome requires a bounded text answer');
              row.output = args.text.trim();
              row.review = null;
              await save(row);
              controller.signal.throwIfAborted();
              notify();
              return { recorded: true, reviewed: false, next: 'Use IDLE to return control to the user.' };
            }
          }
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
        try { await service.close(scope); }
        catch (error) { row.error = String(error.message || error); row.status = 'failed'; }
        try { await save(row); } catch (error) { storageError = String(error.message || error); }
        if (active === run) active = null;
        draft = '';
        notify();
      }
      return project(row);
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
    getState, start, cancel,
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    select(id) { requireValue(records.some(row => row.id === id), 'Saved work was not found'); selectedId = id; notify(); },
    retry(id) {
      const row = records.find(item => item.id === id);
      requireValue(row, 'Saved work was not found');
      return start({ goal: row.goal, modelId: row.modelId, parentId: row.id });
    },
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
      cancel();
      await active?.settlement;
      listeners.clear();
      await service.closeAll();
    }
  });
}
