import { AgentLoop } from '../vendor/reploid/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import { getCurrentReploidStorage } from '../instance.js';
import * as Policies from './agent-loop-policies.js';
import { buildAgentInitialContext } from './agent-context.js';
import profile from '../config/reploid-library.json' with { type: 'json' };

export default {
  ...AgentLoop,
  factory: deps => AgentLoop.factory({
    ...deps, config: resolveConfig({ profile: profile.profile }),
    Storage: getCurrentReploidStorage(), Policies, buildInitialContext: buildAgentInitialContext,
    getRuntimeMode: () => typeof globalThis.window?.getReploidMode === 'function'
      ? globalThis.window.getReploidMode() : getCurrentReploidStorage().getItem('REPLOID_MODE') || 'reploid'
  })
};
