import { createRunTraceRecorder } from '../infrastructure/telemetry-timeline.js';
import AgentLoop from '../vendor/reploid/agent/legacy-loop.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import { getCurrentReploidStorage } from '../instance.js';
import * as Policies from './agent-loop-policies.js';
import { buildAgentInitialContext } from './agent-context.js';
import { requireSurfaceIntent, authorizeSurfaceOperation } from '../config/surface-intents.js';
import profile from '../config/reploid-library.json' with { type: 'json' };
import { buildRunReplayBundle, readImportedRunReplaySummary } from './run-replay-bundle.js';

export default {
  ...AgentLoop,
  factory: deps => {
    let attemptSurface = requireSurfaceIntent('zero');
    let selectedModels = [];
    const trace = createRunTraceRecorder({ VFS: deps.VFS,
      onPersistenceError: message => deps.EventBus.emit('agent:warning', { message: `Recording not saved: ${message}` })
    });
    let nextCallId = 0;
    let runPending = false;
    const loop = AgentLoop.factory({
    ...deps,
    EventBus: { ...deps.EventBus, emit(type, payload) {
      trace.recordEvent(type, payload);
      deps.EventBus.emit(type, payload);
    } },
    ToolExecutor: deps.ToolExecutor ? { ...deps.ToolExecutor, async executeWithRetry(call, options) {
      const callId = `call-${++nextCallId}`;
      const identity = { callId, tool: call.name, cycle: options?.iteration ?? null };
      trace.record('tool_call', { ...identity, args: call.args || {} });
      try {
        const result = await deps.ToolExecutor.executeWithRetry(call, options);
        trace.record('tool_result', { ...identity, result: Object.hasOwn(result, 'rawResult') ? result.rawResult : result.result,
          error: result.error?.message || null, durationMs: result.duration ?? null });
        return result;
      } catch (error) {
        trace.record('tool_result', { ...identity, result: null, error: error?.message || String(error) });
        throw error;
      }
    } } : deps.ToolExecutor,
    config: resolveConfig({ profile: profile.profile }),
    Storage: getCurrentReploidStorage(), Policies, buildInitialContext: buildAgentInitialContext,
    authorizeTool(request) {
      return authorizeSurfaceOperation(attemptSurface, request,
        () => deps.ToolRunner.has ? deps.ToolRunner.has(request.name) : deps.ToolRunner.list?.().includes(request.name) === true);
    },
    resolveAttemptConfig(model) {
      const mode = typeof globalThis.window?.getReploidMode === 'function' ? globalThis.window.getReploidMode() : 'zero';
      attemptSurface = requireSurfaceIntent(mode === 'x' ? 'x' : 'zero');
      const state = deps.StateManager?.getState?.() || {};
      const config = state.config || {};
      const storage = getCurrentReploidStorage();
      const read = key => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };
      return resolveConfig({ profile: profile.profile, overrides: { legacyAgent: {
        maxToolCalls: config.maxToolCallsPerIteration || 8,
        settings: {
          providerThrottle: Policies.resolveProviderThrottleConfig([model?.agentThrottle, model?.providerThrottle,
            model?.throttle?.provider, config.agentThrottle,
            config.providerThrottle, read('REPLOID_PROVIDER_THROTTLE')]),
          cycleIntervalMs: Policies.resolveAgentCycleIntervalMs([config.agentCycleThrottle,
            config.cycleThrottle, model?.agentCycleThrottle, model?.cycleThrottle,
            read('REPLOID_AGENT_CYCLE_THROTTLE')], read('REPLOID_CYCLE_INTERVAL_SECONDS')),
          functionGemma: state.functionGemma || config.functionGemma || read('REPLOID_FUNCTIONGEMMA_CONFIG') || null
        }
      } } });
    },
    getRuntimeMode: () => typeof globalThis.window?.getReploidMode === 'function'
      ? globalThis.window.getReploidMode() : getCurrentReploidStorage().getItem('REPLOID_MODE') || 'reploid'
  });
    return {
      ...loop,
      run(goal) {
        if (runPending) return Promise.reject(new Error('Agent already running or recording is settling'));
        if (!loop.isRunning() && !loop.hasPendingProviderResume?.()) {
          nextCallId = 0;
          trace.reset({ build: globalThis.window?.REPLOID_BUILD_VERSION || null,
            sourceRevision: globalThis.window?.REPLOID_SOURCE_REVISION || null,
            models: selectedModels.map(model => ({ id: model.id || null, provider: model.provider || null,
              revision: model.revision || null })) });
        }
        runPending = true;
        try { return Promise.resolve(loop.run(goal)).finally(async () => { await trace.flush(); runPending = false; }); }
        catch (error) { runPending = false; throw error; }
      },
      async close() { await loop.close(); await trace.close(); },
      getRecordingStatus: trace.getPersistenceStatus,
      flushRecording: trace.flush,
      setModel(model) {
        loop.setModel(model);
        selectedModels = model ? [structuredClone(model)] : [];
      },
      setModels(models) {
        loop.setModels(models);
        selectedModels = structuredClone(models || []);
      },
      async exportReplayBundle(options = {}) {
        await trace.flush();
        const state = deps.StateManager?.getState?.() || {};
        const context = loop.getContext();
        const goal = options.goal || state.currentGoal?.text
          || context.find(message => message?.role === 'user'
            && String(message.content || '').startsWith('Begin. Goal:'))?.content?.replace(/^Begin\. Goal:\s*/i, '') || '';
        const storage = getCurrentReploidStorage();
        return buildRunReplayBundle({
          route: options.route || globalThis.window?.location?.pathname,
          mode: options.mode || globalThis.window?.getReploidMode?.() || 'zero',
          goal, modelConfigs: selectedModels, state,
          trace: trace.snapshot(),
          importedReplay: readImportedRunReplaySummary(storage)
        });
      }
    };
  }
};
