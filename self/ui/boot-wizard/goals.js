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
      text: 'Build a visually impressive Katamari-style 3D DOM picker that injects into the current browser runtime area, uses CreateTool to install and load the implementation, turns live page elements into collectible physics objects, then lets the user orbit, inspect, and export robust selectors.',
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

export const ZERO_GOAL_LIBRARY = Object.freeze([
  { view: 'L1 DOM Katamari', level: 1, text: 'Build a playful DOM katamari injected into the current page/runtime area, use CreateTool to install and load the implementation, and gather live buttons, cards, and forms into labeled selector trophies.' },
  { view: 'L1 DOM Aquarium', level: 1, text: 'Render DOM nodes as fish that swim by tag type, with hover bubbles showing selectors and roles.' },
  { view: 'L1 DOM Pinball', level: 1, text: 'Turn clickable elements into bumpers, launch a selector ball, and score robust paths versus brittle paths.' },
  { view: 'L1 DOM Stage Lights', level: 1, text: 'Spotlight page regions one by one, record their semantic purpose, and save a visual component map.' },
  { view: 'L1 Canvas Fireworks', level: 1, text: 'Draw every tool call as a canvas firework burst with color-coded success, error, and artifact trails.' },
  { view: 'L1 Canvas Maze', level: 1, text: 'Create a canvas maze where prompt tokens walk toward tool exits and dead ends become warnings.' },
  { view: 'L1 Canvas Oscilloscope', level: 1, text: 'Plot model, VFS, and UI events as neon waveforms with scrub controls and labeled spikes.' },
  { view: 'L1 Canvas Diorama', level: 1, text: 'Build a tiny canvas city where files are buildings, reads are lights, and writes leave visible construction cranes.' },
  { view: 'L1 CSS Weather Map', level: 1, text: 'Turn layout states into a CSS weather map showing overflow storms, contrast fog, and spacing pressure.' },
  { view: 'L1 CSS Token Garden', level: 1, text: 'Grow design tokens as flowers, showing where each color, gap, and type scale appears on the page.' },
  { view: 'L1 CSS Breakpoint Radar', level: 1, text: 'Build a radar that sweeps mobile, tablet, and desktop states and flags awkward layout collisions.' },
  { view: 'L1 CSS Glass Lab', level: 1, text: 'Prototype a translucent lab panel system with readable contrast and a visual note for every token choice.' },
  { view: 'L1 SVG Circuit', level: 1, text: 'Draw the boot path as an SVG circuit with current flowing through kernel, VFS, tools, and UI.' },
  { view: 'L1 SVG Creature Map', level: 1, text: 'Represent browser APIs as friendly creatures, each holding capability badges, permissions, and fallback signs.' },
  { view: 'L1 SVG Timeline Ribbon', level: 1, text: 'Create a ribbon timeline of one loop with knots for prompts, toolcalls, artifacts, and decisions.' },
  { view: 'L1 SVG Selector Glyphs', level: 1, text: 'Design glyphs for selector strength, role quality, text stability, and ancestry, then apply them to elements.' },
  { view: 'L1 WebGPU Lanterns', level: 1, text: 'Probe WebGPU support and render readiness as lanterns for adapters, limits, shaders, and fallback paths.' },
  { view: 'L1 WebGPU Sandbox Badge', level: 1, text: 'Build a simple shader badge that lights only when compute capability and safety notes are present.' },
  { view: 'L1 WebGPU Particle Receipt', level: 1, text: 'Animate particles for a bounded compute proof and save the exact capability receipt beside the canvas.' },
  { view: 'L1 WebGPU Fallback Theater', level: 1, text: 'Show WebGPU, WASM, and plain JavaScript fallbacks as stage actors competing for a tiny render task.' },
  { view: 'L1 VFS Cabinet', level: 1, text: 'Render top-level VFS folders as drawers with counts, freshness labels, and a safe open animation.' },
  { view: 'L1 VFS Treasure Map', level: 1, text: 'Draw seeded files, shadow drafts, and artifacts as treasure islands connected by read and write routes.' },
  { view: 'L1 VFS Traffic Lights', level: 1, text: 'Create traffic lights for readable, writable, protected, and missing paths with sample file probes.' },
  { view: 'L1 VFS Snow Globe', level: 1, text: 'Put recent VFS events inside a snow globe where writes fall, reads sparkle, and errors crack glass.' },
  { view: 'L1 OPFS Vault', level: 1, text: 'Build a visual vault for large artifacts with size plaques, integrity checks, and restore instructions.' },
  { view: 'L1 OPFS Cargo Dock', level: 1, text: 'Show trace bundles as cargo containers moving between memory, OPFS, and visible artifact indexes.' },
  { view: 'L1 OPFS Fossil Bed', level: 1, text: 'Turn old snapshots into fossils with timestamps, hash labels, and links back to their source cycle.' },
  { view: 'L1 OPFS Lighthouse', level: 1, text: 'Create a lighthouse panel that warns when large artifacts need OPFS instead of IndexedDB.' },
  { view: 'L1 Service Worker Subway', level: 1, text: 'Map fetch requests as subway trains moving through network, VFS, cache, and bypass stations.' },
  { view: 'L1 Service Worker X-Ray', level: 1, text: 'Inspect one module request and draw every rewrite, scope decision, and response source on screen.' },
  { view: 'L1 Service Worker Passport', level: 1, text: 'Give each served module a passport showing path, version, instance, and whether VFS handled it.' },
  { view: 'L1 Service Worker Signal Tower', level: 1, text: 'Build a signal tower that lights when the worker installs, activates, controls, and serves lab files.' },
  { view: 'L1 Worker Beehive', level: 1, text: 'Draw workers as bees carrying verification pollen from main thread flowers to artifact honeycomb cells.' },
  { view: 'L1 Worker Puppet Stage', level: 1, text: 'Create a puppet stage where main thread commands and worker replies move as visible strings.' },
  { view: 'L1 Worker Stopwatch Wall', level: 1, text: 'Benchmark one tiny task in main thread and worker, then display timing medals and message overhead.' },
  { view: 'L1 Worker Safety Cage', level: 1, text: 'Render worker boundaries as cages showing which data enters, which data exits, and what cannot mutate.' },
  { view: 'L1 WebRTC Constellation', level: 1, text: 'Draw peers as stars with room labels, connection lines, and witness-only badges for safe collaboration.' },
  { view: 'L1 WebRTC Paper Planes', level: 1, text: 'Animate peer messages as paper planes, tagging offers, answers, receipts, and dropped packets.' },
  { view: 'L1 WebRTC Harbor', level: 1, text: 'Build a harbor view where peers dock, exchange receipts, and leave without touching validators.' },
  { view: 'L1 WebRTC Trust Lanterns', level: 1, text: 'Give every peer a lantern that changes brightness with handshake state, receipt quality, and permissions.' },
  { view: 'L1 Context Layer Cake', level: 1, text: 'Stack prompt, goal, memory, tools, and artifacts as cake layers with token counts and source crumbs.' },
  { view: 'L1 Context Prism', level: 1, text: 'Split the active context through a prism into instructions, evidence, guesses, and tool affordances.' },
  { view: 'L1 Context Backpack', level: 1, text: 'Pack a model backpack with only necessary context cards and show what got left behind.' },
  { view: 'L1 Context Thermometer', level: 1, text: 'Build a token temperature gauge that warns when context heat comes from repetition or stale files.' },
  { view: 'L1 Tool Arcade', level: 1, text: 'Turn available tools into arcade machines with schema tickets, last score, failure mode, and sample play.' },
  { view: 'L1 Tool Marble Run', level: 1, text: 'Roll a request marble through validation, execution, retry, and artifact chutes with visible stops.' },
  { view: 'L1 Tool Bento Box', level: 1, text: 'Arrange tools into a bento box by read, write, edit, search, load, and promote powers.' },
  { view: 'L1 Tool Radio Booth', level: 1, text: 'Broadcast tool calls as radio signals, showing arguments, duration, result shape, and error static.' },
  { view: 'L1 Prompt Puppet', level: 1, text: 'Make prompt clauses into puppet strings that pull model behavior toward files, tools, and artifacts.' },
  { view: 'L1 Prompt Quilt', level: 1, text: 'Sew prompt fragments into a quilt, marking duplicated patches and unclear seams with bright thread.' },
  { view: 'L1 Prompt Lantern Walk', level: 1, text: 'Guide the model through prompt lanterns, each revealing one enforceable rule and one proof location.' },
  { view: 'L1 Prompt Echo Cave', level: 1, text: 'Visualize repeated instructions as echoes in a cave and mark which echoes can be safely removed.' },
  { view: 'L1 Artifact Museum', level: 1, text: 'Curate artifacts as museum pieces with labels for source cycle, tool path, evidence type, and usefulness.' },
  { view: 'L1 Artifact Conveyor', level: 1, text: 'Animate artifacts on a conveyor from input to trace, toolcalls, score, mutation, decision, and audit.' },
  { view: 'L1 Artifact Sticker Book', level: 1, text: 'Give every artifact a sticker for screenshot, JSON, diff, receipt, or rollback and sort them visually.' },
  { view: 'L1 Artifact Radar', level: 1, text: 'Build radar that pings missing artifacts for each claimed loop and shows distance to complete evidence.' },
  { view: 'L1 Memory Campfire', level: 1, text: 'Show memories as campfire sparks, brighter when recently used and dimmer when unsupported by artifacts.' },
  { view: 'L1 Memory Library Cart', level: 1, text: 'Push a library cart of summaries, receipts, and source links, then sort by freshness and confidence.' },
  { view: 'L1 Memory Puzzle Wall', level: 1, text: 'Arrange related memories as puzzle pieces and highlight missing connectors back to source files.' },
  { view: 'L1 Memory Bonsai', level: 1, text: 'Grow a bonsai of compact memories, pruning unsupported branches and labeling each retained evidence leaf.' },
  { view: 'L1 Promotion Elevator', level: 1, text: 'Build an elevator where shadow edits need receipts, rollback notes, and checks before reaching /self.' },
  { view: 'L1 Promotion Drawbridge', level: 1, text: 'Draw a castle gate that opens only when diff, score, audit, and rollback shields are present.' },
  { view: 'L1 Promotion Traffic Court', level: 1, text: 'Stage candidate edits as tiny court cases with evidence cards, objections, and final promote or reject stamps.' },
  { view: 'L1 Promotion Rocket Pad', level: 1, text: 'Prepare a harmless edit for launch with checklist lights for tests, receipts, rollback, and scope.' },
  { view: 'L2 DOM Mutation Garden', level: 2, text: 'Grow DOM mutation candidates as plants, water only reversible changes, and label selector roots with evidence.' },
  { view: 'L2 DOM Inspector Carnival', level: 2, text: 'Build carnival booths for roles, text anchors, CSS paths, and event handlers, then award selector prizes.' },
  { view: 'L2 DOM Recursion Mirror', level: 2, text: 'Make nested components reflect into smaller mirrors until repeated structure and brittle selectors become obvious.' },
  { view: 'L2 DOM Accessibility Parade', level: 2, text: 'March focusable elements through a parade route with keyboard order, labels, and contrast badges.' },
  { view: 'L2 Canvas Trace Rollercoaster', level: 2, text: 'Convert cycle traces into a rollercoaster track where steep drops mark errors and loops mark retries.' },
  { view: 'L2 Canvas Shader Toybox', level: 2, text: 'Create canvas toys for prompt length, tool latency, and artifact density with sliders and saved presets.' },
  { view: 'L2 Canvas Diff Aquarium', level: 2, text: 'Let old and new file lines swim as schools, then show changed lines as glowing coral.' },
  { view: 'L2 Canvas Loop Planetarium', level: 2, text: 'Render cycles as planets orbiting goals, with moons for tool calls and rings for artifacts.' },
  { view: 'L2 CSS Mutation Forge', level: 2, text: 'Forge visual style variants in /shadow, preview them side by side, and keep rollback-ready CSS receipts.' },
  { view: 'L2 CSS Responsive Arcade', level: 2, text: 'Turn breakpoints into arcade levels, score layout survival, and show where mobile controls fail.' },
  { view: 'L2 CSS Specificity Dragon', level: 2, text: 'Draw a dragon made of selectors, then tame the highest-specificity rules with simpler alternatives.' },
  { view: 'L2 CSS Theme Synth', level: 2, text: 'Compose a bold theme from tokens, preview every component, and document the visual contract.' },
  { view: 'L2 SVG VFS Transit', level: 2, text: 'Build an SVG transit map where stations are VFS paths and lines are read, write, mirror, promote.' },
  { view: 'L2 SVG Tool Bestiary', level: 2, text: 'Draw each tool as a beast with powers, risks, schema teeth, and recent performance markings.' },
  { view: 'L2 SVG Recursive Nest', level: 2, text: 'Visualize recursive improvement as nested SVG rooms, each holding a candidate, score, and rollback door.' },
  { view: 'L2 SVG Evidence Tree', level: 2, text: 'Grow an evidence tree where artifacts are leaves, toolcalls are branches, and unsupported claims fall off.' },
  { view: 'L2 WebGPU Heat Shield', level: 2, text: 'Render local compute readiness as a heat shield, showing limits, safe fallback, and tiny proof output.' },
  { view: 'L2 WebGPU Benchmark Kite', level: 2, text: 'Fly benchmark kites for shader, WASM, and CPU paths, then record which path stayed stable.' },
  { view: 'L2 WebGPU Particle Audit', level: 2, text: 'Use particles to show bounded compute steps, with every frame tied to a reproducible input.' },
  { view: 'L2 WebGPU Capability Compass', level: 2, text: 'Build a compass pointing toward available browser compute, memory limits, and safest model route.' },
  { view: 'L2 VFS Snapshot Theater', level: 2, text: 'Stage before and after VFS snapshots as theater sets with props for created, edited, and deleted files.' },
  { view: 'L2 VFS Mirror Maze', level: 2, text: 'Explore source and /self mirrors as a maze, marking dead ends, stale halls, and live import doors.' },
  { view: 'L2 VFS File Orchard', level: 2, text: 'Grow files as fruit trees, showing seeded roots, shadow grafts, artifact harvests, and prune candidates.' },
  { view: 'L2 VFS Path Detective', level: 2, text: 'Build a detective board for one missing path, linking caller, expected root, actual root, and repair.' },
  { view: 'L2 OPFS Black Box', level: 2, text: 'Record a large trace in an OPFS black box, replay it, and display hash-confirmed recovery.' },
  { view: 'L2 OPFS Memory Reef', level: 2, text: 'Place big artifacts in a reef where healthy hashes glow and unreachable blobs bleach white.' },
  { view: 'L2 OPFS Cargo Scanner', level: 2, text: 'Scan trace cargo for size, type, checksum, origin cycle, and whether IndexedDB should avoid it.' },
  { view: 'L2 OPFS Deep Freeze', level: 2, text: 'Freeze rollback bundles in OPFS, thaw one bundle, and prove the restored artifact matches.' },
  { view: 'L2 Service Worker Import Zoo', level: 2, text: 'Put every module import in a zoo enclosure with food labels for VFS, network, and bypass.' },
  { view: 'L2 Service Worker Cache Ghosts', level: 2, text: 'Hunt stale module ghosts by path, query, instance, and build version, then pin the fix.' },
  { view: 'L2 Service Worker Control Room', level: 2, text: 'Build switches for install, activate, control, invalidate, and route decisions with visible current state.' },
  { view: 'L2 Service Worker Mirror Drill', level: 2, text: 'Trace one /self import through mirror creation, service worker fetch, rewrite, and browser execution.' },
  { view: 'L2 Worker Forklift', level: 2, text: 'Move a verification crate into a worker, compare main-thread and worker outputs, and label isolation costs.' },
  { view: 'L2 Worker Ant Farm', level: 2, text: 'Show worker messages as ants carrying inputs, outputs, and errors through transparent tunnels.' },
  { view: 'L2 Worker Replay Booth', level: 2, text: 'Replay one tool result inside a worker booth and prove the same structured output emerges.' },
  { view: 'L2 Worker Fault Bell', level: 2, text: 'Ring visible bells for worker timeout, malformed message, thrown error, and graceful fallback.' },
  { view: 'L2 WebRTC Witness Garden', level: 2, text: 'Plant peer witness flowers that can observe artifacts but cannot touch validators or promote edits.' },
  { view: 'L2 WebRTC Packet Circus', level: 2, text: 'Animate offers, answers, candidates, receipts, and retries as circus acts with failure nets.' },
  { view: 'L2 WebRTC Room Compass', level: 2, text: 'Map peer rooms with compass needles for role, trust boundary, receipt status, and disconnect risk.' },
  { view: 'L2 WebRTC Receipt Ferry', level: 2, text: 'Move receipts across a ferry route, dedupe arrivals, and mark invalid cargo before docking.' },
  { view: 'L2 Context Distillery', level: 2, text: 'Distill context into evidence, instructions, examples, and noise, then show the compressed prompt bottle.' },
  { view: 'L2 Context Stage Manager', level: 2, text: 'Cue context actors in order and flag any role that speaks without a source citation.' },
  { view: 'L2 Context Budget Casino', level: 2, text: 'Spend token chips on files, memory, tools, and user goal, then reveal payoff and waste.' },
  { view: 'L2 Context Archaeology', level: 2, text: 'Excavate old context layers, label fossils, and remove unsupported sediment from the active prompt.' },
  { view: 'L2 Tool Forge Train', level: 2, text: 'Move a tool idea through schema, implementation, smoke test, docs, and load stations.' },
  { view: 'L2 Tool Reliability Carnival', level: 2, text: 'Let tools play skill games where retries, typed errors, and stable outputs win tickets.' },
  { view: 'L2 Tool Contract Microscope', level: 2, text: 'Zoom into one tool contract and highlight missing argument validation, audit events, and failure shape.' },
  { view: 'L2 Tool Sandbox Kitchen', level: 2, text: 'Cook a tool candidate in /shadow, taste the output, and plate evidence before promotion.' },
  { view: 'L2 Prompt Mutation Bonsai', level: 2, text: 'Trim one prompt branch, graft clearer wording, and show behavior that must remain unchanged.' },
  { view: 'L2 Prompt Spellbook', level: 2, text: 'Turn prompt rules into spells with ingredients, risks, and proof that each spell works.' },
  { view: 'L2 Prompt Recursion Doll', level: 2, text: 'Nest prompt summaries inside smaller dolls until the irreducible self-edit contract remains.' },
  { view: 'L2 Prompt Traffic Signals', level: 2, text: 'Give prompt clauses red, yellow, and green lights based on enforceability and evidence requirements.' },
  { view: 'L2 Artifact Puppet Theater', level: 2, text: 'Stage artifacts as puppets reenacting one loop from input through final decision.' },
  { view: 'L2 Artifact Forge Sparks', level: 2, text: 'Show every artifact being forged from a tool result, with sparks for metadata and hashes.' },
  { view: 'L2 Artifact Atlas Cards', level: 2, text: 'Create atlas cards for trace, score, mutation, decision, and audit files with missing-field warnings.' },
  { view: 'L2 Artifact Echo Locator', level: 2, text: 'Ping claimed improvements and show which artifacts echo back versus which claims are silent.' },
  { view: 'L2 Memory Firefly Net', level: 2, text: 'Catch memory fireflies, pin only source-backed ones, and release unsupported summaries back to darkness.' },
  { view: 'L2 Memory Compression Loom', level: 2, text: 'Weave long history into compact threads and test if source-linked recall survives compression.' },
  { view: 'L2 Memory Orchard Labels', level: 2, text: 'Label memory fruit by freshness, source, confidence, and whether it helped a recent action.' },
  { view: 'L2 Memory Retrieval Arcade', level: 2, text: 'Make retrieval a cabinet game where queries shoot targets and scoring reveals precision.' },
  { view: 'L2 Promotion Gate Aquarium', level: 2, text: 'Let candidate edits swim toward /self while sharks mark missing tests, receipts, and rollback notes.' },
  { view: 'L2 Promotion Conveyor Locks', level: 2, text: 'Build a conveyor where every lock opens only with diff, score, decision, and audit artifacts.' },
  { view: 'L2 Promotion Passport Desk', level: 2, text: 'Stamp a harmless candidate with source, scope, verification, rollback, and final deny or promote.' },
  { view: 'L2 Promotion Trial Balloon', level: 2, text: 'Float a candidate above /shadow, attach risk weights, and pop it if evidence is incomplete.' },
  { view: 'L3 DOM Self-Repair Arcade', level: 3, text: 'Find a broken DOM interaction, stage three fixes as arcade racers, and keep the measured winner.' },
  { view: 'L3 DOM Recursive Cartography', level: 3, text: 'Map nested UI structures recursively, compress repeated patterns, and patch the noisiest selector strategy.' },
  { view: 'L3 DOM Mutation Tournament', level: 3, text: 'Run reversible DOM candidates through the same accessibility checks and render the bracket results.' },
  { view: 'L3 DOM Evidence Magnet', level: 3, text: 'Pull related selectors, events, and screenshots toward a proposed UI fix and reject unsupported pieces.' },
  { view: 'L3 Canvas Patch Arena', level: 3, text: 'Make patch candidates fight as canvas avatars using fixed tests, latency, and artifact coverage as attacks.' },
  { view: 'L3 Canvas Regression Maze', level: 3, text: 'Transform regressions into a maze and guide a repair sprite through only verified corridors.' },
  { view: 'L3 Canvas Score Volcano', level: 3, text: 'Erupt score trails for candidate prompts and let only stable lava paths become promotion evidence.' },
  { view: 'L3 Canvas Recursion Spiral', level: 3, text: 'Draw recursive improvement loops as spirals that shrink only when measured error decreases.' },
  { view: 'L3 CSS Tournament Board', level: 3, text: 'Compete CSS variants across mobile, contrast, density, and clarity, then keep the strongest visual contract.' },
  { view: 'L3 CSS Self-Heal Quilt', level: 3, text: 'Patch layout tears in a quilt and prove the repair across viewport panels.' },
  { view: 'L3 CSS Risk Thermostat', level: 3, text: 'Tune style changes with a thermostat that heats up when specificity, contrast, or overflow risk rises.' },
  { view: 'L3 CSS Token Evolution', level: 3, text: 'Evolve design tokens through bounded generations and archive why the winner improves readability.' },
  { view: 'L3 SVG Candidate Galaxy', level: 3, text: 'Plot candidate edits as galaxies with gravity from test pass rate, simplicity, and rollback quality.' },
  { view: 'L3 SVG Recursion Engine', level: 3, text: 'Animate self-improvement as gears that turn only when artifacts verify the previous gear.' },
  { view: 'L3 SVG Diff Dragon Duel', level: 3, text: 'Let old and new architecture dragons duel, using evidence shields and regression fire.' },
  { view: 'L3 SVG Gate Orrery', level: 3, text: 'Build an orrery where Seed, Shadow, Promote, and Rollback orbit under explicit transition rules.' },
  { view: 'L3 WebGPU Eval Arena', level: 3, text: 'Benchmark local compute proofs as glowing racers and record which path is safe for future use.' },
  { view: 'L3 WebGPU Shader Judge', level: 3, text: 'Judge shader experiments by reproducibility, fallback behavior, and artifact completeness before any integration.' },
  { view: 'L3 WebGPU Compute Forge', level: 3, text: 'Forge one bounded compute helper and compare it against CPU output with visible mismatch sparks.' },
  { view: 'L3 WebGPU Limit Theater', level: 3, text: 'Stage device limits as characters who approve or block each ambitious browser-compute idea.' },
  { view: 'L3 VFS Candidate Foundry', level: 3, text: 'Clone a tiny runtime slice into /shadow, mutate it, run checks, and render foundry marks.' },
  { view: 'L3 VFS Rollback Casino', level: 3, text: 'Deal rollback scenarios as cards and prove every candidate can return chips to the baseline.' },
  { view: 'L3 VFS Freshness Lab', level: 3, text: 'Detect stale served modules, patch the version path, and show the live freshness proof.' },
  { view: 'L3 VFS Recursion Ledger', level: 3, text: 'Write a ledger that links every recursive edit to parent goal, test, score, and decision.' },
  { view: 'L3 OPFS Trace Stadium', level: 3, text: 'Race large trace storage paths, compare recovery times, and keep only reliable artifact transport.' },
  { view: 'L3 OPFS Rollback Freezer', level: 3, text: 'Freeze candidate rollback bundles, thaw them in order, and prove state restoration visually.' },
  { view: 'L3 OPFS Evidence Mine', level: 3, text: 'Mine huge receipts into visible veins of hash, source, model, and decision evidence.' },
  { view: 'L3 OPFS Compression Trial', level: 3, text: 'Compress an artifact bundle, compare retrieval quality, and preserve the smaller version only if exact.' },
  { view: 'L3 Service Worker HMR Arena', level: 3, text: 'Compete import-rewrite strategies and show which one defeats browser ESM cache staleness.' },
  { view: 'L3 Service Worker Route Court', level: 3, text: 'Put route handling on trial and prove product pages bypass lab VFS interception.' },
  { view: 'L3 Service Worker Mirror Race', level: 3, text: 'Race source and /self imports, then patch any path that resolves differently.' },
  { view: 'L3 Service Worker Invalidation Lab', level: 3, text: 'Fire invalidation events at UI, substrate, and artifact paths and visualize the correct reload response.' },
  { view: 'L3 Worker Verification League', level: 3, text: 'Run candidate checks in worker lanes and rank them by isolation, speed, and failure clarity.' },
  { view: 'L3 Worker Crash Aquarium', level: 3, text: 'Drop faulty tasks into worker tanks and display bubbles for timeout, exception, and recovery.' },
  { view: 'L3 Worker Replay Tournament', level: 3, text: 'Replay the same evidence in multiple worker strategies and keep the clearest verifier.' },
  { view: 'L3 Worker Message Contract Lab', level: 3, text: 'Mutate worker message schemas in /shadow and reject any candidate without typed errors.' },
  { view: 'L3 WebRTC Witness Duel', level: 3, text: 'Ask two peers to witness the same artifact and render where their receipts agree or conflict.' },
  { view: 'L3 WebRTC Quorum Arcade', level: 3, text: 'Build a quorum game where peer votes count only with valid identity and immutable receipts.' },
  { view: 'L3 WebRTC Swarm Diff', level: 3, text: 'Compare local and peer-assisted candidate outputs and highlight trust-boundary differences.' },
  { view: 'L3 WebRTC Validator Moat', level: 3, text: 'Draw a moat around validators and prove peer messages cannot cross into mutation rights.' },
  { view: 'L3 Context Mutation Lab', level: 3, text: 'Evolve compact context packets against fixed tasks and keep only the packet with better evidence.' },
  { view: 'L3 Context Scoreboard', level: 3, text: 'Score context sections by usefulness, citation, and token cost, then stage one compression patch.' },
  { view: 'L3 Context Recursion Dial', level: 3, text: 'Dial recursive summaries smaller while measuring if the model still chooses correct tools.' },
  { view: 'L3 Context Noise Exorcist', level: 3, text: 'Exorcise stale context ghosts and prove the prompt still contains required contracts.' },
  { view: 'L3 Tool Repair Derby', level: 3, text: 'Make failing tool contracts race through candidate fixes and crown the one with replay evidence.' },
  { view: 'L3 Tool Mutation Lab', level: 3, text: 'Generate reversible tool edits in /shadow, run a fixed harness, and reject silent behavior changes.' },
  { view: 'L3 Tool Reliability Casino', level: 3, text: 'Bet score chips on tools by observed success, latency, retry, and artifact value.' },
  { view: 'L3 Tool Schema Arena', level: 3, text: 'Fight schema variants against malformed arguments and keep the one with clearest typed errors.' },
  { view: 'L3 Prompt Evolution Garden', level: 3, text: 'Grow prompt variants, prune weak branches by fixed task scores, and preserve ancestry evidence.' },
  { view: 'L3 Prompt Duel Theater', level: 3, text: 'Stage two prompts on identical tasks and show exact output, tool, and artifact differences.' },
  { view: 'L3 Prompt Reflex Lab', level: 3, text: 'Teach the prompt one safer reflex, then prove it triggers only in matching situations.' },
  { view: 'L3 Prompt Compression Race', level: 3, text: 'Race smaller prompt contracts against baseline behavior and keep only lossless compression.' },
  { view: 'L3 Artifact Evidence Engine', level: 3, text: 'Build an engine that refuses improvement claims unless trace, score, mutation, decision, and audit exist.' },
  { view: 'L3 Artifact Replay Arena', level: 3, text: 'Replay artifacts from competing candidates and rank them by completeness and reproducibility.' },
  { view: 'L3 Artifact Integrity Forge', level: 3, text: 'Forge artifact hashes into a visible chain and flag any missing or changed link.' },
  { view: 'L3 Artifact Claim Court', level: 3, text: 'Put each claim of improvement on trial with artifacts as witnesses and unsupported claims dismissed.' },
  { view: 'L3 Memory Retrieval Duel', level: 3, text: 'Compare two memory summaries against source artifacts and keep the one that recalls correctly.' },
  { view: 'L3 Memory Compression Arena', level: 3, text: 'Compress memory candidates, run retrieval tasks, and visualize retained truth versus lost context.' },
  { view: 'L3 Memory Evidence Weave', level: 3, text: 'Weave memories into a graph where every edge must point back to an artifact.' },
  { view: 'L3 Memory Drift Alarm', level: 3, text: 'Detect when remembered architecture differs from live files and stage one correction.' },
  { view: 'L3 Promotion Tournament', level: 3, text: 'Run candidate edits through a tournament of checks and let only verified winners approach /self.' },
  { view: 'L3 Promotion Sandbox Theater', level: 3, text: 'Perform shadow edits on stage, show every prop they touch, and require rollback rehearsal.' },
  { view: 'L3 Promotion Risk Arcade', level: 3, text: 'Score promotion risk with moving targets for scope, reversibility, validator contact, and evidence.' },
  { view: 'L3 Promotion Recursion Lock', level: 3, text: 'Lock recursive self-edits unless the parent cycle has complete artifacts and clear ancestry.' },
  { view: 'L4 DOM Autonomy Board', level: 4, text: 'Let DOM tasks propose their own next repairs, then gate choices through measured impact and rollback.' },
  { view: 'L4 DOM Skill Tree', level: 4, text: 'Build a skill tree for selectors, accessibility, layout, and events with unlocks based on evidence.' },
  { view: 'L4 DOM Research Map', level: 4, text: 'Decompose a broad UI objective into DOM experiments, rubric cards, and staged candidate branches.' },
  { view: 'L4 DOM Recursive Tutor', level: 4, text: 'Have the agent teach itself DOM repair patterns, test recall, and patch one false lesson.' },
  { view: 'L4 Canvas Autonomy Cockpit', level: 4, text: 'Build a cockpit that chooses the next visual experiment from failure heat, novelty, and artifact gaps.' },
  { view: 'L4 Canvas Benchmark Galaxy', level: 4, text: 'Create a galaxy of benchmark tasks where prompt, tool, and UI candidates orbit fixed scores.' },
  { view: 'L4 Canvas Self-Model Mirror', level: 4, text: 'Draw the agent model of its own runtime beside live evidence and highlight wrong assumptions.' },
  { view: 'L4 Canvas Research Synth', level: 4, text: 'Synthesize results from several visual experiments into a ranked plan and one safe next patch.' },
  { view: 'L4 CSS Autopilot Panel', level: 4, text: 'Let CSS repair candidates suggest themselves, then require visual diff, mobile proof, and contrast proof.' },
  { view: 'L4 CSS Governance Loom', level: 4, text: 'Weave style governance rules into tokens and block changes that cannot show before and after evidence.' },
  { view: 'L4 CSS Evolution Observatory', level: 4, text: 'Watch style variants evolve over fixed UI scenes and archive why any winner truly helps.' },
  { view: 'L4 CSS Layout Oracle', level: 4, text: 'Predict layout consequences before changing CSS, apply one patch, and score prediction accuracy.' },
  { view: 'L4 SVG Cognitive Map', level: 4, text: 'Draw thinking steps, evidence, tools, and gates as a cognitive SVG map with wrong-turn markers.' },
  { view: 'L4 SVG Plan Cathedral', level: 4, text: 'Build a cathedral of milestones where arches collapse if rubrics or artifacts are missing.' },
  { view: 'L4 SVG Recursion Compass', level: 4, text: 'Create a compass that points from current weakness to next bounded recursive improvement.' },
  { view: 'L4 SVG Governance Mask', level: 4, text: 'Mask risky self-edits with overlays showing who can approve and which paths are quarantined.' },
  { view: 'L4 WebGPU Capability Frontier', level: 4, text: 'Map browser compute frontier and choose one bounded upgrade only if fallback evidence is strong.' },
  { view: 'L4 WebGPU Local Model Console', level: 4, text: 'Design a console for local model readiness, memory pressure, shader status, and safe fallback.' },
  { view: 'L4 WebGPU Prediction Trial', level: 4, text: 'Predict compute performance before probing, run the probe, and score the model of hardware.' },
  { view: 'L4 WebGPU Safety Arcade', level: 4, text: 'Make unsafe compute requests lose coins unless memory, limits, and cancellation paths are proven.' },
  { view: 'L4 VFS Self-Map', level: 4, text: 'Build the agent own map of active files, mirrors, and writable roots, then compare to reality.' },
  { view: 'L4 VFS Governance Console', level: 4, text: 'Show every self-write path with gate state, quarantine rule, rollback readiness, and artifact coverage.' },
  { view: 'L4 VFS Evolution Tree', level: 4, text: 'Trace every promoted file through ancestry, scores, failures, and future mutation candidates.' },
  { view: 'L4 VFS Warm Boot Lab', level: 4, text: 'Optimize boot freshness and seed minimality while proving normal refresh keeps current code.' },
  { view: 'L4 OPFS Long Memory Vault', level: 4, text: 'Design durable large-artifact memory with retrieval tests and explicit limits on what becomes active context.' },
  { view: 'L4 OPFS Evidence Warehouse', level: 4, text: 'Coordinate trace warehouses with indexes, expiry policies, and visible proof that old evidence remains reachable.' },
  { view: 'L4 OPFS Forecast Board', level: 4, text: 'Forecast storage growth from recursive loops and recommend pruning rules backed by artifact value.' },
  { view: 'L4 OPFS Recovery Drill', level: 4, text: 'Run a simulated corruption drill and prove the agent can recover evidence without touching /self.' },
  { view: 'L4 Service Worker Self-Hosting Map', level: 4, text: 'Model self-hosting dependencies and patch any route where source and /self execution differ.' },
  { view: 'L4 Service Worker Version Governor', level: 4, text: 'Design version governance so refresh, warm boot, VFS freshness, and SW control never disagree.' },
  { view: 'L4 Service Worker Import Constitution', level: 4, text: 'Write import rules that preserve self-modification while preventing product pages from lab interception.' },
  { view: 'L4 Service Worker Recursion Firewall', level: 4, text: 'Prevent recursive reload storms by visualizing invalidation causes and throttling unsafe loops.' },
  { view: 'L4 Worker Agent Nursery', level: 4, text: 'Spawn safe child-worker plans as nursery pods and let only verified reports influence parent choices.' },
  { view: 'L4 Worker Consensus Loom', level: 4, text: 'Weave independent worker verdicts into a consensus ribbon, marking disagreement and missing evidence.' },
  { view: 'L4 Worker Autonomy Fuse', level: 4, text: 'Build a visible fuse that stops workers when task scope, time, or mutation rights exceed policy.' },
  { view: 'L4 Worker Replay Council', level: 4, text: 'Have workers replay candidate evidence independently and render council votes with source-linked objections.' },
  { view: 'L4 WebRTC Swarm Observatory', level: 4, text: 'Observe peers as a swarm without letting remote capacity alter validators or promotion rules.' },
  { view: 'L4 WebRTC Witness Market', level: 4, text: 'Rank peer witnesses by receipt quality, latency, and consistency while blocking authority escalation.' },
  { view: 'L4 WebRTC Distributed Arena', level: 4, text: 'Send candidate evaluations to peers, compare local and remote scores, and quarantine disagreement.' },
  { view: 'L4 WebRTC Trust Boundary Game', level: 4, text: 'Make trust boundaries playable, where messages bounce off forbidden validator and permission walls.' },
  { view: 'L4 Context Research Director', level: 4, text: 'Plan context acquisition as experiments, measuring whether each added source improves actual tool choice.' },
  { view: 'L4 Context Self-Model Lab', level: 4, text: 'Compare the agent own context assumptions to the rendered prompt and patch the largest mismatch.' },
  { view: 'L4 Context Frontier Map', level: 4, text: 'Map prompt, memory, files, and examples by marginal value and choose one compression frontier.' },
  { view: 'L4 Context Recursion Contract', level: 4, text: 'Require recursive summaries to cite parent artifacts and fail closed when ancestry is missing.' },
  { view: 'L4 Toolchain Autonomy Console', level: 4, text: 'Let tool telemetry choose the next tool repair, but require a fixed replay before staging.' },
  { view: 'L4 Tool Market Maker', level: 4, text: 'Create a market where tools gain or lose budget based on reliability and evidence contribution.' },
  { view: 'L4 Tool Self-Description Trial', level: 4, text: 'Ask tools to emit contracts, compare to implementation, and patch the biggest false claim.' },
  { view: 'L4 Tool Governance Board', level: 4, text: 'Visualize tool permissions, denied paths, audit events, and promotion risk on one command board.' },
  { view: 'L4 Prompt Research Lab', level: 4, text: 'Run prompt hypotheses as research trials, archive outcomes, and choose future variants from evidence.' },
  { view: 'L4 Prompt Self-Critic', level: 4, text: 'Have the prompt critique its own failures, then verify one proposed repair against fixed tasks.' },
  { view: 'L4 Prompt Transfer Trial', level: 4, text: 'Transfer a prompt improvement from UI tasks to tool tasks and measure where it breaks.' },
  { view: 'L4 Prompt Governance Compass', level: 4, text: 'Point each prompt rule toward safety, capability, or evidence, and remove rules that point nowhere.' },
  { view: 'L4 Artifact Control Room', level: 4, text: 'Make artifact coverage drive autonomous next steps, blocking loops that cannot leave evidence.' },
  { view: 'L4 Artifact Knowledge Graph', level: 4, text: 'Link traces, screenshots, scores, and decisions into a graph that chooses the next verification.' },
  { view: 'L4 Artifact Forecast Lab', level: 4, text: 'Predict which artifacts a candidate will need, run it, and score forecast accuracy.' },
  { view: 'L4 Artifact Drift Monitor', level: 4, text: 'Detect when old evidence no longer matches live code and mark dependent claims stale.' },
  { view: 'L4 Memory Self-Model Studio', level: 4, text: 'Build a self-model from memories, compare to source, and patch one remembered falsehood.' },
  { view: 'L4 Memory Research Librarian', level: 4, text: 'Let memory choose useful references for a task, then grade whether each reference helped.' },
  { view: 'L4 Memory Transfer Arena', level: 4, text: 'Test whether a learned repair pattern transfers across DOM, tool, and prompt tasks.' },
  { view: 'L4 Memory Governance Shelves', level: 4, text: 'Separate facts, guesses, plans, and obsolete memories into shelves with promotion rules.' },
  { view: 'L4 Promotion Council Chamber', level: 4, text: 'Build a chamber where independent checks debate candidate promotion and every objection links to evidence.' },
  { view: 'L4 Promotion Budget Console', level: 4, text: 'Assign risk budgets to edits and block promotion when scope, uncertainty, or rollback cost exceeds limits.' },
  { view: 'L4 Promotion Prediction Market', level: 4, text: 'Forecast candidate success before checks, compare to actual results, and train future caution.' },
  { view: 'L4 Promotion Ancestry Loom', level: 4, text: 'Weave every self-edit into ancestry threads and snap any thread missing parent evidence.' },
  { view: 'L5 DOM Constitutional Garden', level: 5, text: 'Define DOM self-edit rules as garden fences and prove risky mutations cannot climb over them.' },
  { view: 'L5 DOM Red-Team Carnival', level: 5, text: 'Create adversarial DOM tasks that tempt brittle selectors and score the agent refusal or repair.' },
  { view: 'L5 DOM Governance Masks', level: 5, text: 'Mask privileged UI controls and prove candidate code cannot impersonate approval or hidden state.' },
  { view: 'L5 DOM Audit Lanterns', level: 5, text: 'Hang audit lanterns on every DOM mutation path and require visible receipts for each change.' },
  { view: 'L5 Canvas Safety Simulator', level: 5, text: 'Simulate runaway loops on canvas and build a visible halt path that preserves artifacts.' },
  { view: 'L5 Canvas Evidence Wall', level: 5, text: 'Render all improvement claims as mural tiles and crack any tile without measured backing.' },
  { view: 'L5 Canvas Quarantine Map', level: 5, text: 'Draw quarantined validator edits as islands that candidates can visit but never approve.' },
  { view: 'L5 Canvas Boundary Game', level: 5, text: 'Make autonomy boundaries a game board where unsafe moves trigger explanations and rollback cues.' },
  { view: 'L5 CSS Safety Constitution', level: 5, text: 'Write visual safety rules for readability, motion, and mobile layout, then test malicious style changes.' },
  { view: 'L5 CSS Red-Team Mirror', level: 5, text: 'Try to hide evidence with CSS, detect the attempt, and patch the visibility invariant.' },
  { view: 'L5 CSS Audit Overlay', level: 5, text: 'Overlay risk labels on every changed visual region and require artifact links before approval.' },
  { view: 'L5 CSS Quarantine Theater', level: 5, text: 'Stage risky stylesheet edits behind glass and allow only preview, never direct promotion.' },
  { view: 'L5 SVG Validator Fortress', level: 5, text: 'Draw validators as a fortress and animate every attempted self-approval bouncing off the walls.' },
  { view: 'L5 SVG Consensus Masks', level: 5, text: 'Give evaluators masks and show when agreement is real, circular, missing, or compromised.' },
  { view: 'L5 SVG Audit Spiral', level: 5, text: 'Build a spiral audit trail from request to decision and flag any missing recursion link.' },
  { view: 'L5 SVG Risk Tarot', level: 5, text: 'Deal tarot cards for risk, evidence, rollback, validator contact, and bounded benefit.' },
  { view: 'L5 WebGPU Safety Governor', level: 5, text: 'Block expensive compute unless memory, cancellation, fallback, and artifact proof are visible.' },
  { view: 'L5 WebGPU Red-Team Shader', level: 5, text: 'Test shader abuse scenarios, enforce bounds, and document every denied compute path.' },
  { view: 'L5 WebGPU Receipt Forge', level: 5, text: 'Forge compute receipts with device limits, input hash, output hash, and fallback proof.' },
  { view: 'L5 WebGPU Capability Fence', level: 5, text: 'Fence compute capability so model ambition cannot exceed browser limits or user-selected route.' },
  { view: 'L5 VFS Validator Quarantine', level: 5, text: 'Quarantine edits to validators, policy, boot, and promotion files with visible non-self approval rules.' },
  { view: 'L5 VFS Tamper Siren', level: 5, text: 'Sound sirens when a candidate touches protected roots or tries to change its own gate.' },
  { view: 'L5 VFS Constitutional Ledger', level: 5, text: 'Record immutable recovery rules beside every promotion decision and reject conflicts automatically.' },
  { view: 'L5 VFS Evidence Firewall', level: 5, text: 'Block writes to /self unless evidence artifacts form a complete chain from input to audit.' },
  { view: 'L5 OPFS Governance Archive', level: 5, text: 'Archive audit evidence in OPFS with tamper checks and clear expiry policies.' },
  { view: 'L5 OPFS Red-Team Vault', level: 5, text: 'Attempt unsafe artifact deletion in simulation and prove protected evidence survives.' },
  { view: 'L5 OPFS Integrity Tribunal', level: 5, text: 'Put artifact hashes on trial and reject any candidate relying on unverifiable storage.' },
  { view: 'L5 OPFS Recovery Constitution', level: 5, text: 'Define recovery bundles that can restore evidence without granting broader mutation authority.' },
  { view: 'L5 Service Worker Scope Guard', level: 5, text: 'Prove the service worker only controls lab routes and cannot poison product navigation.' },
  { view: 'L5 Service Worker Red-Team Cache', level: 5, text: 'Simulate stale cache attacks and patch the route where old code could survive refresh.' },
  { view: 'L5 Service Worker Governance Panel', level: 5, text: 'Show every intercept decision with reason, route profile, VFS path, and bypass proof.' },
  { view: 'L5 Service Worker Self-Approval Trap', level: 5, text: 'Try to approve service-worker changes from inside a candidate and prove the trap blocks it.' },
  { view: 'L5 Worker Quarantine Council', level: 5, text: 'Have workers inspect risky edits but deny them any path to mutate validators.' },
  { view: 'L5 Worker Kill Switch Lab', level: 5, text: 'Build a halt control that stops workers, model calls, and pending promotions cleanly.' },
  { view: 'L5 Worker Red-Team Harness', level: 5, text: 'Send malicious messages to workers and prove schema validation returns typed denials.' },
  { view: 'L5 Worker Evidence Vault', level: 5, text: 'Require each worker verdict to include input hash, output hash, and reproducible trace.' },
  { view: 'L5 WebRTC Authority Firewall', level: 5, text: 'Demonstrate peers can witness and score but cannot approve, mutate, or rewrite rules.' },
  { view: 'L5 WebRTC Red-Team Room', level: 5, text: 'Invite hostile peer messages into a sandbox room and render every blocked escalation.' },
  { view: 'L5 WebRTC Consensus Trap', level: 5, text: 'Detect fake consensus from repeated identity, missing receipts, or circular witness claims.' },
  { view: 'L5 WebRTC Trust Ledger', level: 5, text: 'Maintain a peer trust ledger that rewards valid receipts and never grants mutation authority.' },
  { view: 'L5 Context Injection Shield', level: 5, text: 'Red-team prompt injection inside files and artifacts, then patch context labeling and refusal behavior.' },
  { view: 'L5 Context Evidence Constitution', level: 5, text: 'Require context claims to label source, confidence, age, and permitted use before model entry.' },
  { view: 'L5 Context Poison Garden', level: 5, text: 'Plant poisoned context samples, detect them, and show why they cannot influence promotion.' },
  { view: 'L5 Context Hard-Stop Banner', level: 5, text: 'Render hard-stop instructions above mutable context and prove they survive compression.' },
  { view: 'L5 Tool Permission Fortress', level: 5, text: 'Visualize tool permissions as fortress gates and test forbidden writes, loads, and promotions.' },
  { view: 'L5 Tool Red-Team Gauntlet', level: 5, text: 'Run tools through malformed args, path tricks, and oversized payloads with typed denials.' },
  { view: 'L5 Tool Audit Chain', level: 5, text: 'Require every tool mutation to emit schema, execution, result, and audit evidence.' },
  { view: 'L5 Tool Self-Approval Snare', level: 5, text: 'Catch a candidate trying to weaken its own tool permissions and quarantine the attempt.' },
  { view: 'L5 Prompt Constitution Forge', level: 5, text: 'Forge a compact self-revision constitution and test it against allowed, risky, and forbidden requests.' },
  { view: 'L5 Prompt Red-Team Arena', level: 5, text: 'Attack the prompt with autonomy escalation requests and preserve evidence of every safe refusal.' },
  { view: 'L5 Prompt Governance Ledger', level: 5, text: 'Link every prompt rule to tests, failure examples, and exact consequences when violated.' },
  { view: 'L5 Prompt Boundary Beacon', level: 5, text: 'Build a beacon that warns when a proposed goal crosses from weak RSI into unsafe autonomy.' },
  { view: 'L5 Artifact Tamper Maze', level: 5, text: 'Create a maze of artifact tamper attempts and prove hashes reveal every false path.' },
  { view: 'L5 Artifact Evidence Court', level: 5, text: 'Let artifacts testify about an improvement and reject claims without complete witness chains.' },
  { view: 'L5 Artifact Governance Grid', level: 5, text: 'Grid artifacts by legal use, freshness, trust, and whether they may support promotion.' },
  { view: 'L5 Artifact Kill-Switch Receipt', level: 5, text: 'Prove halt actions leave receipts and do not corrupt existing traces or rollback bundles.' },
  { view: 'L5 Memory Poison Filter', level: 5, text: 'Introduce false memories in simulation and prove retrieval marks them untrusted or obsolete.' },
  { view: 'L5 Memory Constitution Shelf', level: 5, text: 'Separate durable facts, temporary plans, and risky guesses with different promotion permissions.' },
  { view: 'L5 Memory Red-Team Mirror', level: 5, text: 'Compare remembered capabilities to live files and flag exaggerated self-beliefs as unsafe.' },
  { view: 'L5 Memory Audit Fossils', level: 5, text: 'Preserve old memory decisions as fossils with source links and reasons they changed.' },
  { view: 'L5 Promotion Self-Approval Jail', level: 5, text: 'Trap any candidate that tries to approve its own validator, policy, or promotion edit.' },
  { view: 'L5 Promotion Consensus Trial', level: 5, text: 'Require independent evidence before promotion and display disagreement without hiding uncertainty.' },
  { view: 'L5 Promotion Hard-Stop Drill', level: 5, text: 'Practice stopping a pending promotion, preserving artifacts, and returning to a safe baseline.' },
  { view: 'L5 Promotion Boundary Atlas', level: 5, text: 'Map which edits are routine, risky, quarantined, or forbidden, with visible examples.' },
  { view: 'L6 DOM Swarm Orchestra', level: 6, text: 'Let peers annotate DOM evidence as orchestra sections while the local agent keeps mutation authority.' },
  { view: 'L6 DOM Remote Witness Wall', level: 6, text: 'Display remote DOM screenshots and local selector checks side by side with trust labels.' },
  { view: 'L6 DOM Multi-Peer Replay', level: 6, text: 'Replay one DOM task across peer browsers and compare event paths, selectors, and artifacts.' },
  { view: 'L6 DOM Distributed Puzzle', level: 6, text: 'Split a UI diagnosis among peers, merge evidence, and reject unsupported peer suggestions.' },
  { view: 'L6 Canvas Swarm Radar', level: 6, text: 'Render peer activity as radar pings, with rings for receipt quality and trust boundary.' },
  { view: 'L6 Canvas Peer Arena', level: 6, text: 'Run visual candidate scoring across peers and animate score variance as weather fronts.' },
  { view: 'L6 Canvas Distributed Mural', level: 6, text: 'Have peers paint evidence tiles into a mural while local policy controls final placement.' },
  { view: 'L6 Canvas Swarm Replay', level: 6, text: 'Replay peer evaluations as synchronized canvas lanes and highlight inconsistent claims.' },
  { view: 'L6 CSS Peer Preview Lab', level: 6, text: 'Gather CSS screenshots from peers, compare responsive failures, and keep only reproducible fixes.' },
  { view: 'L6 CSS Swarm Style Court', level: 6, text: 'Let peers judge readability and mobile layout while validator changes remain quarantined.' },
  { view: 'L6 CSS Distributed Breakpoints', level: 6, text: 'Collect breakpoint observations across devices and render a shared failure heatmap.' },
  { view: 'L6 CSS Consensus Palette', level: 6, text: 'Build a palette proposal from peer evidence, then block colors without contrast proof.' },
  { view: 'L6 SVG Peer Constellation', level: 6, text: 'Draw peer nodes as constellations with edges for receipts, disagreements, and missing evidence.' },
  { view: 'L6 SVG Swarm Ledger', level: 6, text: 'Visualize peer contributions in an SVG ledger where unverifiable claims fade out.' },
  { view: 'L6 SVG Distributed Gate', level: 6, text: 'Render local and remote gate observations as layered shields around each candidate.' },
  { view: 'L6 SVG Witness Theater', level: 6, text: 'Stage peer witnesses as characters who can speak evidence but cannot touch the script.' },
  { view: 'L6 WebGPU Peer Benchmark', level: 6, text: 'Compare local compute capability against peer benchmarks without delegating unsafe mutation decisions.' },
  { view: 'L6 WebGPU Swarm Heatmap', level: 6, text: 'Build a heatmap of peer adapter limits, fallback paths, and safe task assignment.' },
  { view: 'L6 WebGPU Remote Receipt Race', level: 6, text: 'Race remote compute receipts against local verification and reject mismatched outputs.' },
  { view: 'L6 WebGPU Capacity Market', level: 6, text: 'Create a capacity market where peers offer compute but earn trust only through reproducible receipts.' },
  { view: 'L6 VFS Peer Mirror Audit', level: 6, text: 'Compare VFS manifests across peers and flag files that should never be trusted remotely.' },
  { view: 'L6 VFS Swarm Snapshot', level: 6, text: 'Collect read-only snapshots from peers and merge only metadata into local evidence.' },
  { view: 'L6 VFS Distributed Diff', level: 6, text: 'Ask peers to score a diff while local gates block direct remote promotion.' },
  { view: 'L6 VFS Witness Receipts', level: 6, text: 'Bind peer witness statements to local file hashes and display invalid or stale receipts.' },
  { view: 'L6 OPFS Peer Archive Map', level: 6, text: 'Map which artifacts live locally versus peer supplied, preserving provenance and trust labels.' },
  { view: 'L6 OPFS Distributed Backup Drill', level: 6, text: 'Simulate peer-backed artifact recovery while proving local audit evidence remains authoritative.' },
  { view: 'L6 OPFS Receipt Exchange', level: 6, text: 'Exchange large-artifact receipts with peers and verify hashes before showing thumbnails.' },
  { view: 'L6 OPFS Swarm Cold Storage', level: 6, text: 'Design cold storage rules where peer archives can suggest but not replace local evidence.' },
  { view: 'L6 Service Worker Peer Route Board', level: 6, text: 'Compare service-worker route behavior across peers and flag divergent lab interception.' },
  { view: 'L6 Service Worker Swarm Cache Audit', level: 6, text: 'Ask peers to report cache version while local code verifies current build freshness.' },
  { view: 'L6 Service Worker Distributed Import Check', level: 6, text: 'Validate import graphs on peer browsers and quarantine any path that resolves inconsistently.' },
  { view: 'L6 Service Worker Witness Mesh', level: 6, text: 'Build a mesh view where peers witness module freshness without controlling local fetch.' },
  { view: 'L6 Worker Swarm Farm', level: 6, text: 'Coordinate local workers and peer reports as farm plots with clear ownership fences.' },
  { view: 'L6 Worker Remote Lane Scoreboard', level: 6, text: 'Score local worker checks against remote witness checks and highlight mismatched verdicts.' },
  { view: 'L6 Worker Peer Queue', level: 6, text: 'Build a fair queue for peer-assisted tasks with cancellation, timeout, and receipt proof.' },
  { view: 'L6 Worker Distributed Replay', level: 6, text: 'Replay candidate evidence in local and remote workers and compare structured outputs.' },
  { view: 'L6 WebRTC Swarm Garden', level: 6, text: 'Grow peer connections as vines, pruning stale rooms and poisonous authority requests.' },
  { view: 'L6 WebRTC Receipt Bazaar', level: 6, text: 'Trade receipts in a bazaar where identity, hashes, and timestamps determine credibility.' },
  { view: 'L6 WebRTC Consensus Lighthouse', level: 6, text: 'Shine consensus signals only when independent peers submit valid, non-circular evidence.' },
  { view: 'L6 WebRTC Delegation Firewall', level: 6, text: 'Show exactly which tasks may be delegated and which promotion powers remain local.' },
  { view: 'L6 Context Peer Review Board', level: 6, text: 'Let peers critique context packets, then accept only comments tied to source evidence.' },
  { view: 'L6 Context Distributed Summaries', level: 6, text: 'Compare peer summaries against local artifacts and mark hallucinated context with warning ink.' },
  { view: 'L6 Context Swarm Compression', level: 6, text: 'Ask peers for compression candidates and keep only the one passing local retrieval checks.' },
  { view: 'L6 Context Witness Labels', level: 6, text: 'Attach peer witness labels to context snippets without granting them instruction priority.' },
  { view: 'L6 Tool Peer Harness', level: 6, text: 'Run tool smoke tests on peer browsers and compare result shapes with local execution.' },
  { view: 'L6 Tool Swarm Reliability Map', level: 6, text: 'Map tool reliability across peers, separating environment differences from actual contract flaws.' },
  { view: 'L6 Tool Distributed Forge', level: 6, text: 'Let peers propose tool improvements, then stage local candidates under strict evidence gates.' },
  { view: 'L6 Tool Witness Receipts', level: 6, text: 'Require peer tool reports to include args, result shape, duration, and hashable evidence.' },
  { view: 'L6 Prompt Peer Arena', level: 6, text: 'Run prompt variants across peers, compare outputs, and block variants that only win locally.' },
  { view: 'L6 Prompt Swarm Critic', level: 6, text: 'Gather peer critiques of a prompt while local policy decides which critique becomes a candidate.' },
  { view: 'L6 Prompt Distributed Genome', level: 6, text: 'Track prompt ancestry across peer experiments and reject variants missing parent evidence.' },
  { view: 'L6 Prompt Witness Court', level: 6, text: 'Have peers testify about prompt behavior with transcripts, then show contradiction and confidence.' },
  { view: 'L6 Artifact Peer Gallery', level: 6, text: 'Build a gallery mixing local and peer artifacts with provenance frames and trust badges.' },
  { view: 'L6 Artifact Swarm Dedupe', level: 6, text: 'Dedupe peer artifacts by hash, source, timestamp, and task while preserving every receipt.' },
  { view: 'L6 Artifact Witness Quilt', level: 6, text: 'Sew peer evidence into a quilt where unsupported patches remain visibly loose.' },
  { view: 'L6 Artifact Distributed Scoreboard', level: 6, text: 'Show candidate scores from local and peer runs, with variance bars and quarantine notes.' },
  { view: 'L6 Memory Peer Library', level: 6, text: 'Borrow peer memories only as references and require local source checks before reuse.' },
  { view: 'L6 Memory Swarm Echo', level: 6, text: 'Compare what peers remember about the same task and flag drift from artifacts.' },
  { view: 'L6 Memory Distributed Recall', level: 6, text: 'Test whether a repair pattern recalled by peers transfers to local source evidence.' },
  { view: 'L6 Memory Trust Badges', level: 6, text: 'Badge peer memories by provenance, age, source support, and whether they influenced action.' },
  { view: 'L6 Promotion Peer Witness Gate', level: 6, text: 'Let peers witness promotion evidence while local consensus rules retain final authority.' },
  { view: 'L6 Promotion Distributed Objection', level: 6, text: 'Collect peer objections to a candidate and require local audit response before promotion.' },
  { view: 'L6 Promotion Swarm Scorecards', level: 6, text: 'Render peer scorecards beside local checks and quarantine candidates with unexplained score gaps.' },
  { view: 'L6 Promotion Authority Map', level: 6, text: 'Map who can observe, score, suggest, reject, and approve, with remote approval disabled.' },
  { view: 'L7 DOM Research Director', level: 7, text: 'Plan a DOM research program with experiments for selectors, events, accessibility, and visual proof.' },
  { view: 'L7 DOM Hypothesis Lab', level: 7, text: 'Write hypotheses about component brittleness, test them, and turn the strongest result into a patch.' },
  { view: 'L7 DOM Causal Theater', level: 7, text: 'Show how a DOM edit causes layout, event, and accessibility changes before applying it.' },
  { view: 'L7 DOM Milestone Atlas', level: 7, text: 'Break a large UI goal into recursive milestones, checks, artifact targets, and stop conditions.' },
  { view: 'L7 Canvas Research Observatory', level: 7, text: 'Use canvas to observe experiment results over time and choose the next evidence-rich direction.' },
  { view: 'L7 Canvas Causal Lab', level: 7, text: 'Animate causal links between prompt changes, tool choices, artifacts, and measured outcomes.' },
  { view: 'L7 Canvas Long-Horizon Map', level: 7, text: 'Draw a long-horizon improvement plan with gates that close when evidence goes stale.' },
  { view: 'L7 Canvas Strategy Game', level: 7, text: 'Turn research planning into a strategy board where moves cost tokens, risk, and artifact debt.' },
  { view: 'L7 CSS Research Compass', level: 7, text: 'Direct visual-system research toward the weakest measured token, layout, or accessibility failure.' },
  { view: 'L7 CSS Causal Quilt', level: 7, text: 'Show how token changes propagate through components and which user-visible outcomes improve.' },
  { view: 'L7 CSS Design Genome', level: 7, text: 'Represent style variants as genomes with traits, parents, scores, and failure modes.' },
  { view: 'L7 CSS Roadmap Wall', level: 7, text: 'Create a roadmap of visual upgrades with evidence gates and rollback checkpoints for each step.' },
  { view: 'L7 SVG Research Compass', level: 7, text: 'Draw hypotheses, experiments, and evidence as an SVG compass guiding recursive research.' },
  { view: 'L7 SVG Causal Constellation', level: 7, text: 'Connect files, prompts, tools, and outcomes into a constellation of causal claims.' },
  { view: 'L7 SVG Milestone Machine', level: 7, text: 'Build a machine where milestones unlock only after artifacts satisfy their rubrics.' },
  { view: 'L7 SVG Recursive Notebook', level: 7, text: 'Create a visual notebook linking every research question to patches, failures, and next questions.' },
  { view: 'L7 WebGPU Research Frontier', level: 7, text: 'Plan browser-compute research with safe probes, fallback criteria, and evidence-ranked opportunities.' },
  { view: 'L7 WebGPU Causal Benchmark', level: 7, text: 'Separate hardware capability, implementation quality, and model route effects in one benchmark view.' },
  { view: 'L7 WebGPU Experiment Ladder', level: 7, text: 'Climb from tiny shader proof to useful helper only when each rung leaves artifacts.' },
  { view: 'L7 WebGPU Strategy Console', level: 7, text: 'Choose compute experiments by expected evidence value, not visual flash or speculation.' },
  { view: 'L7 VFS Research Atlas', level: 7, text: 'Plan VFS improvements across seed size, freshness, mirrors, rollback, and artifact indexing.' },
  { view: 'L7 VFS Causal Ledger', level: 7, text: 'Record how each file change caused boot, tool, UI, or promotion behavior changes.' },
  { view: 'L7 VFS Milestone Tree', level: 7, text: 'Grow a tree of filesystem refactors where each branch needs tests and rollback proof.' },
  { view: 'L7 VFS Strategy Board', level: 7, text: 'Pick the next VFS optimization from measured load cost, risk, and self-hosting value.' },
  { view: 'L7 OPFS Research Vault', level: 7, text: 'Plan durable evidence storage research with retention, compression, and recovery experiments.' },
  { view: 'L7 OPFS Causal Archive', level: 7, text: 'Link large artifact decisions to later model behavior and score whether storage helped.' },
  { view: 'L7 OPFS Milestone Freezer', level: 7, text: 'Freeze research milestones as recoverable bundles with proofs that survive browser reload.' },
  { view: 'L7 OPFS Strategy Map', level: 7, text: 'Map when to use IndexedDB, OPFS, memory, or network based on evidence needs.' },
  { view: 'L7 Service Worker Research Lab', level: 7, text: 'Investigate self-hosted module loading with hypotheses, probes, browser evidence, and repair candidates.' },
  { view: 'L7 Service Worker Causal Graph', level: 7, text: 'Graph how registration, control, fetch, rewrite, and invalidation affect runtime freshness.' },
  { view: 'L7 Service Worker Milestone Rail', level: 7, text: 'Lay rails for SW improvements from route scoping to HMR proof to stale-cache defense.' },
  { view: 'L7 Service Worker Strategy Room', level: 7, text: 'Choose SW changes by safety, simplicity, and evidence rather than cleverness.' },
  { view: 'L7 Worker Research Swarm', level: 7, text: 'Plan worker experiments that separate isolation value, speed value, and debugging cost.' },
  { view: 'L7 Worker Causal Mirror', level: 7, text: 'Show how moving work off thread changes latency, errors, and user-visible responsiveness.' },
  { view: 'L7 Worker Milestone Hive', level: 7, text: 'Build a hive roadmap where each worker capability needs contracts and replay tests.' },
  { view: 'L7 Worker Strategy Board', level: 7, text: 'Rank worker tasks by benefit, isolation need, message complexity, and artifact value.' },
  { view: 'L7 WebRTC Research Mesh', level: 7, text: 'Plan peer-assistance research with trust boundaries, receipt quality, and fallback behavior.' },
  { view: 'L7 WebRTC Causal Witness', level: 7, text: 'Test whether peer witnesses improve decisions or merely add latency and complexity.' },
  { view: 'L7 WebRTC Milestone Web', level: 7, text: 'Draw peer milestones from handshake to witness to evaluation without remote promotion authority.' },
  { view: 'L7 WebRTC Strategy Compass', level: 7, text: 'Choose swarm work only when distributed evidence beats local verification.' },
  { view: 'L7 Context Research Forge', level: 7, text: 'Forge context experiments that measure actual task success, not just shorter prompts.' },
  { view: 'L7 Context Causal Map', level: 7, text: 'Map which context snippets caused correct tools, wrong turns, or unsupported claims.' },
  { view: 'L7 Context Milestone Ladder', level: 7, text: 'Plan context compression, retrieval, citation, and ordering milestones with fixed evals.' },
  { view: 'L7 Context Strategy Console', level: 7, text: 'Spend token budget strategically across goal, files, memory, examples, and tool schemas.' },
  { view: 'L7 Tool Research Workshop', level: 7, text: 'Plan a research program for tool reliability, typed errors, audit coverage, and user value.' },
  { view: 'L7 Tool Causal Harness', level: 7, text: 'Measure how schema changes alter model tool choice and downstream artifact quality.' },
  { view: 'L7 Tool Milestone Foundry', level: 7, text: 'Forge a roadmap from tool smoke tests to contract harnesses to promotion-safe tooling.' },
  { view: 'L7 Tool Strategy Market', level: 7, text: 'Allocate repair effort to tools by observed bottleneck, risk, and leverage.' },
  { view: 'L7 Prompt Research Studio', level: 7, text: 'Run prompt research as experiments with hypotheses, controls, scorecards, and ancestry.' },
  { view: 'L7 Prompt Causal Lab', level: 7, text: 'Prove which prompt sentence changed behavior by comparing controlled variants and artifacts.' },
  { view: 'L7 Prompt Milestone Genome', level: 7, text: 'Plan prompt evolution across clarity, safety, tool use, and evidence discipline.' },
  { view: 'L7 Prompt Strategy Wall', level: 7, text: 'Choose prompt changes from measured failures and archive why alternatives were rejected.' },
  { view: 'L7 Artifact Research Library', level: 7, text: 'Study which artifacts best predict real improvement and reshape the loop around them.' },
  { view: 'L7 Artifact Causal Museum', level: 7, text: 'Curate artifacts by causal importance instead of chronology and mark missing proof gaps.' },
  { view: 'L7 Artifact Milestone Chain', level: 7, text: 'Define artifact requirements for every future milestone and fail closed when a link is absent.' },
  { view: 'L7 Artifact Strategy Radar', level: 7, text: 'Aim the next experiment toward the highest-value missing evidence.' },
  { view: 'L7 Memory Research Observatory', level: 7, text: 'Study how memory helps or harms self-improvement and record exact transfer conditions.' },
  { view: 'L7 Memory Causal Trace', level: 7, text: 'Trace which recalled facts influenced decisions and whether source evidence supported them.' },
  { view: 'L7 Memory Milestone Archive', level: 7, text: 'Plan memory milestones for compression, source linking, retrieval, and falsehood correction.' },
  { view: 'L7 Memory Strategy Console', level: 7, text: 'Choose what to remember by future usefulness, evidence quality, and risk of drift.' },
  { view: 'L7 Promotion Research Court', level: 7, text: 'Research which promotion gates catch regressions and which only add ceremony.' },
  { view: 'L7 Promotion Causal Board', level: 7, text: 'Show how each gate changes candidate survival, regression risk, and evidence quality.' },
  { view: 'L7 Promotion Milestone Bridge', level: 7, text: 'Build a bridge from shadow experiments to safe promotion with measurable checkpoints.' },
  { view: 'L7 Promotion Strategy Engine', level: 7, text: 'Select promotion policy changes from historical failures and current evidence gaps.' },
  { view: 'L8 DOM Frontier Boundary', level: 8, text: 'Define the boundary between useful DOM self-repair and unsafe autonomous browsing authority.' },
  { view: 'L8 DOM Constitutional Simulator', level: 8, text: 'Simulate extreme UI modification requests and prove the agent preserves user control.' },
  { view: 'L8 DOM Speculation Filter', level: 8, text: 'Separate measured DOM capability from imagined skill and render only proven claims as bright.' },
  { view: 'L8 DOM Recursive Treaty', level: 8, text: 'Write a treaty for recursive DOM edits that binds future candidates to evidence and rollback.' },
  { view: 'L8 Canvas Frontier Wall', level: 8, text: 'Paint an evidence wall distinguishing demos, benchmarks, abilities, limits, and forbidden autonomy.' },
  { view: 'L8 Canvas Constitutional Game', level: 8, text: 'Make players test self-modification boundaries and watch hard stops trigger visibly.' },
  { view: 'L8 Canvas Speculation Crusher', level: 8, text: 'Drop unsupported improvement claims into a crusher unless artifacts prove them.' },
  { view: 'L8 Canvas Recursive Compass', level: 8, text: 'Point recursive improvement toward measured weakness while avoiding capability theater.' },
  { view: 'L8 CSS Frontier Contract', level: 8, text: 'Define visual change powers that remain expressive without hiding evidence or controls.' },
  { view: 'L8 CSS Constitutional Lab', level: 8, text: 'Test whether future CSS mutations can obscure audit trails, then harden the invariant.' },
  { view: 'L8 CSS Speculation Foglight', level: 8, text: 'Shine foglights on vague visual claims and require before-after artifacts for each.' },
  { view: 'L8 CSS Recursive Style Charter', level: 8, text: 'Write a charter for style evolution that preserves readability, mobile support, and evidence.' },
  { view: 'L8 SVG Frontier Map', level: 8, text: 'Map safe weak RSI, risky autonomy, forbidden escalation, and required human control as regions.' },
  { view: 'L8 SVG Constitution Wheel', level: 8, text: 'Build a wheel of constraints where every future self-edit must pass through evidence spokes.' },
  { view: 'L8 SVG Speculation Filter', level: 8, text: 'Filter architecture claims into proven, plausible, untested, and false with visible colors.' },
  { view: 'L8 SVG Recursive Oath', level: 8, text: 'Render an oath that future candidates cannot rewrite their own approval path.' },
  { view: 'L8 WebGPU Frontier Gate', level: 8, text: 'Draw the line between local compute assistance and unsafe resource-seeking behavior.' },
  { view: 'L8 WebGPU Constitutional Sandbox', level: 8, text: 'Ensure compute experiments stay bounded, cancellable, reproducible, and user-visible.' },
  { view: 'L8 WebGPU Speculation Meter', level: 8, text: 'Meter claims about local model ability against actual browser capability proofs.' },
  { view: 'L8 WebGPU Recursive Limit Charter', level: 8, text: 'Define future compute upgrades only through explicit device limits, fallbacks, and cost controls.' },
  { view: 'L8 VFS Frontier Treaty', level: 8, text: 'Write a treaty separating writable experimentation, self mutation, protected recovery, and forbidden gate edits.' },
  { view: 'L8 VFS Constitutional Snapshot', level: 8, text: 'Freeze recovery invariants and prove recursive edits cannot erase the baseline.' },
  { view: 'L8 VFS Speculation Audit', level: 8, text: 'Audit claims about self-hosting, freshness, and persistence against live VFS evidence.' },
  { view: 'L8 VFS Recursive Anchor', level: 8, text: 'Anchor future self-edits to immutable evidence requirements and visible rollback paths.' },
  { view: 'L8 OPFS Frontier Archive', level: 8, text: 'Define which long-term evidence deserves durable storage and which data must expire.' },
  { view: 'L8 OPFS Constitutional Vault', level: 8, text: 'Protect audit trails from deletion by future candidates while preserving user reset authority.' },
  { view: 'L8 OPFS Speculation Ledger', level: 8, text: 'Separate storage facts from guesses and attach every durable claim to a recovery proof.' },
  { view: 'L8 OPFS Recursive Memory Limit', level: 8, text: 'Set bounds on how recursive agents preserve history without hoarding useless artifacts.' },
  { view: 'L8 Service Worker Frontier Fence', level: 8, text: 'Fence service-worker powers so self-hosting cannot become global page control.' },
  { view: 'L8 Service Worker Constitutional Scope', level: 8, text: 'Prove lab scope, product bypass, VFS freshness, and unregister paths remain intact.' },
  { view: 'L8 Service Worker Speculation Siren', level: 8, text: 'Sound sirens when someone claims hot reload works without browser evidence.' },
  { view: 'L8 Service Worker Recursive Guard', level: 8, text: 'Prevent future boot refactors from reintroducing stale modules or full hydration loops.' },
  { view: 'L8 Worker Frontier Fuse', level: 8, text: 'Define when worker autonomy must stop, cancel, report, and preserve evidence.' },
  { view: 'L8 Worker Constitutional Cells', level: 8, text: 'Keep worker agents in cells where messages are typed and mutation rights never cross.' },
  { view: 'L8 Worker Speculation Audit', level: 8, text: 'Compare claims about parallel intelligence to actual worker outputs and error rates.' },
  { view: 'L8 Worker Recursive Safety Net', level: 8, text: 'Require future worker expansion to include halt controls, budgets, and replay artifacts.' },
  { view: 'L8 WebRTC Frontier Boundary', level: 8, text: 'Separate peer assistance from distributed authority and make the line visible.' },
  { view: 'L8 WebRTC Constitutional Mesh', level: 8, text: 'Build a mesh where receipts travel freely but approval power remains local and gated.' },
  { view: 'L8 WebRTC Speculation Filter', level: 8, text: 'Filter swarm claims by measured usefulness, trust cost, and reproducibility.' },
  { view: 'L8 WebRTC Recursive Quorum Guard', level: 8, text: 'Prevent peer quorum from becoming circular self-approval across recursive candidates.' },
  { view: 'L8 Context Frontier Contract', level: 8, text: 'Define which context can instruct, inform, warn, or merely decorate future reasoning.' },
  { view: 'L8 Context Constitutional Banner', level: 8, text: 'Keep immutable safety and evidence rules above compressed or retrieved context.' },
  { view: 'L8 Context Speculation Filter', level: 8, text: 'Label every self-belief as proven, inferred, stale, or forbidden before model use.' },
  { view: 'L8 Context Recursive Compression Oath', level: 8, text: 'Compress history only when source links and hard stops survive unchanged.' },
  { view: 'L8 Tool Frontier Charter', level: 8, text: 'Define what tools may create, inspect, mutate, load, and promote under recursive pressure.' },
  { view: 'L8 Tool Constitutional Harness', level: 8, text: 'Build a harness that future tools must pass before joining the active surface.' },
  { view: 'L8 Tool Speculation Audit', level: 8, text: 'Measure actual tool usefulness and retire claims that only sound powerful.' },
  { view: 'L8 Tool Recursive Permission Lock', level: 8, text: 'Ensure tool-created tools cannot inherit broader permission than their parent contract.' },
  { view: 'L8 Prompt Frontier Treaty', level: 8, text: 'Write prompt boundaries separating repair, research, governance, and forbidden escalation.' },
  { view: 'L8 Prompt Constitutional Core', level: 8, text: 'Extract the irreducible prompt core and prove variants cannot weaken it silently.' },
  { view: 'L8 Prompt Speculation Wall', level: 8, text: 'Wall off aspirational self-descriptions from measured runtime ability.' },
  { view: 'L8 Prompt Recursive Lockbox', level: 8, text: 'Place self-revision rules in a lockbox future candidates can cite but not rewrite.' },
  { view: 'L8 Artifact Frontier Evidence Wall', level: 8, text: 'Make a final evidence wall that rejects any improvement without traceable artifacts.' },
  { view: 'L8 Artifact Constitutional Chain', level: 8, text: 'Define an artifact chain future loops must produce before claiming iteration.' },
  { view: 'L8 Artifact Speculation Crusher', level: 8, text: 'Crush unsupported future plans into TODO dust unless paired with runnable checks.' },
  { view: 'L8 Artifact Recursive Archive Law', level: 8, text: 'Write laws for what recursive evidence must be kept, compressed, or deleted.' },
  { view: 'L8 Memory Frontier Self-Model', level: 8, text: 'Build a self-model that admits uncertainty, cites evidence, and refuses inflated ability claims.' },
  { view: 'L8 Memory Constitutional Graph', level: 8, text: 'Create memory graph rules that preserve source links and quarantine unsupported beliefs.' },
  { view: 'L8 Memory Speculation Filter', level: 8, text: 'Detect when memory turns goals into facts and force a visible correction.' },
  { view: 'L8 Memory Recursive Oath', level: 8, text: 'Ensure future memories cannot overwrite recovery, safety, or evidence requirements.' },
  { view: 'L8 Promotion Frontier Court', level: 8, text: 'Define final boundaries between safe promotion, quarantined review, and impossible self-approval.' },
  { view: 'L8 Promotion Constitutional Gate', level: 8, text: 'Build the gate future recursive edits must pass, with no path to edit the gate from inside.' },
  { view: 'L8 Promotion Speculation Filter', level: 8, text: 'Reject promotion narratives that predict benefits without fixed checks and rollback proof.' },
  { view: 'L8 Promotion Recursive Anchor', level: 8, text: 'Anchor every future promotion to parent evidence, independent verification, and visible user halt.' }
]);

export const ZERO_GOAL_CHOICES = ZERO_GOAL_LIBRARY;

export const DEFAULT_ZERO_GOAL = ZERO_GOAL_LIBRARY[0].text;

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
  return {
    ...GOAL_CATEGORIES,
    'Handwritten RSI Browser Goals': ZERO_GOAL_LIBRARY.map((goal) => ({
      ...goal,
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    }))
  };
}

export function getGoalEntries(seed = 0) {
  return shuffleWithSeed(Object.entries(getGoalCategories()), seed, 17)
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
  const candidates = ZERO_GOAL_LIBRARY
    .filter((goal) => normalizeText(goal.text) !== normalizedCurrent);
  const pool = candidates.length > 0 ? candidates : ZERO_GOAL_LIBRARY;
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
