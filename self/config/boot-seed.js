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
  'tools/Grep.js',
  'tools/ListTools.js',
  'tools/CreateTool.js',
  'tools/LoadModule.js',
  'tools/Promote.js'
]);

export const ZERO_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  'entry/',
  'blueprints/rgr-runtime-contract.md',
  'blueprints/promotion-contract.md',
  'blueprints/tabula-rasa-runtime.md',
  'blueprints/tool-contract.md',
  'boot-helpers/config.js',
  'boot-helpers/error-ui.js',
  'boot-helpers/index.js',
  'boot-helpers/modules.js',
  'boot-helpers/services.js',
  'boot-helpers/vfs-bootstrap.js',
  'boot-helpers/vfs-hydrate.js',
  'capabilities/system/doppler-toolbox.js',
  'capabilities/system/substrate-loader.js',
  'config/boot-modes.js',
  'config/boot-seed.js',
  'config/genesis-levels.json',
  'config/lab-route-profiles.js',
  'config/module-registry.json',
  'config/module-resolution.js',
  'config/reploid-environments.js',
  'config/tool-surfaces.js',
  'config/vfs-manifest.json',
  'core/agent-loop.js',
  'core/context-manager.js',
  'core/cycle-artifacts.js',
  'core/import-rewrite.js',
  'core/llm-client.js',
  'core/persona-manager.js',
  'core/promotion-policy.js',
  'core/provider-registry.js',
  'core/response-parser.js',
  'core/schema-registry.js',
  'core/security-config.js',
  'core/state-helpers-pure.js',
  'core/state-manager.js',
  'core/tool-runner.js',
  'core/tool-writer.js',
  'core/utils.js',
  'core/vfs.js',
  'core/vfs-module-loader.js',
  'infrastructure/circuit-breaker.js',
  'infrastructure/di-container.js',
  'infrastructure/error-store.js',
  'infrastructure/event-bus.js',
  'infrastructure/telemetry-timeline.js',
  'infrastructure/tool-executor.js',
  'lab/mirrors.js',
  'lab/profiles.js',
  'lab/runtime-ui.js',
  'lab/surface.js',
  'personas/config.json',
  'prompts/kernel.md',
  'self/boot-spec.js',
  'self/bridge.js',
  'self/cloud-access.js',
  'self/cloud-access-status.js',
  'self/environment.js',
  'self/host/seed-vfs.js',
  'self/host/start-app.js',
  'self/host/sw-module-loader.js',
  'self/host/vfs-bootstrap.js',
  'self/identity.js',
  'self/instance.js',
  'self/key-unsealer.js',
  'self/manifest.js',
  'self/receipt.js',
  'self/reward-policy.js',
  'self/runtime.js',
  'self/swarm.js',
  'self/tool-runner.js',
  'styles/boot.css',
  'styles/rd.css',
  'styles/rd-components.css',
  'styles/rd-primitives.css',
  'styles/rd-tokens.css',
  'styles/zero.css',
  'ui/boot-home/index.js',
  'ui/boot-wizard/detection.js',
  'ui/boot-wizard/goals.js',
  'ui/boot-wizard/reploid-inference.js',
  'ui/boot-wizard/state.js',
  'ui/boot-wizard/zero-function.js',
  'ui/boot-wizard/steps/browser.js',
  'ui/boot-wizard/steps/choose.js',
  'ui/boot-wizard/steps/direct.js',
  'ui/boot-wizard/steps/goal.js',
  'ui/boot-wizard/steps/proxy.js',
  'ui/toast.js',
  'ui/zero/index.js',
  ...ZERO_SHARED_TOOL_FILES
]);

export const X_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...ZERO_HOME_BOOT_SEED_PREFIXES,
  'styles/proto/',
  'ui/proto/'
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
  x_home: X_HOME_BOOT_SEED_PREFIXES
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
