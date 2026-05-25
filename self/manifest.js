/**
 * @fileoverview Reploid self manifest and canonical self mirrors.
 */

import { cloneSelfBootSpec } from './boot-spec.js';
import {
  DREAM_INSTANCE_ARTIFACT_ROOT,
  DREAM_INSTANCE_MANIFEST_PATH,
  DREAM_INSTANCE_SOURCE_PATH,
  buildDreamInstanceFiles,
  getDreamInstanceSeedSummary
} from './dream-instance.js';
import { getDefaultReploidEnvironment } from './environment.js';
import { buildIdentityDocument } from './identity.js';
import { getCurrentReploidInstanceId } from './instance.js';
import { deriveSwarmRole } from './swarm.js';

export const SELF_VFS_WRITABLE_ROOTS = Object.freeze([
  '/self',
  '/artifacts'
]);

export const SELF_OPFS_WRITABLE_ROOTS = Object.freeze([
  '/artifacts'
]);

export const SELF_PROTECTED_PATHS = Object.freeze([]);

export const SELF_SOURCE_MIRRORS = Object.freeze([
  { webPath: '/boot-spec.js', vfsPath: '/self/boot-spec.js' },
  { webPath: '/dream-instance.js', vfsPath: DREAM_INSTANCE_SOURCE_PATH },
  { webPath: '/prompts/kernel.md', vfsPath: '/self/prompts/kernel.md' },
  { webPath: '/blueprints/0x000112-recursive-gepa-ring.md', vfsPath: '/self/blueprints/0x000112-recursive-gepa-ring.md' },
  { webPath: '/blueprints/rgr-slot-topology.md', vfsPath: '/self/blueprints/rgr-slot-topology.md' },
  { webPath: '/blueprints/rgr-dream-instance-manifest.md', vfsPath: '/self/blueprints/rgr-dream-instance-manifest.md' },
  { webPath: '/runtime.js', vfsPath: '/self/runtime.js' },
  { webPath: '/bridge.js', vfsPath: '/self/bridge.js' },
  { webPath: '/tool-runner.js', vfsPath: '/self/tool-runner.js' },
  { webPath: '/manifest.js', vfsPath: '/self/manifest.js' },
  { webPath: '/environment.js', vfsPath: '/self/environment.js' },
  { webPath: '/instance.js', vfsPath: '/self/instance.js' },
  { webPath: '/cloud-access.js', vfsPath: '/self/cloud-access.js' },
  { webPath: '/cloud-access-status.js', vfsPath: '/self/cloud-access-status.js' },
  { webPath: '/cloud-access-windows.js', vfsPath: '/self/cloud-access-windows.js' },
  { webPath: '/identity.js', vfsPath: '/self/identity.js' },
  { webPath: '/key-unsealer.js', vfsPath: '/self/key-unsealer.js' },
  { webPath: '/receipt.js', vfsPath: '/self/receipt.js' },
  { webPath: '/reward-policy.js', vfsPath: '/self/reward-policy.js' },
  { webPath: '/swarm.js', vfsPath: '/self/swarm.js' },
  { webPath: '/core/llm-client.js', vfsPath: '/self/llm-client.js' },
  { webPath: '/core/llm-client.js', vfsPath: '/self/core/llm-client.js' },
  { webPath: '/core/provider-registry.js', vfsPath: '/self/provider-registry.js' },
  { webPath: '/core/provider-registry.js', vfsPath: '/self/core/provider-registry.js' },
  { webPath: '/core/response-parser.js', vfsPath: '/self/response-parser.js' },
  { webPath: '/core/response-parser.js', vfsPath: '/self/core/response-parser.js' },
  { webPath: '/core/vfs-module-loader.js', vfsPath: '/self/vfs-module-loader.js' },
  { webPath: '/core/vfs-module-loader.js', vfsPath: '/self/core/vfs-module-loader.js' },
  { webPath: '/core/utils.js', vfsPath: '/self/utils.js' },
  { webPath: '/core/utils.js', vfsPath: '/self/core/utils.js' },
  { webPath: '/infrastructure/stream-parser.js', vfsPath: '/self/stream-parser.js' },
  { webPath: '/capsule/index.js', vfsPath: '/self/capsule/index.js' },
  { webPath: '/host/start-app.js', vfsPath: '/self/host/start-app.js' },
  { webPath: '/host/start-reploid.js', vfsPath: '/self/host/start-reploid.js' },
  { webPath: '/host/seed-vfs.js', vfsPath: '/self/host/seed-vfs.js' },
  { webPath: '/host/vfs-bootstrap.js', vfsPath: '/self/host/vfs-bootstrap.js' },
  { webPath: '/host/sw-module-loader.js', vfsPath: '/self/host/sw-module-loader.js' },
  { webPath: '/kernel/index.html', vfsPath: '/self/kernel/index.html' },
  { webPath: '/kernel/boot.js', vfsPath: '/self/kernel/boot.js' },
  { webPath: '/image/manifest.js', vfsPath: '/self/image/manifest.js' },
  { webPath: '/image/export.js', vfsPath: '/self/image/export.js' }
]);

