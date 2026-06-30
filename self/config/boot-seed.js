/**
 * @fileoverview Route-aware boot seed selection for VFS bootstrap.
 */

const SHARED_BOOT_UI_PREFIXES = Object.freeze([
  'entry/',
  'boot-helpers/vfs-bootstrap.js',
  'self/cloud-access.js',
  'self/cloud-access-status.js',
  'self/manifest.js',
  'self/environment.js',
  'self/identity.js',
  'self/key-unsealer.js',
  'self/receipt.js',
  'self/reward-policy.js',
  'self/swarm.js',
  'config/reploid-environments.js',
  'config/boot-modes.js',
  'config/boot-seed.js',
  'config/module-resolution.js',
  'core/utils.js',
  'core/security-config.js',
  'ui/boot-home/',
  'ui/boot-wizard/detection.js',
  'ui/boot-wizard/goals.js',
  'ui/boot-wizard/reploid-inference.js',
  'ui/boot-wizard/state.js',
  'ui/boot-wizard/steps/browser.js',
  'ui/boot-wizard/steps/choose.js',
  'ui/boot-wizard/steps/direct.js',
  'ui/boot-wizard/steps/goal.js',
  'ui/boot-wizard/steps/proxy.js',
  'ui/shared/',
  'styles/boot.css',
  'styles/rd.css',
  'styles/rd-tokens.css',
  'styles/rd-primitives.css',
  'styles/rd-components.css'
]);

const REPLOID_MINIMAL_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  'blueprint-index.json',
  'blueprints/blueprint-index-contract.md',
  'blueprints/promotion-contract.md',
  'blueprints/tabula-rasa-runtime.md',
  'blueprints/tool-contract.md',
  'capabilities/communication/signaling-config.js',
  'capabilities/communication/swarm-transport.js',
  'capabilities/communication/webrtc-swarm.js',
  'config/boot-seed.js',
  'config/module-resolution.js',
  'config/reploid-environments.js',
  'core/llm-client.js',
  'core/provider-registry.js',
  'core/response-parser.js',
  'core/security-config.js',
  'core/utils.js',
  'core/vfs-module-loader.js',
  'infrastructure/event-bus.js',
  'infrastructure/stream-parser.js',
  'prompts/kernel.md',
  'self/boot-spec.js',
  'self/bridge.js',
  'self/capsule/index.js',
  'self/environment.js',
  'self/host/seed-vfs.js',
  'self/host/start-reploid.js',
  'self/host/sw-module-loader.js',
  'self/host/vfs-bootstrap.js',
  'self/identity.js',
  'self/instance.js',
  'self/kernel/boot.js',
  'self/kernel/index.html',
  'self/manifest.js',
  'self/receipt.js',
  'self/reward-policy.js',
  'self/runtime.js',
  'self/swarm.js',
  'ui/shared/',
  'self/tool-runner.js',
  'styles/boot.css',
  'styles/capsule.css',
  'styles/rd-components.css',
  'styles/rd-primitives.css',
  'styles/rd-tokens.css',
  'styles/rd.css',
  'tools/Promote.js',
  'self/tools/Promote.js',
  'ui/pool-home/',
  'ui/reploid-home/'
]);

const POOL_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES,
  'pool/',
  'ui/pool-home/'
]);

export const WIZARD_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES,
  'ui/boot-wizard/index.js',
  'ui/boot-wizard/steps/awaken.js'
]);

export const LOCKED_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES,
  'ui/zero/index.js',
  'styles/zero.css'
]);

const ZERO_SHARED_TOOL_FILES = Object.freeze([
  'tools/ReadFile.js',
  'tools/WriteFile.js',
  'tools/EditFile.js',
  'tools/ListFiles.js',
  'tools/DeleteFile.js',
  'tools/MakeDirectory.js',
  'tools/CopyFile.js',
  'tools/MoveFile.js',
  'tools/Head.js',
  'tools/Tail.js',
  'tools/Grep.js',
  'tools/Find.js',
  'tools/FileOutline.js',
  'tools/git.js',
  'tools/ListTools.js',
  'tools/CreateTool.js',
  'tools/LoadModule.js',
  'tools/Promote.js'
]);

export const ZERO_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...LOCKED_HOME_BOOT_SEED_PREFIXES,
  'blueprint-index.json',
  'blueprints/0x000112-recursive-gepa-ring.md',
  'blueprints/blueprint-index-contract.md',
  'blueprints/promotion-contract.md',
  'blueprints/rgr-runtime-contract.md',
  'blueprints/tabula-rasa-runtime.md',
  'blueprints/tool-contract.md',
  'self/boot-spec.js',
  'self/bridge.js',
  'self/host/',
  'self/instance.js',
  'self/runtime.js',
  'self/tool-runner.js',
  'boot-helpers/',
  'config/',
  'lab/',
  'core/',
  'infrastructure/',
  'capabilities/system/',
  'personas/',
  'prompts/',
  ...ZERO_SHARED_TOOL_FILES
]);

export const REPLOID_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...REPLOID_MINIMAL_HOME_BOOT_SEED_PREFIXES
]);

export const BOOT_SEED_PREFIXES = WIZARD_BOOT_SEED_PREFIXES;

export const BOOT_SEED_PROFILES = Object.freeze({
  wizard: WIZARD_BOOT_SEED_PREFIXES,
  pool_home: POOL_HOME_BOOT_SEED_PREFIXES,
  reploid_home: REPLOID_HOME_BOOT_SEED_PREFIXES,
  substrate_console: REPLOID_HOME_BOOT_SEED_PREFIXES,
  zero_home: ZERO_HOME_BOOT_SEED_PREFIXES,
  x_home: LOCKED_HOME_BOOT_SEED_PREFIXES
});

export function getBootSeedProfile() {
  if (typeof window !== 'undefined' && typeof window.getReploidBootProfile === 'function') {
    const profile = String(window.getReploidBootProfile() || '').trim();
    if (BOOT_SEED_PROFILES[profile]) {
      return profile;
    }
  }
  return 'pool_home';
}

export function shouldHydrateFullManifest(profile = getBootSeedProfile()) {
  return profile !== 'zero_home'
    && profile !== 'reploid_home'
    && profile !== 'pool_home'
    && profile !== 'substrate_console';
}

export function shouldAwaitFullManifestBeforeStart(profile = getBootSeedProfile()) {
  return profile === 'x_home';
}

export function isLockedHomeBootProfile(profile = getBootSeedProfile()) {
  return profile === 'zero_home' || profile === 'x_home';
}

export function pickBootSeedFiles(files, profile = getBootSeedProfile()) {
  const prefixes = BOOT_SEED_PROFILES[profile] || WIZARD_BOOT_SEED_PREFIXES;
  const out = [];
  const seen = new Set();
  for (const file of files || []) {
    if (typeof file !== 'string') continue;
    if (!prefixes.some((prefix) => file.startsWith(prefix))) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  out.sort();
  return out;
}
