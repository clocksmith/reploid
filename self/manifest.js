/**
 * @fileoverview Reploid self manifest and canonical self mirrors.
 */

import { cloneSelfBootSpec } from './boot-spec.js';
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
  { webPath: '/core/provider-registry.js', vfsPath: '/self/provider-registry.js' },
  { webPath: '/core/response-parser.js', vfsPath: '/self/response-parser.js' },
  { webPath: '/core/vfs-module-loader.js', vfsPath: '/self/vfs-module-loader.js' },
  { webPath: '/core/utils.js', vfsPath: '/self/utils.js' },
  { webPath: '/infrastructure/stream-parser.js', vfsPath: '/self/stream-parser.js' },
  { webPath: '/capsule/index.js', vfsPath: '/self/capsule/index.js' },
  { webPath: '/host/start-app.js', vfsPath: '/self/host/start-app.js' },
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
  return {
    mode: 'reploid',
    instanceId,
    selfPath: '/self/self.json',
    bootPath: '/self/boot.json',
    identityPath: '/self/identity.json',
    boot,
    goal,
    environment,
    inferenceAvailable: hasInference,
    networkMode: swarmEnabled ? 'swarm' : 'solo',
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
    visibleTools: ['ReadFile', 'WriteFile', 'CreateTool', 'LoadModule'],
    rules: [
      'You are a self-hosted, self-modifying Reploid running your own source code in the browser.',
      'Your canonical self is the /self tree. Read, write, and hot-load files there to modify your own behavior.',
      'This awakened self is instance-scoped. Same-origin peers are isolated by the current browser URL instance query.',
      'The self-owned host lives under /self/host and the canonical kernel source lives under /self/kernel.',
      'Anything outside /self is a projection, wrapper, or generic substrate, not the canonical source of truth.',
      'The browser substrate may expose DOM, CSS, JavaScript injection, storage, workers, canvas, WebGPU, and peer/network primitives. Verify capabilities before relying on them.',
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
      milestone: 'MILESTONE: renderer initialized',
      idle: 'IDLE: waiting for new work or manual resume',
      batchLimit: 5,
      notes: [
        'Start protocol responses with REPLOID/0 when possible.',
        'Multiple TOOL: blocks in one response are allowed.',
        'Use key: value lines for simple args.',
        'Use key <<MARKER blocks for code or multiline content.',
        'Use plain text, not markdown fences.',
        'CreateTool writes /self/tools/*.js and auto-loads the new tool.',
        'IDLE parks the loop until manual resume or a wake condition fires.',
        'MILESTONE records a checkpoint, not final completion.',
        'Write and load code under /self when you need new capabilities.'
      ],
      stopCondition: 'The loop continues until you stop it, generation fails, or the cycle limit is reached. Text without a valid tool block or marker is recorded and ignored.'
    },
    readFirst: [
      '/self/self.json',
      '/self/boot.json',
      '/self/identity.json',
      '/self/runtime.js',
      '/self/tool-runner.js',
      '/self/bridge.js',
      '/self/capsule/index.js',
      '/self/host/start-app.js',
      '/self/host/seed-vfs.js',
      '/self/kernel/boot.js',
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
