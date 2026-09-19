import { requireSurfaceIntent } from './surface-intents.js';
import { SHARED_BOOT_UI_PREFIXES } from './surface-resources.js';
/**
 * @fileoverview Route-aware boot seed selection for VFS bootstrap.
 */

// Installed library modules load through their hosted package URLs. The host
// loader resolves mirrored URLs and allowlisted dependency misses on demand;
// declarations and unrelated library capabilities are not eager VFS seeds.

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
  'config/immutability.js',
  'config/module-resolution.js',
  'config/reploid-environments.js',
  'config/surface-intents.js',
  'config/tool-surfaces.js',
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
  'styles/rd.css',
  'styles/poolday/',
  'tools/Promote.js',
  'self/tools/Promote.js',
  'ui/pool-home/',
  'ui/reploid-home/'
]);

const POOL_HOME_BOOT_SEED_PREFIXES = Object.freeze([
  ...SHARED_BOOT_UI_PREFIXES,
  'pool/',
  'styles/poolday/',
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

export const ZERO_HOME_BOOT_SEED_PREFIXES = requireSurfaceIntent('zero').seedPrefixes;
export const X_HOME_BOOT_SEED_PREFIXES = requireSurfaceIntent('x').seedPrefixes;

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
