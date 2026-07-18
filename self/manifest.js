/**
 * @fileoverview Reploid self manifest and canonical self mirrors.
 */

import { cloneSelfBootSpec } from './boot-spec.js';
import { OPFS_ARTIFACT_ROOTS, WRITABLE_VFS_ROOTS } from './config/vfs-policy.js';
import { getDefaultReploidEnvironment } from './environment.js';
import { buildIdentityDocument } from './identity.js';
import { getCurrentReploidInstanceId } from './instance.js';
import { deriveSwarmRole } from './swarm.js';

export const SELF_VFS_WRITABLE_ROOTS = Object.freeze([
  '/self',
  ...WRITABLE_VFS_ROOTS
]);

export const SELF_OPFS_WRITABLE_ROOTS = OPFS_ARTIFACT_ROOTS;

export const SELF_PROTECTED_PATHS = Object.freeze([]);

export const SELF_SOURCE_MIRRORS = Object.freeze([
  { webPath: '/boot-spec.js', vfsPath: '/self/boot-spec.js' },
  { webPath: '/blueprint-index.json', vfsPath: '/self/blueprint-index.json' },
  { webPath: '/prompts/kernel.md', vfsPath: '/self/prompts/kernel.md' },
  { webPath: '/blueprints/tabula-rasa-runtime.md', vfsPath: '/self/blueprints/tabula-rasa-runtime.md' },
  { webPath: '/blueprints/blueprint-index-contract.md', vfsPath: '/self/blueprints/blueprint-index-contract.md' },
  { webPath: '/blueprints/tool-contract.md', vfsPath: '/self/blueprints/tool-contract.md' },
  { webPath: '/blueprints/promotion-contract.md', vfsPath: '/self/blueprints/promotion-contract.md' },
  { webPath: '/blueprints/rgr-runtime-contract.md', vfsPath: '/self/blueprints/rgr-runtime-contract.md' },
  { webPath: '/blueprints/0x000112-recursive-gepa-ring.md', vfsPath: '/self/blueprints/0x000112-recursive-gepa-ring.md' },
  { webPath: '/blueprints/rgr-slot-topology.md', vfsPath: '/self/blueprints/rgr-slot-topology.md' },
  { webPath: '/runtime.js', vfsPath: '/self/runtime.js' },
  { webPath: '/bridge.js', vfsPath: '/self/bridge.js' },
  { webPath: '/tool-runner.js', vfsPath: '/self/tool-runner.js' },
  { webPath: '/config/lab-route-profiles.js', vfsPath: '/self/config/lab-route-profiles.js' },
  { webPath: '/config/tool-surfaces.js', vfsPath: '/self/config/tool-surfaces.js' },
  { webPath: '/config/vfs-policy.js', vfsPath: '/self/config/vfs-policy.js' },
  { webPath: '/lab/mirrors.js', vfsPath: '/self/lab/mirrors.js' },
  { webPath: '/lab/profiles.js', vfsPath: '/self/lab/profiles.js' },
  { webPath: '/lab/runtime-ui.js', vfsPath: '/self/lab/runtime-ui.js' },
  { webPath: '/lab/surface.js', vfsPath: '/self/lab/surface.js' },
  { webPath: '/core/cycle-artifacts.js', vfsPath: '/self/core/cycle-artifacts.js' },
  { webPath: '/core/import-rewrite.js', vfsPath: '/self/core/import-rewrite.js' },
  { webPath: '/core/promotion-policy.js', vfsPath: '/self/core/promotion-policy.js' },
  { webPath: '/capabilities/system/doppler-optimizer.js', vfsPath: '/self/capabilities/system/doppler-optimizer.js' },
  { webPath: '/tools/Promote.js', vfsPath: '/self/tools/Promote.js' },
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
  { webPath: '/ui/pool-home/index.js', vfsPath: '/self/ui/pool-home/index.js' },
  { webPath: '/ui/zero/index.js', vfsPath: '/self/ui/zero/index.js' },
  { webPath: '/styles/zero.css', vfsPath: '/self/styles/zero.css' },
  { webPath: '/pool/agent-client.js', vfsPath: '/self/pool/agent-client.js' },
  { webPath: '/pool/config.js', vfsPath: '/self/pool/config.js' },
  { webPath: '/pool/doppler-runtime.js', vfsPath: '/self/pool/doppler-runtime.js' },
  { webPath: '/pool/firebase-auth.js', vfsPath: '/self/pool/firebase-auth.js' },
  { webPath: '/pool/identity.js', vfsPath: '/self/pool/identity.js' },
  { webPath: '/pool/inference-receipt.js', vfsPath: '/self/pool/inference-receipt.js' },
  { webPath: '/pool/model-contract.js', vfsPath: '/self/pool/model-contract.js' },
  { webPath: '/pool/pool-config.json', vfsPath: '/self/pool/pool-config.json' },
  { webPath: '/pool/points-ledger.js', vfsPath: '/self/pool/points-ledger.js' },
  { webPath: '/pool/p2p-payload.js', vfsPath: '/self/pool/p2p-payload.js' },
  { webPath: '/pool/p2p-signaling.js', vfsPath: '/self/pool/p2p-signaling.js' },
  { webPath: '/pool/p2p-transport.js', vfsPath: '/self/pool/p2p-transport.js' },
  { webPath: '/pool/policy-router.js', vfsPath: '/self/pool/policy-router.js' },
  { webPath: '/pool/provider-client.js', vfsPath: '/self/pool/provider-client.js' },
  { webPath: '/pool/requester-client.js', vfsPath: '/self/pool/requester-client.js' },
  { webPath: '/pool/reputation.js', vfsPath: '/self/pool/reputation.js' },
  { webPath: '/pool/runtime-profile.js', vfsPath: '/self/pool/runtime-profile.js' },
  { webPath: '/pool/sdk.js', vfsPath: '/self/pool/sdk.js' },
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
  '/self/blueprints/tabula-rasa-runtime.md',
  '/self/blueprints/blueprint-index-contract.md',
  '/self/blueprints/tool-contract.md',
  '/self/blueprints/promotion-contract.md'
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
  return {
    mode: 'reploid',
    instanceId,
    selfPath: '/self/self.json',
    bootPath: '/self/boot.json',
    identityPath: '/self/identity.json',
    productModel: 'Reploid',
    operatingState: 'tabula-rasa',
    coreInvariant: 'Start small, read blueprints on demand, stage candidates under /shadow.',
    orchestratorBoundary: 'Browser-hosted runtime. See kernel prompt and blueprint index for operating rules.',
    boot: {
      kernel: {
        htmlEntry: boot.kernel.htmlEntry,
        bootEntry: boot.kernel.bootEntry
      },
      host: {
        seedEntry: boot.host.seedEntry,
        startEntry: boot.host.startEntry,
        reploidStartEntry: boot.host.reploidStartEntry,
        vfsBootstrapEntry: boot.host.vfsBootstrapEntry,
        serviceWorkerEntry: boot.host.serviceWorkerEntry
      },
      runtime: {
        runtimeEntry: boot.runtime.runtimeEntry,
        uiEntry: boot.runtime.uiEntry,
        uiStylePath: boot.runtime.uiStylePath
      }
    },
    goal,
    environment,
    inferenceAvailable: hasInference,
    networkMode: swarmEnabled ? 'swarm' : 'solo',
    operatingState: 'seed',
    topology: swarmEnabled ? 'peer-assisted' : 'local',
    blueprints: {
      indexPath: '/self/blueprint-index.json',
      activePaths: [...SELF_BLUEPRINT_PATHS],
      lazyReferencePaths: [
        '/self/blueprints/0x000112-recursive-gepa-ring.md',
        '/self/blueprints/rgr-runtime-contract.md',
        '/self/blueprints/rgr-slot-topology.md'
      ],
      selectionRule: 'Read the smallest blueprint set that matches the objective.'
    },
    shadow: {
      candidateRoot: '/shadow',
      evidenceRoot: '/artifacts',
      promotionBoundary: 'Zero starts from CreateTool and creates reader, writer, loader, and self-mutation tools as needed. Broader Reploid/X surfaces use Promote for evidence-gated /shadow to /self changes.'
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
    blueprintIndexPath: '/self/blueprint-index.json',
    promptPaths: [...SELF_PROMPT_PATHS],
    blueprintPaths: [...SELF_BLUEPRINT_PATHS],
    visibleToolsByMode: {
      zero: ['CreateTool'],
      reploid: ['ReadFile', 'WriteFile', 'EditFile', 'ListFiles', 'Grep', 'ListTools', 'CreateTool', 'LoadModule', 'Promote'],
      x: ['ReadFile', 'WriteFile', 'EditFile', 'ListFiles', 'Grep', 'ListTools', 'CreateTool', 'LoadModule', 'Promote', 'DopplerOptimize', 'SpawnWorker', 'AwaitWorkers']
    },
    sourceRoots: [
      '/self',
      '/shadow',
      '/artifacts',
      '/cycles'
    ],
    writableRoots: [
      '/shadow',
      '/artifacts',
      '/cycles',
      'opfs:/artifacts'
    ],
    readFirst: [
      '/self/self.json',
      '/self/blueprint-index.json',
      '/self/prompts/kernel.md',
      '/self/blueprints/tabula-rasa-runtime.md',
      '/self/blueprints/blueprint-index-contract.md',
      '/self/blueprints/tool-contract.md',
      '/self/blueprints/promotion-contract.md',
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
