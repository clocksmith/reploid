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
  'styles/boot.css',
  'styles/rd.css',
  'styles/rd-tokens.css',
  'styles/rd-primitives.css',
  'styles/rd-components.css'
]);

const REPLOID_RUNTIME_PREFIXES = Object.freeze([
  'self/bridge.js',
  'self/cloud-access.js',
  'self/tool-runner.js',
  'self/environment.js',
  'self/identity.js',
  'self/key-unsealer.js',
  'self/receipt.js',
  'self/reward-policy.js',
  'self/runtime.js',
  'self/swarm.js',
  'core/llm-client.js',
  'core/provider-registry.js',
  'core/response-parser.js',
  'core/vfs-module-loader.js',
  'infrastructure/stream-parser.js',
  'styles/capsule.css',
  'ui/capsule/index.js'
]);

export const WIZARD_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES,
  'ui/boot-wizard/index.js',
  'ui/boot-wizard/steps/awaken.js'
]);

export const LOCKED_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES
]);

export const REPLOID_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...LOCKED_HOME_BOOT_SEED_PREFIXES,
  ...REPLOID_RUNTIME_PREFIXES
]);

export const BOOT_SEED_PREFIXES = WIZARD_BOOT_SEED_PREFIXES;

export const BOOT_SEED_PROFILES = Object.freeze({
  wizard: WIZARD_BOOT_SEED_PREFIXES,
  reploid_home: REPLOID_HOME_BOOT_SEED_PREFIXES,
  zero_home: LOCKED_HOME_BOOT_SEED_PREFIXES,
  x_home: LOCKED_HOME_BOOT_SEED_PREFIXES
});

export function getBootSeedProfile() {
  if (typeof window !== 'undefined' && typeof window.getReploidBootProfile === 'function') {
    const profile = String(window.getReploidBootProfile() || '').trim();
    if (BOOT_SEED_PROFILES[profile]) {
      return profile;
    }
  }
  return 'wizard';
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