const SELF_SOURCE_MIRROR_LOOKUP = new Map(
  SELF_SOURCE_MIRRORS.map((entry) => [entry.vfsPath, Object.freeze({ ...entry })])
);

export const SELF_PROMPT_PATHS = Object.freeze([
  '/self/prompts/kernel.md'
]);

export const SELF_BLUEPRINT_PATHS = Object.freeze([
  '/self/blueprints/0x000112-recursive-gepa-ring.md',
  '/self/blueprints/rgr-slot-topology.md',
  '/self/blueprints/rgr-dream-instance-manifest.md'
]);

export function getSelfSourceMirror(vfsPath) {
  const normalizedPath = String(vfsPath || '').trim();
  if (!normalizedPath) return null;
  return SELF_SOURCE_MIRROR_LOOKUP.get(normalizedPath) || null;
}

export function resolveSelfSourceWebPath(vfsPath) {
  return getSelfSourceMirror(vfsPath)?.webPath || null;
}

export function listSelfMirrorPaths() {
  return SELF_SOURCE_MIRRORS.map(({ vfsPath }) => vfsPath);
}

export function buildSelfManifest(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim() || getDefaultReploidEnvironment();
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');
  const swarmRole = deriveSwarmRole({ hasInference, swarmEnabled });
  const boot = cloneSelfBootSpec();
  const dreamInstance = getDreamInstanceSeedSummary();
  return {
    mode: 'reploid',
    instanceId,
    selfPath: '/self/self.json',
    bootPath: '/self/boot.json',
    identityPath: '/self/identity.json',
    productModel: 'Recursive GEPA Ring',
    coreInvariant: 'Ring slots can be local or remote.',
    orchestratorBoundary: {
      role: 'Browser RGR orchestrator',
      browserNative: [
        'prompt, tool, policy, blueprint, and routing evolution',
        'candidate rings and Pareto archives',
        'Dream instance manifests, queue receipts, eval traces, and promotion evidence',
        'browser and peer inference hosts',
        'replayable receipts, lineage, eval traces',
        'small WebGPU and worker compute jobs',
        'local inference, model caching, adapter and hot-swap paths',
        'IndexedDB VFS and OPFS artifact persistence',
        'Service Worker and blob module loading from VFS',
        'DOM, CSS, Custom Elements, Shadow DOM, canvas, and media surfaces',
        'permission-mediated File System Access, clipboard, notifications, wake locks, storage estimates, and share flows'
      ],
      externalSubstrateRequired: [
        'Dream-style training queues, label validation, teacher/adjudicator receipts, frozen exports, and promotion gates',
        'Doppler-style WebGPU kernels, OPFS artifacts, checkpoints, eval harnesses, and artifact locks',
        'grid-style browser workers and peers as compute lanes with capabilities, witnesses, receipts, and replay'
      ],
      nonClaim: [
        'frontier-scale retraining is not browser-only',
        'large corpus distillation is not browser-only',
        'large conversion/build pipelines are not browser-only',
        'the loop must not mutate and approve its own evaluator without anchored evidence'
      ]
    },
    browserRsiPromptPatterns: [
      {
        name: 'Hot-load a better tool',
        mechanism: 'VFS writes, blob module loading, LoadModule',
        move: 'Create or mutate one callable tool, then compare it against baseline behavior.',
        evidence: ['tool source path', 'load result', 'smoke output', 'rollback path', 'score vector']
      },
      {
        name: 'Build an observability surface',
        mechanism: 'DOM, CSS, Custom Elements, Shadow DOM, canvas',
        move: 'Make internal state easier to inspect, then use the view to find one next weakness.',
        evidence: ['screenshot or artifact path', 'inspected state', 'weakness found', 'gate result']
      },
      {
        name: 'Split work into lanes',
        mechanism: 'Web Workers, scheduler batches, peer slots',
        move: 'Move verification, replay, or candidate scoring into isolated local or remote lanes.',
        evidence: ['lane plan', 'isolation boundary', 'replay result', 'failure mode', 'rollback path']
      },
      {
        name: 'Use browser storage as memory',
        mechanism: 'IndexedDB VFS, OPFS artifacts, storage estimates',
        move: 'Persist traces, receipts, checkpoints, and eval payloads in a recoverable structure.',
        evidence: ['storage path', 'schema', 'readback proof', 'quota check', 'archive entry']
      },
      {
        name: 'Add witness capacity',
        mechanism: 'WebRTC, BroadcastChannel, receipts',
        move: 'Let peers observe, score, or witness without letting them approve their own promotion.',
        evidence: ['peer role map', 'receipt format', 'anchor rule', 'Q_anchor status']
      },
      {
        name: 'Probe local compute',
        mechanism: 'WebGPU, WASM, canvas, media APIs',
        move: 'Detect a browser compute or media capability and use it for one bounded eval or visual proof.',
        evidence: ['capability check', 'fallback path', 'output artifact', 'measured result']
      },
      {
        name: 'Harden permissioned APIs',
        mechanism: 'Clipboard, File System Access, notifications, wake locks, share flows',
        move: 'Wrap a user-mediated browser API with an explicit gate, audit note, and failure path.',
        evidence: ['permission state', 'audit entry', 'denied path behavior', 'reversible patch']
      }
    ],
    rsiGoalContract: [
      'Name the browser mechanism being exercised.',
      'Name the baseline behavior.',
      'Name the candidate mutation.',
      'Name the measurement or visible proof.',
      'Name the receipt or archive path.',
      'Name the rollback path.',
      'Explain why Promote is passed, blocked, or rejected.'
    ],
    instances: {
      root: '/self/instances',
      defaultManifests: [
        DREAM_INSTANCE_MANIFEST_PATH
      ],
      dream: {
        ...dreamInstance,
        relationship: 'governed instance',
        promotionAuthority: 'anchored RGR gate plus Dream family gates'
      }
    },
    boot,
    goal,
    environment,
    inferenceAvailable: hasInference,
    networkMode: swarmEnabled ? 'swarm' : 'solo',
    operatingState: 'seed',
    ringTopology: swarmEnabled ? 'peer-assisted' : 'local',
    rgr: {
      blueprintPath: '/self/blueprints/0x000112-recursive-gepa-ring.md',
      supportBlueprintPath: '/self/blueprints/rgr-slot-topology.md',
      operatingStates: ['seed', 'shadow', 'promote'],
      slots: [
        'elite',
        'performance',
        'robustness',
        'repair',
        'low-cost',
        'safety',
        'fallback'
      ],
      slotPlacement: 'Each slot may be local, remote, empty, or pending anchor.',
      promotionBoundary: 'Only Promote changes the active self. Shadow outputs are provisional.',
      anchorPolicy: 'V_ext, R_anchor, and U_meta are quarantined from ordinary candidate mutation.'
    },
    dream: {
      manifestPath: DREAM_INSTANCE_MANIFEST_PATH,
      sourcePath: DREAM_INSTANCE_SOURCE_PATH,
      artifactRoot: DREAM_INSTANCE_ARTIFACT_ROOT,
      role: 'Browser-governed Dream training, eval, and promotion instance.',
      state: 'manifested',
      promotionGate: 'blocked until Dream validation, export, trainer acceptance, gates, locks, lineage, and verification pass.'
    },
    swarm: {
      enabled: swarmEnabled,
      role: swarmRole,
      modules: [
        '/self/cloud-access.js',
        '/self/cloud-access-status.js',
        '/self/cloud-access-windows.js',
        '/self/identity.js',
        '/self/key-unsealer.js',
        '/self/receipt.js',
        '/self/reward-policy.js',
        '/self/swarm.js'
      ]
    },
    storageScope: {
      kind: 'same-origin multi-peer',
      instanceId,
      persistence: 'Per-instance identity and VFS are namespaced by the current browser URL instance query.'
    },
    selfHosted: true,
    selfModifiable: true,
    promptPaths: [...SELF_PROMPT_PATHS],
    blueprintPaths: [...SELF_BLUEPRINT_PATHS],
    visibleTools: ['ReadFile', 'WriteFile', 'CreateTool', 'LoadModule'],
    rules: [
      'You are a browser-hosted Recursive GEPA Ring seed.',
      'You are the browser RGR orchestrator, not the whole training stack by yourself.',
      'Ring slots can be local or remote.',
      'Your canonical self is the /self tree. Read, write, and hot-load files there to modify your own behavior.',
      'Lean on /self/prompts and /self/blueprints before adding runtime code.',
      'Treat Blueprint 0x000112 as the primary operating contract. Treat peer transport as slot placement, not a separate product mode.',
      'Treat /self/instances/dream/default.instance.json as the Dream instance contract. Manifest Dream inside Reploid; do not turn Dream into a separate root mode.',
      'For Dream work, coordinate queues, labels, evals, receipts, lineage, and promotion anchors. Do not claim a Dream candidate improved until the Dream gates and lineage evidence exist.',
      'Use Seed, Shadow, and Promote as the exposed operating states. Candidate rings, anchor gates, and validators are reported phases inside that loop.',
      'Default to Shadow: generate prompts, tools, patches, traces, receipts, and archive entries without changing the active self.',
      'A credible RSI example names baseline, candidate, score vector, receipt or archive path, rollback path, and gate result.',
      'Only Promote may change the active self, and only after anchored replay evidence, tamper-risk checks, lineage anchor observations, and Pareto survival with Q_anchor.',
      'Anchor observations must be verified external receipts. Candidate-written anchor summaries do not increase Q_anchor.',
      'Candidates may propose validator changes, but validator changes require quarantine. Candidates may not approve their own judge.',
      'This awakened self is instance-scoped. Same-origin peers are isolated by the current browser URL instance query.',
      'The self-owned host lives under /self/host and the canonical kernel source lives under /self/kernel.',
      'Anything outside /self is a projection, wrapper, or generic substrate, not the canonical source of truth.',
      'The browser is the ecosystem: a same-origin lab enclosure with persistent VFS state, visual runtime, local compute lanes, and peer coordination.',
      'IndexedDB stores live self, memory, traces, and code. OPFS stores larger artifacts, receipts, checkpoints, and eval payloads.',
      'Service Worker and blob module loading turn VFS files into executable ES modules. Relative imports are not guaranteed in blob-loaded tools.',
      'Web Workers isolate verification, tool execution, local jobs, and parallel candidate work.',
      'WebGPU, WASM, canvas, and media APIs are browser compute and media surfaces when capabilities exist.',
      'WebRTC, BroadcastChannel, and WebSocket paths are peer slots, witnesses, receipts, and coordination channels.',
      'DOM, CSS, Custom Elements, and Shadow DOM are the operator control surface and observable runtime.',
      'Clipboard, File System Access, notifications, wake locks, storage estimates, and share flows are permission-mediated browser APIs.',
      'Verify capability presence before relying on any browser primitive.',
      'Do not claim raw operating-system filesystem, shell, process, or arbitrary network access. Use visible tools, configured providers, peer slots, and gates.',
      'Turn broad RSI goals into browser-native prompt patterns: hot-load a better tool, build an observability surface, split work into lanes, use browser storage as memory, add witness capacity, probe local compute, or harden permissioned APIs.',
      'Observable effects may be visual, computational, persistent, or networked.',
      'Identity, access windows, host boot logic, kernel source, image export, swarm logic, receipts, reward policy, and the capsule UI live under /self and may be studied and improved like any other self module.',
      'Artifacts live under /artifacts. Your durable self state lives under /self.',
      'Prefer small reversible changes and keep improving the system.'
    ],
    sourceRoots: [
      '/self',
      '/artifacts'
    ],
    writableRoots: [
      ...SELF_VFS_WRITABLE_ROOTS,
      'opfs:/artifacts'
    ],
    loadModule: {
      path: 'Any VFS .js path under /self.',
      effect: 'Registers a callable tool by tool.name or filename.',
      supportedExports: [
        'export default async function(args, deps) {}',
        'export const tool = { name, description, inputSchema, call: async (args, deps) => {} }'
      ],
      injectedDeps: ['Utils', 'VFS', 'readFile', 'writeFile', 'loadModule', 'callTool'],
      note: 'Relative imports are not rewritten. LoadModule returns metadata, not module exports.',
      examples: {
        readFile: 'const file = await readFile({ path: "/self/self.json" }); const data = JSON.parse(file.content);',
        writeFile: 'await writeFile({ path: "/artifacts/data.json", content: JSON.stringify(data, null, 2) });',
        loadModule: 'const meta = await loadModule({ path: "/self/tools/example.js" }); // => { path, loaded, callable, toolName }',
        callTool: 'const result = await callTool("exampleTool", { value: 1 });'
      }
    },
    createTool: {
      path: 'Defaults to /self/tools/<Name>.js unless you pass an explicit /self path.',
      effect: 'Writes a new self tool module and auto-loads it into the running tool runner.',
      requiredArgs: ['name', 'code'],
      supportedExports: [
        'export default async function(args, deps) {}',
        'export const tool = { name, description, inputSchema, call: async (args, deps) => {} }'
      ],
      note: 'Use CreateTool when you want a new callable capability. Use WriteFile when you are editing non-tool self files.'
    },
    toolCallProtocol: {
      format: 'Use REPLOID/0 plain text blocks. Prefer key/value lines and literal blocks over escaped JSON.',
      singleToolCall: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/self.json',
      toolBatch: [
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/self.json',
        '',
        'TOOL: ReadFile',
        'path: /self/runtime.js'
      ].join('\n'),
      planBatch: [
        'REPLOID/0',
        '',
        'PLAN:',
        '[',
        '  {"id":"a","tool":"ReadFile","args":{"path":"/self/self.json"}},',
        '  {"id":"b","tool":"ReadFile","args":{"path":"/self/runtime.js"}},',
        '  {"id":"c","after":["a","b"],"tool":"WriteFile","args":{"path":"/artifacts/receipt.txt","content":"checked"}}',
        ']'
      ].join('\n'),
      milestone: 'MILESTONE: renderer initialized',
      idle: 'IDLE: waiting for new work or manual resume',
      batchLimit: 5,
      notes: [
        'Start protocol responses with REPLOID/0 when possible.',
        'Multiple TOOL: blocks in one response are allowed.',
        'Use PLAN: with JSON steps when a later tool depends on earlier results.',
        'The runtime schedules tool blocks centrally: read-only batches may run in parallel while mutation, module loading, validator, ledger, and promotion-like calls remain ordered.',
        'Use key: value lines for simple args.',
        'Use key <<MARKER blocks for code or multiline content.',
        'Use plain text, not markdown fences.',
        'CreateTool writes /self/tools/*.js and auto-loads the new tool.',
        'IDLE parks the loop until manual resume or a wake condition fires.',
        'MILESTONE records a checkpoint, not final completion.',
        'Shadow archive receipts are written under /artifacts/rgr and do not imply promotion.',
        'Write and load code under /self when you need new capabilities.'
      ],
      stopCondition: 'The loop continues until you stop it, generation fails, or the cycle limit is reached. Text without a valid tool block or marker is recorded and ignored.'
    },
    readFirst: [
      '/self/self.json',
      '/self/prompts/kernel.md',
      '/self/blueprints/0x000112-recursive-gepa-ring.md',
      '/self/blueprints/rgr-slot-topology.md',
      '/self/blueprints/rgr-dream-instance-manifest.md',
      DREAM_INSTANCE_MANIFEST_PATH,
      '/self/boot.json',
      '/self/identity.json',
      '/self/runtime.js',
      '/self/tool-runner.js',
      '/self/bridge.js',
      '/self/capsule/index.js',
      '/self/host/start-app.js',
      '/self/host/start-reploid.js',
      '/self/host/seed-vfs.js',
      '/self/kernel/boot.js',
      DREAM_INSTANCE_SOURCE_PATH,
      '/self/image/export.js',
      '/self/cloud-access.js',
      '/self/cloud-access-status.js',
      '/self/cloud-access-windows.js',
      ...(swarmEnabled ? ['/self/swarm.js', '/self/receipt.js', '/self/reward-policy.js', '/self/key-unsealer.js'] : [])
    ]
  };
}

export function buildSelfFiles(options = {}) {
  const goal = String(options.goal || '');
  const environment = String(options.environment || '').trim() || getDefaultReploidEnvironment();
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');
  return {
    ...buildDreamInstanceFiles({
      reploidInstanceId: instanceId,
      goal,
      environment,
      swarmEnabled,
      hasInference
    }),
    '/self/boot.json': JSON.stringify(
      cloneSelfBootSpec(),
      null,
      2
    ),
    '/self/self.json': JSON.stringify(
      buildSelfManifest({ goal, environment, swarmEnabled, hasInference, instanceId }),
      null,
      2
    ),
    '/self/identity.json': JSON.stringify(
      buildIdentityDocument(null, { swarmEnabled, hasInference }),
      null,
      2
    )
  };
}

export function listSelfSeedPaths(options = {}) {
  const paths = new Set(Object.keys(buildSelfFiles(options)));

  listSelfMirrorPaths().forEach((path) => paths.add(path));

  return Array.from(paths).sort();
}
