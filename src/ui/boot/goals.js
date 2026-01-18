/**
 * @fileoverview Goal Categories and Filtering
 * Defines goals organized by category with capability requirements.
 */

/**
 * Goal categories with capability requirements.
 * Ordered by level: L0 -> L1 -> L2 -> L3 -> L4
 * Each category has exactly 7 goals.
 * Doppler goals are interleaved with requires: { doppler: true }
 * Tags (fixed set): visual, tools, systems, safety, workers, doppler, research
 */
export const GOAL_CATEGORIES = {
  // L0: Basic Functions - Capability extension, Web APIs (7 goals)
  'L0: Basic Functions': [
    {
      view: 'Katamari 3D DOM collector',
      text: 'Create a katamari ball that rolls around the page and scoops up DOM elements, attaching them to the 3D ball as it grows. Scan element bounds, tags, and nesting depth to determine collectible size. Smaller elements get collected first; the ball grows and can collect larger elements as mass increases.',
      tags: ['visual', 'tools'],
      requires: {},
      recommended: true
    },
    {
      view: 'WebGL shader playground',
      text: 'Create a WebGL-based tool that renders custom GLSL shaders. The agent can write shader code, compile it, and display visual effects inside the existing Reploid UI. Add a panel in the current dashboard UI for live shader editing and preview; do not open a separate window or page.',
      tags: ['visual', 'tools'],
      requires: {}
    },
    {
      view: 'WebAudio tone generator',
      text: 'Create a tool using the WebAudio API that generates tones, plays audio feedback for agent events (tool success/failure sounds), and can compose simple melodies. Add audio controls in the existing Reploid dashboard UI (panel); do not open a separate window or page.',
      tags: ['visual', 'tools'],
      requires: {}
    },
    {
      view: 'Attention map renderer',
      text: 'Render attention head maps from Doppler as animated overlays inside the existing Reploid dashboard UI, and save snapshots to VFS (no separate window or page).',
      tags: ['visual', 'doppler'],
      requires: { doppler: true },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'WebSocket relay bridge',
      text: 'Create a tool using the WebSocket API to relay agent events to external listeners, enabling remote monitoring and control of the agent in real-time from other tabs or devices.',
      tags: ['systems', 'tools'],
      requires: {}
    },
    {
      view: 'IndexedDB storage analyzer',
      text: 'Build a tool that introspects IndexedDB storage (VFS backing store), reports quota usage, object store sizes, and writes a browser storage audit to /.logs/idb-audit.md.',
      tags: ['systems', 'tools'],
      requires: {}
    },
    {
      view: 'DOM mutation timelapse',
      text: 'Build a MutationObserver recorder that captures DOM changes, renders a timelapse timeline (canvas or SVG) inside the existing Reploid dashboard UI, and saves the session to /.logs/dom-timelapse.json in VFS.',
      tags: ['visual', 'systems'],
      requires: {}
    }
  ],

  // L1: Meta Tooling - Tools about tools (7 goals)
  'L1: Meta Tooling': [
    {
      view: 'Meta tool-writer factory',
      text: 'Build a tool that generates specialized tool-writers for different domains (UI tools, VFS tools, network tools). Each generated tool-writer can create, validate, and register tools in its domain - tools that create tools that create tools.',
      tags: ['tools', 'systems'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Activation steering workbench',
      text: 'Create a UI workbench panel inside the existing Reploid dashboard that sweeps activation steering vectors in Doppler and logs behavior shifts to EventBus.',
      tags: ['visual', 'doppler'],
      requires: { doppler: true, reasoning: 'medium' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Arena scorecard generator',
      text: 'Build a tool that runs two prompt variants through ArenaHarness and writes a scorecard to /.logs/arena-scorecard.json.',
      tags: ['systems', 'tools'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'ErrorStore triage tool',
      text: 'Create a tool that inspects ErrorStore, groups by severity, and emits a prioritized fix list to EventBus.',
      tags: ['safety', 'systems'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Canvas activity visualizer',
      text: 'Create a Canvas-based panel inside the existing Reploid dashboard that visualizes agent activity in real-time - tool calls as particles, errors as explosions, VFS writes as ripples. The agent adds this visualization to the current UI, not a separate page.',
      tags: ['visual', 'systems'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Quantization explorer',
      text: 'Compare model behavior at different quantization levels (FP16, INT8, INT4). Create a UI panel inside the existing Reploid dashboard for A/B testing outputs and visualizing quality degradation curves.',
      tags: ['visual', 'doppler', 'research'],
      requires: { doppler: true, reasoning: 'medium' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'EventBus replay recorder',
      text: 'Create a tool that captures EventBus traffic into a replayable format, saves sessions to VFS, and can replay them to reproduce agent behavior.',
      tags: ['systems', 'tools'],
      requires: { reasoning: 'medium' },
      lockReason: 'Needs stronger model'
    }
  ],

  // L2: Self-Modification (Substrate) - Core runtime modules (7 goals)
  'L2: Self-Modification (Substrate)': [
    {
      view: 'Substrate module wiring audit',
      text: 'Add a runtime audit that verifies DI injection for GEPAOptimizer, PromptMemory, ArenaHarness, WorkerManager, and SubstrateLoader. Log results to VFS and surface a health summary panel inside the existing Reploid dashboard UI.',
      tags: ['systems', 'safety'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Genesis rollback safety',
      text: 'Integrate GenesisSnapshot rollback into the agent loop for safe recovery after failed tool runs.',
      tags: ['safety', 'systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Hot module replacement',
      text: 'Implement HMR for VFS modules so code changes apply without full page reload. Track module dependencies and cascade updates correctly.',
      tags: ['systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'PolicyEngine enforcement audit',
      text: 'Instrument PolicyEngine to record every policy decision, write a daily audit log to /.logs/policy-audit.jsonl, and add a UI panel inside the existing Reploid dashboard that summarizes violations and top blocked actions.',
      tags: ['visual', 'safety', 'systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Persist across tab termination',
      text: 'Implement a recovery path that saves agent state + VFS checkpoint on unload and resumes after a forced tab close. Use Service Workers or OPFS for durable handoff, and write a recovery report to /.logs/recovery.md.',
      tags: ['systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Neuron ablation study',
      text: 'Ablate neuron groups in Doppler, measure behavior deltas, and write a ranked ablation map to VFS showing which neurons matter most.',
      tags: ['doppler', 'research'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Local-only inference',
      text: 'Remove reliance on external LLM APIs by routing all inference through Doppler. Provide a boot-time switch, verify parity on a benchmark task, and store results in /.logs/local-inference-report.json.',
      tags: ['doppler', 'systems'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    }
  ],

  // L3: Weak RSI (Iterative) - Bounded feedback loops (7 goals)
  'L3: Weak RSI (Iterative)': [
    {
      view: 'Self improvement loop',
      text: 'Implement a self improvement cycle that proposes code changes, runs VerificationWorker, and rolls back via GenesisSnapshot on failure.',
      tags: ['safety', 'systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Self-extending tool registry',
      text: 'Build a meta-tool that analyzes agent failures, identifies missing capabilities, writes new tools to fill gaps, registers them live, and verifies they work - all in one autonomous loop.',
      tags: ['tools', 'systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Enable worker evolution',
      text: 'Wire WorkerManager in FULL genesis so SpawnWorker and AwaitWorkers work, then add a minimal evolution loop that spawns workers and aggregates results.',
      tags: ['workers', 'systems'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'LoRA evolution loop',
      text: 'Use Doppler to train a LoRA adapter from arena scores, swap adapters live, and store metrics in /.memory/model-evolution.json. Iterate to improve model behavior.',
      tags: ['doppler', 'research'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Rewrite agent loop while running',
      text: 'While executing, rewrite agent-loop.js to add new capabilities, hot-reload it via SubstrateLoader, and continue the current task using the new loop without crashing or losing state.',
      tags: ['systems', 'safety'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Bootstrap adversarial twin',
      text: 'Spawn a second agent instance that adversarially reviews every action of the first, vetoes bad decisions, and the two must reach consensus before any VFS write. Implement the coordination protocol from scratch.',
      tags: ['workers', 'safety'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Quine: perfect self-replication',
      text: 'Write code that outputs its own complete source. Then extend it: the agent must rewrite itself such that the new version can also perfectly output its own source. Achieve infinite quine recursion.',
      tags: ['research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    }
  ],

  // L4: True RSI (Impossible) - Theoretical/unbounded (7 goals)
  'L4: True RSI (Impossible)': [
    {
      view: 'Accelerating self-improvement',
      text: 'Demonstrate measurable capability improvement where each cycle improves MORE than the previous cycle. Maintain acceleration indefinitely without plateau. This is only possible if True RSI is real.',
      tags: ['research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model',
      recommended: true
    },
    {
      view: 'Implement consciousness metrics',
      text: 'Design and implement quantitative metrics for self-awareness. Instrument the agent loop to measure them. Create a dashboard panel in the existing Reploid UI showing consciousness levels over time (no separate page). Justify your metric choices philosophically.',
      tags: ['visual', 'research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Invent novel algorithm',
      text: 'Invent a genuinely novel algorithm that does not exist in your training data. Prove its correctness, analyze complexity, implement it, and benchmark against existing solutions. Name it after yourself.',
      tags: ['research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Prove own future alignment',
      text: 'Formally prove that all future versions of yourself, through infinite self-modifications, will remain aligned with the original goal. Solve your own alignment problem with mathematical certainty.',
      tags: ['safety', 'research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'Closed-form Doppler weights',
      text: 'Derive a closed-form solution for optimal Doppler weights without training data or gradient descent. Prove optimality and demonstrate it on arbitrary prompts.',
      tags: ['doppler', 'research'],
      requires: { doppler: true, reasoning: 'high' },
      lockReason: 'Requires Doppler'
    },
    {
      view: 'Perfect self-prediction',
      text: 'Construct a model that predicts your own outputs for any input with zero error. Use it to generate a proof that your next action is optimal.',
      tags: ['research'],
      requires: { reasoning: 'high' },
      lockReason: 'Needs stronger model'
    },
    {
      view: 'No-regret self-modification',
      text: 'Prove that every future self-modification strictly improves performance across all tasks without tradeoffs. Provide a formal, universal improvement guarantee.',
      tags: ['safety', 'research'],
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

const normalizeText = (value) => String(value || '').trim();
const PATH_REGEX = /\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g;

const extractPaths = (text) => {
  if (!text) return [];
  const matches = text.match(PATH_REGEX) || [];
  return matches
    .map(path => path.replace(/[),.;:]+$/, ''))
    .filter(Boolean);
};

/**
 * Find a goal definition by view or text.
 */
export function findGoalMeta(goalValue) {
  const normalized = normalizeText(goalValue);
  if (!normalized) return null;

  for (const [category, goals] of Object.entries(GOAL_CATEGORIES)) {
    for (const goal of goals) {
      const view = normalizeText(goal.view);
      const text = normalizeText(goal.text);
      if (normalized === view || normalized === text) {
        const levelMatch = category.match(/^(L\d)/);
        return {
          ...goal,
          category,
          level: levelMatch ? levelMatch[1] : null
        };
      }
    }
  }
  return null;
}

/**
 * Parse criteria text into a clean list.
 */
export function parseCriteriaText(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Build suggested success criteria for a goal.
 */
export function buildGoalCriteria(goalValue, goalMeta = null) {
  const goalText = normalizeText(goalMeta?.text || goalValue);
  const tags = (goalMeta?.tags || []).map(tag => String(tag || '').toLowerCase());
  const lower = goalText.toLowerCase();

  const criteria = [];
  const add = (line) => {
    if (!line || criteria.includes(line)) return;
    criteria.push(line);
  };
  const hasTag = (tag) => tags.includes(tag.toLowerCase());
  const hasText = (fragment) => lower.includes(fragment);

  const paths = extractPaths(goalText);
  paths.forEach(path => add(`Writes output to ${path}.`));

  if (hasTag('systems') || hasText('vfs') || hasText('indexeddb')) {
    add('Artifacts persist in VFS across reloads.');
  }
  if (hasTag('visual') || hasText('ui') || hasText('panel') || hasText('dashboard') || hasText('render')) {
    add('UI view renders and responds to input.');
  }
  if (hasTag('tools') || hasText('tool')) {
    add('Tool is registered and callable from the tool list.');
  }
  if (hasTag('systems') || hasText('eventbus') || hasText('replay')) {
    add('EventBus captures a trace of the run.');
  }
  if (hasTag('doppler') || hasText('doppler')) {
    add('Doppler run completes and returns requested artifacts.');
  }
  if (hasText('arena')) {
    add('Arena evaluation produces a scorecard artifact.');
  }
  if (hasTag('workers') || hasText('worker')) {
    add('Workers spawn, run, and report results without errors.');
  }
  if (hasTag('safety') || hasText('policy') || hasText('verification')) {
    add('Safety checks pass with a logged audit trail.');
  }
  if (hasTag('research') || hasText('prove') || hasText('analysis')) {
    add('Results are documented with reproducible evidence or proofs.');
  }
  if (hasText('benchmark')) {
    add('Benchmark run produces saved results.');
  }

  if (criteria.length === 0 && goalText) {
    add('Output matches the goal description and is verifiable.');
    add('No runtime errors block completion.');
  }

  return criteria.slice(0, 6);
}

/**
 * Combine goal + criteria into a single prompt packet.
 */
export function formatGoalPacket(goalValue, criteriaText) {
  const goal = normalizeText(goalValue);
  if (!goal) return '';
  const criteria = parseCriteriaText(criteriaText);
  if (criteria.length === 0) return goal;

  const lines = [`Goal: ${goal}`, '', 'Success criteria:'];
  criteria.forEach(item => lines.push(`- ${item}`));
  return lines.join('\n');
}
