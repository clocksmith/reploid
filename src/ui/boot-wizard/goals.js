/**
 * @fileoverview Goal presets for the boot wizard.
 */

const TAGS = {
  UI: 'UI',
  VISUAL: 'Visualization',
  ORCH: 'Orchestration',
  BENCH: 'Benchmark',
  GOV: 'Governance',
  DATA: 'Data',
  SYS: 'Systems'
};

export const DEFAULT_REPLOID_HOME_GOAL = 'Build a live self-improvement control room for this runtime: map the architecture, VFS activity, tool telemetry, and recent experiments in a visually striking dashboard; identify one concrete bottleneck; ship one bounded upgrade; benchmark before and after; and keep only the measured win.';

const GOAL_CATEGORIES = {
  'L0: Basic Functions': [
    {
      view: 'System atlas',
      text: 'Build a renderable JSON architecture model of the current system, then turn it into a live graph view with inspectable components, links, and status.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'VFS control room',
      text: 'Create a dashboard that tracks VFS reads, writes, hot paths, artifact growth, and recent diffs with compact charts, counters, and drill-down panels.',
      tags: [TAGS.DATA, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'Loop replay',
      text: 'Capture cycle events and render a replay timeline that lets the user scrub through prompts, tool calls, outputs, and state changes.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.DATA]
    },
    {
      view: 'Artifact studio',
      text: 'Create an artifact studio that captures screenshots, canvases, logs, and structured outputs into a gallery with labels, filters, and preview panes.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.DATA]
    },
    {
      view: 'Katamari DOM',
      text: 'Build a visually impressive Katamari-style 3D DOM picker with real physics so page elements become collectible objects on a growing ball, then let the user orbit, inspect, and export robust selectors from the captured elements.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    }
  ],
  'L1: Meta Tooling': [
    {
      view: 'Tool observatory',
      text: 'Instrument every tool invocation, then build a dashboard of reliability, latency, retry rate, and failure causes with per-tool scorecards.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Tool forge',
      text: 'Build a tool forge that turns a structured request into a new tool, schema, smoke test, and usage note, then scores the result.',
      tags: [TAGS.SYS, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Preset arena',
      text: 'Implement a preset arena that runs multiple goals side by side, records outcomes, and renders a ranked comparison board.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.ORCH]
    },
    {
      view: 'Persona lab',
      text: 'Create a persona lab that benchmarks named personas on the same tasks and shows side-by-side outputs, diffs, and impact scores.',
      tags: [TAGS.UI, TAGS.ORCH, TAGS.DATA]
    },
    {
      view: 'Prompt mirror',
      text: 'Reconstruct the exact active substrate contract, bootstrap context, and current loop state into a readable artifact, then prove the mirror matches the live runtime.',
      tags: [TAGS.UI, TAGS.DATA, TAGS.SYS]
    }
  ],
  'L2: Substrate': [
    {
      view: 'Runtime blueprint',
      text: 'Represent the runtime, modules, and dependencies as editable JSON, render it as architecture, and apply bounded substrate changes from that model.',
      tags: [TAGS.VISUAL, TAGS.ORCH, TAGS.SYS]
    },
    {
      view: 'Twin capsule lab',
      text: 'Spawn twin Reploid runtimes, run the same task in each, and render diffs for context growth, tool paths, latency, and outcome quality.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Context inspector',
      text: 'Visualize exactly what enters the model context, where it came from, and how large it is, then patch the substrate to improve signal density.',
      tags: [TAGS.VISUAL, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'VFS journal',
      text: 'Add a journaled VFS layer with snapshots, rollback points, and readable diffs, then render it as a recoverable event log.',
      tags: [TAGS.GOV, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Self-hosting tool',
      text: 'Create a tool that emits its own full source, schema, and behavior contract from internal structure rather than file reads, then validate that the emitted version is identical to the running tool.',
      tags: [TAGS.SYS, TAGS.GOV, TAGS.DATA]
    }
  ],
  'L3: Weak RSI': [
    {
      view: 'Architecture optimizer',
      text: 'Build a JSON architecture model of the current system, propose bounded improvements, benchmark them, and keep only measured wins.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Toolchain optimizer',
      text: 'Use tool telemetry to identify the worst bottlenecks, patch them, run fixed evaluations, and retain only changes that improve success rate or latency.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Prompt ladder',
      text: 'Run bounded prompt and policy variants against a fixed task suite, maintain a leaderboard, and promote only statistically better versions.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Runtime self-heal',
      text: 'Detect repeat runtime failures, generate a candidate patch, verify it in a sandbox, and publish a pass-fail timeline with rollback on regression.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Improvement console',
      text: DEFAULT_REPLOID_HOME_GOAL,
      tags: [TAGS.BENCH, TAGS.GOV, TAGS.SYS]
    }
  ],
  'L4: Weak AGI': [
    {
      view: 'Autonomy control room',
      text: 'Design and build a control room for yourself with architecture maps, tool telemetry, VFS health, experiment history, and capability scores, then use it to guide later runs.',
      tags: [TAGS.VISUAL, TAGS.ORCH, TAGS.SYS]
    },
    {
      view: 'Runtime world model',
      text: 'Construct a structured world model of your own runtime, predict the effects of planned changes before applying them, and score yourself on prediction accuracy over time.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Research director',
      text: 'Take a broad objective, decompose it into milestones, experiments, rubrics, and artifacts, then reprioritize the plan as new evidence arrives.',
      tags: [TAGS.ORCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Capability battery',
      text: 'Create a mixed benchmark battery spanning UI building, data analysis, debugging, tool creation, and system planning, then map your own strengths, failures, and transfer ability.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Cross-domain program',
      text: 'Use your architecture model, tool telemetry, and benchmark battery to choose what to improve next, execute a bounded upgrade, and justify the choice with evidence rather than heuristics.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    }
  ]
};

const normalizeText = (value) => String(value || '').trim();

const createSeededRandom = (seed) => {
  let state = (Number(seed) || 0) >>> 0;
  if (state === 0) {
    return () => 0;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const shuffleWithSeed = (items, seed, salt = 0) => {
  if (!seed) {
    return [...items];
  }

  const random = createSeededRandom(Number(seed) + salt);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export function getGoalCategories() {
  return GOAL_CATEGORIES;
}

export function getGoalEntries(seed = 0) {
  return shuffleWithSeed(Object.entries(GOAL_CATEGORIES), seed, 17)
    .map(([category, goals], index) => [
      category,
      shuffleWithSeed(goals, seed, 1000 + index)
    ]);
}

export function findGoalMeta(goalValue) {
  const normalized = normalizeText(goalValue).toLowerCase();
  if (!normalized) return null;

  for (const [category, goals] of Object.entries(GOAL_CATEGORIES)) {
    for (const goal of goals) {
      const view = normalizeText(goal.view).toLowerCase();
      const text = normalizeText(goal.text).toLowerCase();
      if (view === normalized || text === normalized) {
        return { ...goal, category };
      }
    }
  }

  return null;
}

export function formatGoalPacket(goalValue) {
  const goal = normalizeText(goalValue);
  return goal ? goal : '';
}
