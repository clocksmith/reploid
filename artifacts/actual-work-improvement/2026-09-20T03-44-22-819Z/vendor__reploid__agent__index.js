import { requireResolvedConfig, snapshotJson } from '../config/index.js';
import { createAgentRuntime } from '../agent/runtime.js';
import ResponseParser from '../agent/response-parser.js';
import protocol from '../agent/protocol.json' with { type: 'json' };
import { createCheckpoint, verifyCheckpoint } from '../artifacts/checkpoint.js';

export { createAgentRuntime } from '../agent/runtime.js';
export { createToolRunner } from '../agent/tool-runner.js';
export { default as ResponseParser } from '../agent/response-parser.js';

export function createReploid({ config, ports }) {
  const policy = requireResolvedConfig(config);
  if (!ports || typeof ports.instanceId !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(ports.instanceId)) {
    throw new TypeError('A stable, explicit instanceId port is required');
  }
  if (typeof ports.authorize !== 'function') throw new TypeError('Host authorization callback is required');
  const instanceId = ports.instanceId;
  const listeners = new Set(), subscriptions = new Set();
  const owned = new Set(ports.owned || []);
  for (const resource of owned) {
    if (typeof resource?.close !== 'function') throw new TypeError('Owned resources must implement close()');
  }
  const quiet = () => {};
  const parser = ports.responseParser || ResponseParser.factory({
    Utils: { logger: { warn: quiet, error: quiet, info: quiet, debug: quiet },
      sanitizeLlmJsonRespPure: text => ({ json: String(text).trim().replace(/^\`\`\`(?:json)?\s*|\s*\`\`\`$/g, '') }) }
  });
  let runtime = null, runtimeSubscription = null, prepared = null, closing = null, closed = false;
  let execution = null;
  let executionEpoch = 0;
  const model = policy.models.providerId === null ? null : ports.providers?.[policy.models.providerId];
  const store = policy.memory.storeId === null ? null : ports.stores?.[policy.memory.storeId];
  if (policy.memory.storeId !== null && !store) throw new TypeError('Configured store port is not registered');
  const check = () => { if (closed) throw new Error('Reploid instance is closed'); };
  const notify = snapshot => {
    if (!policy.observation.enabled) return;
    for (const listener of listeners) { try { listener(snapshotJson(snapshot)); } catch {} }
  };
  const getSnapshot = () => runtime?.getSnapshot() || {
    instanceId, status: closed ? 'CLOSED' : 'IDLE', running: false, goal: null, context: []
  };
  const on = (event, listener) => {
    check();
    if (typeof ports.agent?.on !== 'function') return () => {};
    const unsubscribe = ports.agent.on(event, listener);
    const remove = () => { unsubscribe?.(); subscriptions.delete(remove); };
    subscriptions.add(remove);
    return remove;
  };
  const makePorts = () => {
    if (ports.agent) return { ...ports.agent, authorize: ports.authorize };
    return {
      initialContext: ports.initialContext || (async ({ goal }) => [
        { role: 'system', origin: 'host', content: protocol.instruction },
        { role: 'user', origin: 'goal', content: goal }
      ]),
      generate(messages, onUpdate, control) {
        const provider = ports.mesh || model;
        if (typeof provider?.generate !== 'function') throw new Error('No model or mesh provider configured');
        return provider.generate(messages, onUpdate, control);
      },
      executeTool(name, args, control) {
        const tool = ports.tools?.[name];
        if (typeof tool !== 'function') throw new Error(`Tool is not registered: ${name}`);
        return tool(args, control);
      },
      listToolNames: () => Object.keys(ports.tools || {}),
      getModelLabel: () => policy.models.providerId || 'unconfigured',
      getModelConfig: () => model || ports.mesh ? { id: policy.models.providerId } : null,
      getSwarmSnapshot: () => ports.mesh?.describe?.() || null,
      authorize: ports.authorize
    };
  };
  const prepare = (request) => {
    check();
    const goal = String(request?.goal || '').trim();
    if (!goal) throw new TypeError('Execution request requires an active goal');
    if (runtime) {
      if (prepared.goal !== goal) throw new Error('Use a new instance for a different active goal');
      return getSnapshot();
    }
    prepared = { goal, environment: String(request.environment || '') };
    runtime = createAgentRuntime({ config, ports: makePorts(), instanceId,
      responseParser: parser, onExecutionEvent: ports.onExecutionEvent, ...prepared });
    runtimeSubscription = runtime.subscribe(notify);
    return getSnapshot();
  };
  return Object.freeze({
    config, instanceId, prepare, getSnapshot, on,
    getExecutionEvents: () => runtime?.getExecutionEvents() || [],
    subscribe(listener) {
      check();
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      listener(snapshotJson(getSnapshot()));
      return () => listeners.delete(listener);
    },
    execute(request) {
      check();
      if (execution) return execution;
      prepare(request);
      const epoch = executionEpoch;
      execution = Promise.resolve().then(async () => {
        if (await ports.authorize({ action: 'agent.execute', instanceId, goal: prepared.goal }) !== true) {
          throw new Error('Host denied goal execution');
        }
        check();
        if (epoch !== executionEpoch) throw new Error('Execution cancelled');
        await runtime.start();
        return getSnapshot();
      }).finally(() => { execution = null; });
      return execution;
    },
    async connect() {
      check();
      if (!policy.mesh.enabled) throw new Error('Networking is disabled');
      if (await ports.authorize({ action: 'mesh.connect', instanceId, roomId: policy.mesh.roomId }) !== true) throw new Error('Host denied network connection');
      check();
      if (typeof ports.mesh?.connect !== 'function') throw new Error('No mesh protocol adapter registered');
      return ports.mesh.connect();
    },
    cancel() { executionEpoch += 1; runtime?.stop(); },
    async settle() {
      check();
      await execution?.catch(() => {});
      await runtime?.settle();
    },
    async checkpoint() {
      check();
      if (!runtime || execution) throw new Error('Pause active execution before checkpointing');
      const checkpoint = await createCheckpoint({ config, instanceId, state: runtime.checkpoint(), cryptoApi: ports.crypto });
      if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > policy.memory.maxCheckpointBytes) throw new Error('Checkpoint exceeds configured byte limit');
      if (store) await store.set(`${policy.memory.checkpointPrefix}/${instanceId}`, checkpoint);
      return checkpoint;
    },
    async restore(checkpoint) {
      check();
      if (runtime) throw new Error('Restore requires an unused instance');
      if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > policy.memory.maxCheckpointBytes) throw new Error('Checkpoint exceeds configured byte limit');
      const state = await verifyCheckpoint({ checkpoint, config, instanceId, cryptoApi: ports.crypto });
      check();
      prepare({ goal: state.goal, environment: state.environment });
      runtime.restore(state);
      return getSnapshot();
    },
    close() {
      if (closing) return closing;
      closed = true;
      runtime?.stop();
      closing = (async () => {
        await runtime?.close();
        await execution?.catch(() => {});
        runtimeSubscription?.();
        for (const remove of subscriptions) remove();
        subscriptions.clear();
        listeners.clear();
        const failures = [];
        for (const resource of [...owned].reverse()) {
          try { await resource.close(); } catch (error) { failures.push(error); }
        }
        owned.clear();
        if (failures.length) throw new AggregateError(failures, 'Owned resource shutdown failed');
      })();
      return closing;
    }
  });
}

export { CYCLE_ARTIFACT_ROOT, getCycleId, getCycleArtifactPath, createCycleArtifactWriter } from '../agent/cycle-artifacts.js';
