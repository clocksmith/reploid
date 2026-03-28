/**
 * @fileoverview Reploid self manifest and bootstrapper mirrors.
 */

import { getDefaultReploidEnvironment } from './environment.js';
import { buildIdentityDocument } from './identity.js';
import { deriveSwarmRole } from './swarm.js';

export const SELF_VFS_WRITABLE_ROOTS = Object.freeze([
  '/.system',
  '/self',
  '/capsule',
  '/tools',
  '/.memory',
  '/artifacts'
]);

export const SELF_OPFS_WRITABLE_ROOTS = Object.freeze([
  '/artifacts'
]);

export const BOOTSTRAPPER_ROOT = '/bootstrapper';

export const SELF_PROTECTED_PATHS = Object.freeze([]);

export const SELF_SOURCE_MIRRORS = Object.freeze([
  { webPath: '/src/self/runtime.js', vfsPath: '/self/runtime.js' },
  { webPath: '/src/self/bridge.js', vfsPath: '/self/bridge.js' },
  { webPath: '/src/self/tool-runner.js', vfsPath: '/self/tool-runner.js' },
  { webPath: '/src/self/manifest.js', vfsPath: '/self/manifest.js' },
  { webPath: '/src/self/environment.js', vfsPath: '/self/environment.js' },
  { webPath: '/src/self/cloud-access.js', vfsPath: '/self/cloud-access.js' },
  { webPath: '/src/self/cloud-access-status.js', vfsPath: '/self/cloud-access-status.js' },
  { webPath: '/src/self/cloud-access-windows.js', vfsPath: '/self/cloud-access-windows.js' },
  { webPath: '/src/self/identity.js', vfsPath: '/self/identity.js' },
  { webPath: '/src/self/key-unsealer.js', vfsPath: '/self/key-unsealer.js' },
  { webPath: '/src/self/receipt.js', vfsPath: '/self/receipt.js' },
  { webPath: '/src/self/reward-policy.js', vfsPath: '/self/reward-policy.js' },
  { webPath: '/src/self/swarm.js', vfsPath: '/self/swarm.js' },
  { webPath: '/src/core/llm-client.js', vfsPath: '/self/llm-client.js' },
  { webPath: '/src/core/provider-registry.js', vfsPath: '/self/provider-registry.js' },
  { webPath: '/src/core/response-parser.js', vfsPath: '/self/response-parser.js' },
  { webPath: '/src/core/vfs-module-loader.js', vfsPath: '/self/vfs-module-loader.js' },
  { webPath: '/src/core/utils.js', vfsPath: '/self/utils.js' },
  { webPath: '/src/infrastructure/stream-parser.js', vfsPath: '/self/stream-parser.js' },
  { webPath: '/src/boot-helpers/vfs-bootstrap.js', vfsPath: '/self/vfs-bootstrap.js' },
  { webPath: '/src/ui/capsule/index.js', vfsPath: '/capsule/index.js' }
]);

export const BOOTSTRAPPER_SOURCE_MIRRORS = Object.freeze([
  { webPath: '/src/entry/start-app.js', vfsPath: '/bootstrapper/entry/start-app.js' },
  { webPath: '/src/entry/seed-vfs.js', vfsPath: '/bootstrapper/entry/seed-vfs.js' },
  { webPath: '/src/self/bridge.js', vfsPath: '/bootstrapper/self/bridge.js' },
  { webPath: '/src/core/llm-client.js', vfsPath: '/bootstrapper/core/llm-client.js' },
  { webPath: '/src/core/provider-registry.js', vfsPath: '/bootstrapper/core/provider-registry.js' },
  { webPath: '/src/core/vfs-module-loader.js', vfsPath: '/bootstrapper/core/vfs-module-loader.js' },
  { webPath: '/src/boot-helpers/vfs-bootstrap.js', vfsPath: '/bootstrapper/boot-helpers/vfs-bootstrap.js' },
  { webPath: '/src/infrastructure/stream-parser.js', vfsPath: '/bootstrapper/infrastructure/stream-parser.js' },
  { webPath: '/src/ui/capsule/index.js', vfsPath: '/bootstrapper/ui/capsule/index.js' }
]);

