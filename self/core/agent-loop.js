import AgentLoop from '../vendor/reploid/agent/legacy-loop.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import { getCurrentReploidStorage } from '../instance.js';
import * as Policies from './agent-loop-policies.js';
import { buildAgentInitialContext } from './agent-context.js';
import { requireSurfaceIntent, authorizeSurfaceOperation } from '../config/surface-intents.js';
import profile from '../config/reploid-library.json' with { type: 'json' };
import { buildRunReplayBundle, collectReplayVfsFiles, readImportedRunReplaySummary } from './run-replay-bundle.js';

export default {
  ...AgentLoop,
  factory: deps => {
    let attemptSurface = requireSurfaceIntent('zero');
    let selectedModels = [];
    const loop = AgentLoop.factory({
    ...deps, config: resolveConfig({ profile: profile.profile }),
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
      setModel(model) {
        loop.setModel(model);
        selectedModels = model ? [structuredClone(model)] : [];
      },
      setModels(models) {
        loop.setModels(models);
        selectedModels = structuredClone(models || []);
      },
      async exportReplayBundle(options = {}) {
        const state = deps.StateManager?.getState?.() || {};
        const context = loop.getContext();
        const goal = options.goal || state.currentGoal?.text
          || context.find(message => message?.role === 'user'
            && String(message.content || '').startsWith('Begin. Goal:'))?.content?.replace(/^Begin\. Goal:\s*/i, '') || '';
        const storage = getCurrentReploidStorage();
        return buildRunReplayBundle({
          route: options.route || globalThis.window?.location?.pathname,
          mode: options.mode || globalThis.window?.getReploidMode?.() || 'zero',
          goal, modelConfigs: selectedModels, systemPrompt: loop.getSystemPrompt(), context,
          messageQueue: loop.getMessageQueue(), activities: loop.getRecentActivities(), state,
          vfsFiles: await collectReplayVfsFiles(deps.VFS, options.vfs || {}),
          importedReplay: readImportedRunReplaySummary(storage)
        });
      }
    };
  }
};
