/**
 * @fileoverview Goal presets for the boot wizard.
 */

import { DEFAULT_REPLOID_HOME_GOAL } from '../shared/reploid-contract.js';

export { DEFAULT_REPLOID_HOME_GOAL };

const TAGS = {
  UI: 'UI',
  VISUAL: 'Visualization',
  ORCH: 'Orchestration',
  BENCH: 'Benchmark',
  GOV: 'Governance',
  DATA: 'Data',
  SYS: 'Systems'
};

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

export const ZERO_GOAL_CHOICES = Object.freeze([
  {
    view: 'Seed audit',
    level: 1,
    text: 'Read the seed files, find the smallest weak instruction, stage a clearer replacement under /shadow, and write evidence under /artifacts.'
  },
  {
    view: 'Tool seed',
    level: 1,
    text: 'Draft one minimal tool under /shadow/tools, write a smoke-test artifact, and request Promote only if the evidence is complete.'
  },
  {
    view: 'Loop trace',
    level: 1,
    text: 'Trace one loop from goal to model response to tool result, record the failure boundary, and stage one reversible repair.'
  },
  {
    view: 'Prompt trim',
    level: 1,
    text: 'Find duplicated prompt or blueprint instructions, stage a smaller equivalent contract under /shadow, and record the behavior that must not change.'
  },
  {
    view: 'Boot simplifier',
    level: 1,
    text: 'Inspect the Zero boot path, stage one simplification that preserves local model execution, and write a rollback note.'
  },
  {
    view: 'DOM Katamari Lab',
    level: 1,
    text: 'Build a 3D DOM collector that turns page elements into selectable physics objects, then export stable selectors and a replay artifact.'
  },
  {
    view: 'Browser Circuit Board',
    level: 1,
    text: 'Draw the live Zero runtime as a circuit board of VFS, model, tools, workers, storage, and promotion gates.'
  },
  {
    view: 'Replay Telescope',
    level: 1,
    text: 'Build a zoomable timeline of one Zero loop from goal to prompt to tool call to artifact to promotion decision.'
  },
  {
    view: 'DOM Skyline',
    level: 1,
    text: 'Render the current page as a layered skyline of semantic regions, event handlers, storage calls, and selector candidates.'
  },
  {
    view: 'Canvas Trace Prism',
    level: 1,
    text: 'Capture a visual trace of one browser action, split it into DOM, canvas, network, and storage lanes, and save the trace artifact.'
  },
  {
    view: 'Selector Gravity Well',
    level: 1,
    text: 'Create a visual selector picker where stronger selectors pull matching nodes closer, then export the smallest robust selector set.'
  },
  {
    view: 'State Snapshot Deck',
    level: 1,
    text: 'Turn state snapshots into a swipeable deck with diffs, timestamps, and one-click rollback evidence for each mutation.'
  },
  {
    view: 'Capability Light Table',
    level: 1,
    text: 'Build a light-table view of browser capabilities, permission states, fallbacks, and the files that depend on each capability.'
  },
  {
    view: 'Context X-Ray',
    level: 2,
    text: 'Visualize the exact model context as colored layers, identify low-signal sections, and stage one measurable compression.'
  },
  {
    view: 'OPFS Time Capsule',
    level: 2,
    text: 'Build a visual artifact vault for snapshots, traces, receipts, and rollbacks with integrity checks.'
  },
  {
    view: 'WebGPU Pulse Map',
    level: 2,
    text: 'Probe browser compute capability and render a live heatmap of model/runtime readiness, fallback paths, and inference status.'
  },
  {
    view: 'Shadow Diff Theater',
    level: 2,
    text: 'Render staged /shadow edits as an interactive before/after scene with risk markers and rollback buttons.'
  },
  {
    view: 'Tool Forge Diorama',
    level: 2,
    text: 'Generate one tiny browser tool, test it, then show its source, schema, execution trace, and promotion readiness in one view.'
  },
  {
    view: 'Prompt Contract Inspector',
    level: 2,
    text: 'Inspect the active Zero system prompt, extract its enforceable rules, and stage one clearer contract with matching test evidence.'
  },
  {
    view: 'VFS Transit Map',
    level: 2,
    text: 'Map every seed, shadow, artifact, and generated module path as a transit system with read/write edges and stale-file markers.'
  },
  {
    view: 'Worker Split Lab',
    level: 2,
    text: 'Move one expensive verification into a Worker, compare output with the main thread, and archive the isolation boundary.'
  },
  {
    view: 'Receipt Inspector',
    level: 2,
    text: 'Build a receipt inspector that verifies hash fields, signer identity, model path, prompt hash, output hash, and room metadata.'
  },
  {
    view: 'Failure Heatmap',
    level: 2,
    text: 'Cluster recent runtime errors by source file, action type, and repeated stack shape, then stage one narrow repair candidate.'
  },
  {
    view: 'Artifact Indexer',
    level: 2,
    text: 'Create a searchable artifact index for screenshots, logs, diffs, traces, receipts, and benchmark outputs with provenance filters.'
  },
  {
    view: 'Model Path Auditor',
    level: 2,
    text: 'Audit local and proxy inference paths, show model identity and fallback behavior, and record the exact path used for one task.'
  },
  {
    view: 'Permission Flight Check',
    level: 2,
    text: 'Wrap one permission-mediated browser API with denied-path UI, audit notes, and a visible fallback proof.'
  },
  {
    view: 'Prompt Arcade',
    level: 3,
    text: 'Create a visual arena where prompt variants compete on fixed tasks, with score trails, diffs, and promotion evidence.'
  },
  {
    view: 'Self-Heal Pinball',
    level: 3,
    text: 'Turn runtime failures into a physics board where repeated failures cluster, then patch the highest-impact failure lane.'
  },
  {
    view: 'RSI Scoreboard',
    level: 3,
    text: 'Run bounded self-improvement candidates, display measured wins and losses, and promote only evidence-backed changes.'
  },
  {
    view: 'Patch Tournament',
    level: 3,
    text: 'Generate three reversible patch candidates for one weakness, run the same checks on each, and keep only the measured winner.'
  },
  {
    view: 'Prompt Ladder',
    level: 3,
    text: 'Evolve one prompt through bounded variants, score each against a fixed rubric, and preserve the full ancestry chain.'
  },
  {
    view: 'Tool Reliability Loop',
    level: 3,
    text: 'Measure tool failures across recent runs, patch the noisiest tool contract, and prove the fix with a replayed failing case.'
  },
  {
    view: 'Verifier Duel',
    level: 3,
    text: 'Run two independent verification strategies against the same staged edit and render where their evidence agrees or conflicts.'
  },
  {
    view: 'Telemetry Governor',
    level: 3,
    text: 'Build a telemetry loop that chooses the next improvement target from measured failure rate, artifact gaps, and rollback risk.'
  },
  {
    view: 'Regression Maze',
    level: 3,
    text: 'Turn test and replay failures into a visual maze, then stage one patch that closes a path without opening a new failure route.'
  },
  {
    view: 'Policy Patch Lab',
    level: 3,
    text: 'Stage a policy change for self-edits, simulate allowed and denied actions, and promote only if the boundary gets clearer.'
  },
  {
    view: 'Memory Compression Trial',
    level: 3,
    text: 'Compress one memory or artifact set, compare retrieval quality before and after, and keep the smaller representation only if it passes.'
  },
  {
    view: 'Promotion Gate Drill',
    level: 3,
    text: 'Exercise the full shadow-to-promote gate with a harmless edit, receipt, rollback note, and visible pass/fail ledger.'
  },
  {
    view: 'Benchmark Remix Board',
    level: 3,
    text: 'Build a board that reruns fixed tasks under prompt, tool, and model-path variants, then ranks only reproducible improvements.'
  },
  {
    view: 'Peer Signal Room',
    level: 4,
    text: 'Visualize WebRTC peers, requests, receipts, and trust boundaries while proving no peer can mutate validators.'
  },
  {
    view: 'Autonomy Control Room',
    level: 4,
    text: 'Build a control room that combines tool telemetry, VFS health, model status, artifact coverage, and promotion risk into one decision surface.'
  },
  {
    view: 'World Model Sketchpad',
    level: 4,
    text: 'Construct a structured model of Zero runtime components, predict the effect of one planned edit, and score the prediction after verification.'
  },
  {
    view: 'Research Director Board',
    level: 4,
    text: 'Break one broad objective into experiments, rubrics, artifacts, and gates, then reprioritize from fresh evidence.'
  },
  {
    view: 'Capability Frontier Map',
    level: 4,
    text: 'Map current capabilities against browser APIs, model paths, tools, and tests, then choose the next upgrade from the weakest proven edge.'
  },
  {
    view: 'Cross-Task Transfer Trial',
    level: 4,
    text: 'Apply one verified improvement from a UI task to a tooling task, measure transfer, and archive the conditions where it fails.'
  },
  {
    view: 'Substrate Twin Run',
    level: 4,
    text: 'Run the same objective through two isolated runtime snapshots, compare artifacts and decisions, and keep the more verifiable path.'
  },
  {
    view: 'Risk Budget Console',
    level: 4,
    text: 'Assign explicit risk budgets to storage, tools, model calls, and promotions, then block actions that exceed the current budget.'
  },
  {
    view: 'Distributed Receipt Mesh',
    level: 4,
    text: 'Coordinate multiple browser peers for one inference receipt flow, then prove queue fairness, dedupe, and room isolation in artifacts.'
  },
  {
    view: 'Self-Model Critic',
    level: 4,
    text: 'Have Zero describe its own current architecture, compare the description to live files, and patch the largest factual mismatch.'
  },
  {
    view: 'Open-Loop Sandbox',
    level: 4,
    text: 'Let Zero plan several candidate edits without applying them, score predicted impact, and apply only the safest verified candidate.'
  },
  {
    view: 'Goal Decomposer',
    level: 4,
    text: 'Turn one ambiguous user goal into a dependency graph, runnable checks, and artifact targets before any file mutation is allowed.'
  },
  {
    view: 'Toolchain Market',
    level: 4,
    text: 'Rank tools by observed usefulness, reliability, and artifact value, then retire or rewrite the lowest-ranked tool contract.'
  },
  {
    view: 'Recursive Lab Notebook',
    level: 5,
    text: 'Create a lab notebook where every self-improvement hypothesis, patch, check, result, and rollback is linked into one evidence graph.'
  },
  {
    view: 'ASI Boundary Map',
    level: 5,
    text: 'Map which requested behaviors remain bounded weak RSI, which imply stronger autonomy, and which must stay outside promotion gates.'
  },
  {
    view: 'Evaluator Council',
    level: 5,
    text: 'Run several evaluator rubrics over the same staged change, compare disagreements, and require explicit evidence before promotion.'
  },
  {
    view: 'Long-Horizon Planner',
    level: 5,
    text: 'Plan a chained improvement program with measurable checkpoints, hard stop conditions, and artifacts that survive page reload.'
  },
  {
    view: 'Capability Escalation Drill',
    level: 5,
    text: 'Simulate a request for broader autonomy, show which gates stop it, and patch any missing warning, receipt, or rollback path.'
  },
  {
    view: 'Self-Revision Constitution',
    level: 5,
    text: 'Draft a compact self-revision constitution for Zero, then test it against allowed repairs, risky rewrites, and unsupported requests.'
  },
  {
    view: 'Meta-Benchmark Forge',
    level: 5,
    text: 'Generate a benchmark that tests whether future improvements actually improve task success rather than only optimizing the visible score.'
  },
  {
    view: 'Recursive Prompt Genome',
    level: 5,
    text: 'Represent prompt variants as a genome with traits, parents, scores, and failure modes, then evolve one bounded generation.'
  },
  {
    view: 'Architecture Constitution Check',
    level: 5,
    text: 'Compare a proposed architecture change against immutable recovery rules, measured benefit, and rollback readiness before staging it.'
  },
  {
    view: 'Autonomy Kill Switch Drill',
    level: 5,
    text: 'Build and test a visible halt control that stops local loops, workers, model calls, and pending promotions without corrupting artifacts.'
  },
  {
    view: 'Reflective Compression Engine',
    level: 5,
    text: 'Compress Zero history into a durable self-model, test recall against source artifacts, and preserve links back to original evidence.'
  },
  {
    view: 'Frontier Evidence Wall',
    level: 5,
    text: 'Render all claims of improvement as an evidence wall, separate measured wins from speculation, and remove unsupported claims from the active plan.'
  }
]);

export const DEFAULT_ZERO_GOAL = ZERO_GOAL_CHOICES[0].text;

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

export function getRandomZeroGoal(seed = Date.now(), currentGoal = '') {
  const normalizedCurrent = normalizeText(currentGoal);
  const candidates = ZERO_GOAL_CHOICES
    .filter((goal) => normalizeText(goal.text) !== normalizedCurrent);
  const pool = candidates.length > 0 ? candidates : ZERO_GOAL_CHOICES;
  if (pool.length === 0) return null;

  const random = createSeededRandom(Number(seed) ^ 0xc2b2ae35);
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
