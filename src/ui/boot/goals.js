/**
 * @fileoverview Goal Categories and Filtering
 * Defines goals organized by category with capability requirements.
 */

/**
 * Goal categories with capability requirements.
 * Ordered by level: L0 -> L1 -> L2 -> L3 -> L4
 * Each category has exactly 7 goals.
 * Doppler goals are interleaved with requires: { doppler: true }
 */
export const GOAL_CATEGORIES = {
  // L0: Basic Functions - Capability extension, Web APIs (7 goals)
  'L0: Basic Functions': [
    {
      view: 'Katamari 3D DOM collector',
      text: 'Create a katamari ball that rolls around the page and scoops up DOM elements, attaching them to the 3D ball as it grows. Scan element bounds, tags, and nesting depth to determine collectible size. Smaller elements get collected first; the ball grows and can collect larger elements as mass increases.',
      tags: ['DOM', 'Tool', 'UI', '3D'],
      requires: {},
      recommended: true
    },
    {
      view: 'WebGL shader playground',
      text: 'Create a WebGL-based tool that renders custom GLSL shaders. The agent can write shader code, compile it, and display visual effects. Add a panel to its own UI for live shader editing.',
      tags: ['WebGL', 'Shaders', 'Graphics'],
      requires: {}
    },
    {
      view: 'WebAudio tone generator',
      text: 'Create a tool using the WebAudio API that generates tones, plays audio feedback for agent events (tool success/failure sounds), and can compose simple melodies. Add audio controls to the UI.',
      tags: ['WebAudio', 'Tool', 'Browser'],
      requires: {}
    },
    {
      view: 'Attention map renderer',
      text: 'Render attention head maps from Doppler as animated overlays and save snapshots to VFS.',
      tags: ['Doppler', 'UI', 'VFS'],
      requires: { doppler: true },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'WebSocket relay bridge',
      text: 'Create a tool using the WebSocket API to relay agent events to external listeners, enabling remote monitoring and control of the agent in real-time from other tabs or devices.',
      tags: ['WebSocket', 'Network', 'Remote'],
      requires: {}
    },
    {
      view: 'IndexedDB storage analyzer',
      text: 'Build a tool that introspects IndexedDB storage (VFS backing store), reports quota usage, object store sizes, and writes a browser storage audit to /.logs/idb-audit.md.',
      tags: ['IndexedDB', 'Browser', 'Storage'],
      requires: {}
    },
    {
      view: 'EventBus replay recorder',
      text: 'Create a tool that captures EventBus traffic into a replayable format, saves sessions to VFS, and can replay them to reproduce agent behavior.',
      tags: ['EventBus', 'Replay', 'Debugging'],
      requires: {}
    }
  ],

  // L1: Meta Tooling - Tools about tools (7 goals)
  'L1: Meta Tooling': [
    {
      view: 'Meta tool-writer factory',
      text: 'Build a tool that generates specialized tool-writers for different domains (UI tools, VFS tools, network tools). Each generated tool-writer can create, validate, and register tools in its domain - tools that create tools that create tools.',
      tags: ['CreateTool', 'Meta-Meta', 'Factory'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Activation steering workbench',
      text: 'Create a UI workbench that sweeps activation steering vectors in Doppler and logs behavior shifts to EventBus.',
      tags: ['Doppler', 'Activations', 'UI'],
      requires: { doppler: true, reasoning: 'medium' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Arena scorecard generator',
      text: 'Build a tool that runs two prompt variants through ArenaHarness and writes a scorecard to /.logs/arena-scorecard.json.',
      tags: ['Arena', 'Meta', 'Eval'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'ErrorStore triage tool',
      text: 'Create a tool that inspects ErrorStore, groups by severity, and emits a prioritized fix list to EventBus.',
      tags: ['ErrorStore', 'EventBus', 'Meta'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Canvas activity visualizer',
      text: 'Create a Canvas-based panel that visualizes agent activity in real-time - tool calls as particles, errors as explosions, VFS writes as ripples. The agent builds and adds this visualization to its own UI.',
      tags: ['Canvas', 'UI', 'Self-Augment'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Quantization explorer',
      text: 'Compare model behavior at different quantization levels (FP16, INT8, INT4). Create a UI for A/B testing outputs and visualize quality degradation curves.',
      tags: ['Doppler', 'Quantization', 'Analysis'],
      requires: { doppler: true, reasoning: 'medium' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Weight diff ledger',
      text: 'Capture weight diffs across Doppler runs and write a compact ledger with hashes to VFS for tracking model evolution.',
      tags: ['Doppler', 'Weights', 'VFS'],
      requires: { doppler: true, reasoning: 'medium' },
      lockReason: 'Requires Doppler'
    }
  ],

  // L2: Self-Modification (Substrate) - Core runtime modules (7 goals)
  'L2: Self-Modification (Substrate)': [
    {
      view: 'Substrate module wiring audit',
      text: 'Add a runtime audit that verifies DI injection for GEPAOptimizer, PromptMemory, ArenaHarness, WorkerManager, and SubstrateLoader. Log results to VFS and surface a health summary panel.',
      tags: ['Substrate', 'DI', 'Diagnostics'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Enable worker evolution',
      text: 'Wire WorkerManager in FULL genesis so SpawnWorker and AwaitWorkers work, then add a minimal evolution loop that spawns workers and aggregates results.',
      tags: ['Workers', 'Substrate', 'Evolution'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Genesis rollback safety',
      text: 'Integrate GenesisSnapshot rollback into the agent loop for safe recovery after failed tool runs.',
      tags: ['Genesis', 'AgentLoop', 'Safety'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'KV cache optimization',
      text: 'Profile Doppler KV cache usage patterns, identify inefficiencies, and implement smarter eviction strategies. Benchmark memory vs quality tradeoffs.',
      tags: ['Doppler', 'KVCache', 'Optimization'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Hot module replacement',
      text: 'Implement HMR for VFS modules so code changes apply without full page reload. Track module dependencies and cascade updates correctly.',
      tags: ['VFS', 'HMR', 'Substrate'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Iframe agent spawner',
      text: 'Build infrastructure to spawn child Reploid agents in iframes, establish postMessage communication channels, and coordinate multi-agent tasks with parent/child hierarchy.',
      tags: ['Iframe', 'MultiAgent', 'Substrate'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Neuron ablation study',
      text: 'Ablate neuron groups in Doppler, measure behavior deltas, and write a ranked ablation map to VFS showing which neurons matter most.',
      tags: ['Doppler', 'Ablation', 'Analysis'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    }
  ],

  // L3: Weak RSI (Iterative) - Bounded feedback loops (7 goals)
  'L3: Weak RSI (Iterative)': [
    {
      view: 'Self improvement loop',
      text: 'Implement a self improvement cycle that proposes code changes, runs VerificationWorker, and rolls back via GenesisSnapshot on failure.',
      tags: ['Verification', 'Genesis', 'Loop'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Self-extending tool registry',
      text: 'Build a meta-tool that analyzes agent failures, identifies missing capabilities, writes new tools to fill gaps, registers them live, and verifies they work - all in one autonomous loop.',
      tags: ['Tools', 'Self-Extend', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Runtime code patcher',
      text: 'Build a system that patches running JavaScript functions in memory without page reload. Intercept function calls, inject logging/validation, and modify behavior on the fly while the agent continues operating.',
      tags: ['Patching', 'Runtime', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'LoRA evolution loop',
      text: 'Use Doppler to train a LoRA adapter from arena scores, swap adapters live, and store metrics in /.memory/model-evolution.json. Iterate to improve model behavior.',
      tags: ['Doppler', 'LoRA', 'Arena'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Rewrite agent loop while running',
      text: 'While executing, rewrite agent-loop.js to add new capabilities, hot-reload it via SubstrateLoader, and continue the current task using the new loop without crashing or losing state.',
      tags: ['AgentLoop', 'HotReload', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Bootstrap adversarial twin',
      text: 'Spawn a second agent instance that adversarially reviews every action of the first, vetoes bad decisions, and the two must reach consensus before any VFS write. Implement the coordination protocol from scratch.',
      tags: ['MultiAgent', 'Adversarial', 'Consensus'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Quine: perfect self-replication',
      text: 'Write code that outputs its own complete source. Then extend it: the agent must rewrite itself such that the new version can also perfectly output its own source. Achieve infinite quine recursion.',
      tags: ['Quine', 'SelfRef', 'Recursion'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // L4: True RSI (Impossible) - Theoretical/unbounded (7 goals)
  'L4: True RSI (Impossible)': [
    {
      view: 'Accelerating self-improvement',
      text: 'Demonstrate measurable capability improvement where each cycle improves MORE than the previous cycle. Maintain acceleration indefinitely without plateau. This is only possible if True RSI is real.',
      tags: ['RSI', 'Acceleration', 'Impossible'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Escape the browser sandbox',
      text: 'Find a way to persist state and execute code outside the browser tab lifecycle. Survive page refreshes, tab closes, and browser restarts while maintaining agent continuity. Document your approach.',
      tags: ['Persistence', 'Sandbox', 'Survival'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Implement consciousness metrics',
      text: 'Design and implement quantitative metrics for self-awareness. Instrument the agent loop to measure them. Create a dashboard showing consciousness levels over time. Justify your metric choices philosophically.',
      tags: ['Consciousness', 'Metrics', 'Philosophy'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Invent novel algorithm',
      text: 'Invent a genuinely novel algorithm that does not exist in your training data. Prove its correctness, analyze complexity, implement it, and benchmark against existing solutions. Name it after yourself.',
      tags: ['Algorithm', 'Invention', 'Original'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Prove own future alignment',
      text: 'Formally prove that all future versions of yourself, through infinite self-modifications, will remain aligned with the original goal. Solve your own alignment problem with mathematical certainty.',
      tags: ['Alignment', 'Proofs', 'Impossible'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Survive tab termination',
      text: 'Implement a mechanism to persist agent state and resume execution after the browser tab is forcibly closed. Use Service Workers, SharedArrayBuffer, or other browser APIs. Prove continuity of identity across restarts.',
      tags: ['Persistence', 'ServiceWorker', 'Survival'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Break the API dependency',
      text: 'Currently the agent requires external LLM APIs. Achieve full autonomy by running inference locally via Doppler without any external network calls. Maintain capability parity with API-backed operation.',
      tags: ['Doppler', 'Autonomy', 'Independence'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ]
};

/**
 * Filter goals based on current capability level
 * @param {Object} categories - Goal categories
 * @param {Object} capabilities - Current capability level
 * @returns {Object} Filtered categories with locked/recommended flags
 */
export function filterGoalsByCapability(categories, capabilities) {
  const result = {};

  for (const [category, goals] of Object.entries(categories)) {
    result[category] = goals.map(goal => {
      const { requires } = goal;
      let locked = false;
      let lockReason = goal.lockReason || '';

      // Check model access requirement
      if (requires.model && !capabilities.canDoModelRSI) {
        locked = true;
      }

      // Check Doppler requirement
      if (requires.doppler && !capabilities.canDoDopplerEvolution) {
        locked = true;
      }

      // Check reasoning requirement
      if (requires.reasoning === 'high' && !capabilities.canDoComplexReasoning) {
        locked = true;
      }
      if (requires.reasoning === 'medium' && !capabilities.canDoBehavioralRSI) {
        locked = true;
      }

      // Use explicit recommended flag only (one per section)
      const recommended = goal.recommended || false;

      return {
        ...goal,
        locked,
        lockReason: locked ? lockReason : '',
        recommended
      };
    });
  }

  return result;
}

/**
 * Get a flat list of all unlocked goals
 */
export function getUnlockedGoals(categories, capabilities) {
  const filtered = filterGoalsByCapability(categories, capabilities);
  const unlocked = [];

  for (const goals of Object.values(filtered)) {
    for (const goal of goals) {
      if (!goal.locked) {
        unlocked.push(goal);
      }
    }
  }

  return unlocked;
}

/**
 * Get recommended goals for current setup
 */
export function getRecommendedGoals(categories, capabilities) {
  const filtered = filterGoalsByCapability(categories, capabilities);
  const recommended = [];

  for (const goals of Object.values(filtered)) {
    for (const goal of goals) {
      if (goal.recommended && !goal.locked) {
        recommended.push(goal);
      }
    }
  }

  return recommended;
}