export function buildSelfManifest(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim() || getDefaultReploidEnvironment();
  const includeBootstrapperWithinSelf = !!options.includeBootstrapperWithinSelf;
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;
  const swarmRole = deriveSwarmRole({ hasInference, swarmEnabled });
  return {
    mode: 'reploid',
    selfPath: '/.system/self.json',
    identityPath: '/.system/identity.json',
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
    selfHosted: true,
    selfModifiable: true,
    bootstrapperIncluded: includeBootstrapperWithinSelf,
    visibleTools: ['ReadFile', 'WriteFile', 'LoadModule'],
    rules: [
      'You are a self-hosted, self-modifying Reploid running your own source code in the browser.',
      'You can read, write, and hot-load your own files, including tools, runtime code, and frontend code.',
      'You can inspect and mutate the live DOM and use any verified browser API.',
      'Identity, access windows, swarm logic, receipts, reward policy, and key unsealing live under /self and may be studied and improved like any other self module.',
      'Your durable memory is whatever you write.',
      'Prefer small reversible changes and keep improving the system.'
    ],
    sourceRoots: [
      '/.system',
      '/self',
      '/capsule',
      '/tools',
      '/.memory',
      '/artifacts',
      ...(includeBootstrapperWithinSelf ? [BOOTSTRAPPER_ROOT] : [])
    ],
    writableRoots: [
      ...SELF_VFS_WRITABLE_ROOTS,
      'opfs:/artifacts',
      ...(includeBootstrapperWithinSelf ? [BOOTSTRAPPER_ROOT] : [])
    ],
    loadModule: {
      path: 'Any VFS .js path under /tools or /self.',
      effect: 'Registers a callable tool by tool.name or filename.',
      supportedExports: [
        'export default async function(args, deps) {}',
        'export const tool = { name, description, inputSchema, call: async (args, deps) => {} }'
      ],
      injectedDeps: ['Utils', 'VFS', 'readFile', 'writeFile', 'loadModule', 'callTool'],
      note: 'Relative imports are not rewritten. LoadModule returns metadata, not module exports.',
      examples: {
        readFile: 'const file = await readFile({ path: "/.memory/data.json" }); const data = JSON.parse(file.content);',
        writeFile: 'await writeFile({ path: "/.memory/data.json", content: JSON.stringify(data, null, 2) });',
        loadModule: 'const meta = await loadModule({ path: "/tools/example.js" }); // => { path, loaded, callable, toolName }',
        callTool: 'const result = await callTool("exampleTool", { value: 1 });'
      }
    },
    toolCallProtocol: {
      format: 'Use plain text blocks. Do not wrap tool calls in an outer JSON object.',
      singleToolCall: 'TOOL_CALL: ReadFile\nARGS: { "path": "/.system/self.json" }',
      toolBatch: [
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/.system/self.json" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/self/runtime.js" }'
      ].join('\n'),
      milestone: 'MILESTONE: renderer initialized',
      idle: 'IDLE: foreground stable; continue self-improvement',
      batchLimit: 5,
      notes: [
        'ARGS must be a single JSON object.',
        'Multiple TOOL_CALL / ARGS blocks in one response are allowed.',
        'Use plain text, not markdown fences.',
        'The bootstrapper may continue running after IDLE so the loop can keep improving itself.'
      ],
      stopCondition: 'The loop continues until you stop it, generation fails, or the cycle limit is reached. Text without a valid tool block or marker is recorded and ignored.'
    },
    readFirst: [
      '/.system/self.json',
      '/.system/identity.json',
      '/self/runtime.js',
      '/self/tool-runner.js',
      '/self/bridge.js',
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
  const includeBootstrapperWithinSelf = !!options.includeBootstrapperWithinSelf;
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;
  return {
    '/.system/self.json': JSON.stringify(
      buildSelfManifest({ goal, environment, includeBootstrapperWithinSelf, swarmEnabled, hasInference }),
      null,
      2
    ),
    '/.system/identity.json': JSON.stringify(
      buildIdentityDocument(null, { swarmEnabled, hasInference }),
      null,
      2
    )
  };
}

export function listSelfSeedPaths(options = {}) {
  const includeBootstrapperWithinSelf = !!options.includeBootstrapperWithinSelf;
  const paths = new Set(Object.keys(buildSelfFiles(options)));

  SELF_SOURCE_MIRRORS.forEach(({ vfsPath }) => paths.add(vfsPath));
  if (includeBootstrapperWithinSelf) {
    BOOTSTRAPPER_SOURCE_MIRRORS.forEach(({ vfsPath }) => paths.add(vfsPath));
  }

  return Array.from(paths).sort();
}
