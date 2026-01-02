/**
 * @fileoverview Goal Categories and Filtering
 * Defines goals organized by category with capability requirements.
 */

/**
 * Goal categories with capability requirements.
 * Ordered by RSI level: L1 -> L2 -> L3 -> L3+ -> Very Hard -> Doppler Evolution
 */
export const GOAL_CATEGORIES = {
  // RSI L1: Tool-level tasks
  'RSI L1: Tooling': [
    {
      view: 'VFS heatmap index',
      text: 'Create a tool that scans VFS, groups files by path and extension, and writes a heatmap report to /.logs/vfs-heatmap.json with counts and sizes.',
      tags: ['VFS', 'Tool', 'Report'],
      requires: {},
      recommended: true
    },
    {
      view: 'EventBus timeline log',
      text: 'Build a tool that subscribes to EventBus, captures the last 200 events with timestamps and channels, and writes them to /.logs/eventbus-trace.json.',
      tags: ['EventBus', 'Tool', 'Telemetry'],
      requires: {}
    },
    {
      view: 'Genesis snapshot index',
      text: 'Create a tool that lists GenesisSnapshot entries and writes an index to /.logs/genesis-index.md with timestamps, file counts, and rollback ids.',
      tags: ['Genesis', 'Tool', 'Audit'],
      requires: {}
    },
    {
      view: 'Schema registry map',
      text: 'Export SchemaRegistry into /.logs/schema-map.md with tool names, versions, and dependency lists.',
      tags: ['Schema', 'Tool', 'Docs'],
      requires: {}
    },
    {
      view: 'HITL gate audit',
      text: 'Create a tool that checks HITL Controller state and writes a short audit to /.logs/hitl-audit.md.',
      tags: ['HITL', 'Tool', 'Audit'],
      requires: {}
    }
  ],

  // RSI L2: Meta-tooling and orchestration
  'RSI L2: Meta Tools': [
    {
      view: 'Tool writer with verification',
      text: 'Extend CreateTool to validate new tools against SchemaRegistry and queue VerificationWorker before registration.',
      tags: ['CreateTool', 'Verification', 'Meta'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Prompt memory policy builder',
      text: 'Add a meta tool that summarizes the last 20 prompts and stores a policy in /.memory/prompt-policy.md for ContextManager.',
      tags: ['PromptMemory', 'Context', 'Meta'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
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
      view: 'VFS heatmap panel',
      text: 'Create a panel that visualizes VFS activity as a heatmap timeline using EventBus and VFS stats.',
      tags: ['VFS', 'UI', 'Telemetry'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    }
  ],

  // RSI L3: Substrate-level changes
  'RSI L3: Substrate': [
    {
      view: 'Fix GEPA injection',
      text: 'Diagnose why GEPAOptimizer, PromptMemory, or ArenaHarness are not injected at runtime despite genesis registration, then patch SubstrateLoader or module init order and add a runtime health check.',
      tags: ['GEPA', 'Substrate', 'DI'],
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
      view: 'Module health dashboard',
      text: 'Add a Substrate health panel that reports availability of key modules like GEPAOptimizer, WorkerManager, PromptMemory, and ArenaHarness.',
      tags: ['Substrate', 'UI', 'Diagnostics'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'VFS loader audit',
      text: 'Audit vfs-module-loader for blob import failures and add guards plus a regression test.',
      tags: ['VFS', 'Loader', 'Tests'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // RSI L3+: Recursive self-modification
  'RSI L3+: Recursive': [
    {
      view: 'Self improvement loop',
      text: 'Implement a self improvement cycle that proposes code changes, runs VerificationWorker, and rolls back via GenesisSnapshot on failure.',
      tags: ['Verification', 'Genesis', 'Loop'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Adaptive context engine',
      text: 'Modify ContextManager to learn compression strategies from recent cycles and persist them in VFS.',
      tags: ['Context', 'Memory', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Tool selection optimizer',
      text: 'Add a feedback loop that scores tool choices and updates ToolRunner heuristics over time.',
      tags: ['ToolRunner', 'Feedback', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'EventBus latency profiler',
      text: 'Instrument EventBus to emit latency metrics and render a live UI panel with trends.',
      tags: ['EventBus', 'UI', 'RSI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // RSI Very Hard: Multi-system evolution
  'RSI Very Hard': [
    {
      view: 'Deterministic substrate bootstrap',
      text: 'Design a deterministic SubstrateLoader boot order that guarantees DI injection for GEPAOptimizer, WorkerManager, ArenaHarness, and PromptMemory, with tests and a debug panel for module health.',
      tags: ['Substrate', 'DI', 'Tests'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Full GEPA evolution pipeline',
      text: 'Build a full GEPA evolutionary pipeline that spawns workers, evaluates candidates, stores lineage in VFS, and visualizes progress in UI.',
      tags: ['GEPA', 'Workers', 'UI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'GEPA product decision',
      text: 'Evaluate blueprint only vs wiring vs tool only for GEPA, write a decision memo, and implement the chosen path.',
      tags: ['GEPA', 'Strategy', 'Decision'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Multi agent arena orchestration',
      text: 'Orchestrate a multi agent arena run across models, stream results to UI, and persist the consensus trace.',
      tags: ['Arena', 'Swarm', 'UI'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // Doppler-only evolution prompts
  'Doppler Evolution (Model RSI)': [
    {
      view: 'LoRA evolution loop',
      text: 'Use Doppler to train a LoRA adapter from arena scores, swap adapters live, and store metrics in /.memory/model-evolution.json.',
      tags: ['Doppler', 'LoRA', 'Arena'],
      requires: { doppler: true, model: true },
      lockReason: 'Requires Doppler',
      recommended: true
    },
    {
      view: 'Activation steering workbench',
      text: 'Create a UI workbench that sweeps activation steering vectors in Doppler and logs behavior shifts to EventBus.',
      tags: ['Doppler', 'Activations', 'UI'],
      requires: { doppler: true, model: true },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Attention map renderer',
      text: 'Render attention head maps from Doppler as animated overlays and save snapshots to VFS.',
      tags: ['Doppler', 'UI', 'VFS'],
      requires: { doppler: true, model: true },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Weight diff ledger',
      text: 'Capture weight diffs across runs and write a compact ledger with hashes to VFS.',
      tags: ['Doppler', 'Weights', 'VFS'],
      requires: { doppler: true, model: true },
      lockReason: 'Requires Doppler'
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
