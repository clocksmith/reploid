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

export const DEFAULT_REPLOID_HOME_GOAL = 'Run one Shadow RGR self-improvement cycle: read the kernel prompt, RGR blueprints, runtime, and capsule; identify one measurable weakness; produce one reversible candidate plus a receipt/archive entry with baseline, score vector, rollback path, and gate reasons. Do not promote.';

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
      view: 'Capability probe',
      text: 'Create a browser capability probe for IndexedDB, OPFS, Workers, WebGPU, WebRTC, clipboard, and wake locks, then render the result as a substrate card.',
      tags: [TAGS.UI, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Storage atlas',
      text: 'Map VFS and OPFS storage into a live atlas with quota estimates, artifact sizes, readback checks, and rollback markers.',
      tags: [TAGS.DATA, TAGS.VISUAL, TAGS.SYS]
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
    },
    {
      view: 'Hot-load lab',
      text: 'Create a hot-load lab that writes a tiny tool, loads it from VFS as a blob module, runs it, and records the baseline versus loaded behavior.',
      tags: [TAGS.SYS, TAGS.BENCH, TAGS.DATA]
    },
    {
      view: 'Permission wrapper',
      text: 'Wrap one permission-mediated browser API with a gate, audit note, denied-path behavior, and a visible status widget.',
      tags: [TAGS.GOV, TAGS.UI, TAGS.SYS]
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
      view: 'Worker replay lane',
      text: 'Move one replay or verification check into a Web Worker lane, compare it with main-thread output, and archive the isolation boundary.',
      tags: [TAGS.BENCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Service worker mirror',
      text: 'Trace how VFS files become executable modules through the service-worker and blob-loading path, then write one repair candidate for the weakest edge.',
      tags: [TAGS.DATA, TAGS.GOV, TAGS.SYS]
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
      view: 'Browser RGR frontier',
      text: 'Render the Shadow archive as a DOM or canvas Pareto frontier, identify one dominated candidate, and write the score evidence.',
      tags: [TAGS.VISUAL, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Peer witness gate',
      text: 'Design a WebRTC witness flow where browser peers add anchor observations but cannot mutate validators or approve promotion.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'OPFS trace trial',
      text: 'Persist one large trace or eval payload in OPFS, read it back through the visible tool path, and score storage reliability.',
      tags: [TAGS.DATA, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Compute probe cycle',
      text: 'Detect WebGPU or WASM support, run one bounded local-compute proof, and archive the fallback path when unavailable.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Prompt gate hardening',
      text: 'Patch the active prompt so self-edits must cite browser capability checks before using storage, workers, WebGPU, DOM, or peers.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.DATA]
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
      view: 'Browser organism map',
      text: 'Build a living map of VFS, workers, peers, storage, UI, and inference lanes, then choose the next self-improvement from measured weakness.',
      tags: [TAGS.VISUAL, TAGS.ORCH, TAGS.SYS]
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

export function getRandomGoalEntry(seed = Date.now(), currentGoal = '') {
  const normalizedCurrent = normalizeText(currentGoal);
  const candidates = getGoalEntries(seed)
    .flatMap(([category, goals]) => (
      goals.map((goal) => ({ category, goal }))
    ))
    .filter((entry) => !entry.goal?.locked)
    .filter((entry) => normalizeText(entry.goal?.text || entry.goal?.view) !== normalizedCurrent);

  const fallbackCandidates = getGoalEntries(seed)
    .flatMap(([category, goals]) => (
      goals.map((goal) => ({ category, goal }))
    ))
    .filter((entry) => !entry.goal?.locked);
  const pool = candidates.length > 0 ? candidates : fallbackCandidates;
  if (pool.length === 0) return null;

  const random = createSeededRandom(Number(seed) ^ 0x85ebca6b);
  return pool[Math.floor(random() * pool.length)] || pool[0];
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
