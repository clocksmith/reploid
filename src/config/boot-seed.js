/**
 * @fileoverview Shared boot seed selection for VFS bootstrap and minimal reseed flows.
 */

export const BOOT_SEED_PREFIXES = Object.freeze([
  'entry/',
  'boot-helpers/',
  'capsule/',
  'ui/boot-wizard/',
  'ui/capsule/',
  'config/boot-modes.js',
  'config/boot-seed.js',
  'config/absolute-zero-environments.js',
  'config/module-resolution.js',
  'config/genesis-levels.json',
  'config/module-registry.json',
  'config/vfs-manifest.json',
  'core/utils.js',
  'core/security-config.js',
  'core/llm-client.js',
  'core/provider-registry.js',
  'core/vfs-module-loader.js',
  'infrastructure/di-container.js',
  'infrastructure/stream-parser.js',
  'styles/boot.css',
  'styles/capsule.css',
  'styles/rd.css',
  'styles/rd-tokens.css',
  'styles/rd-primitives.css',
  'styles/rd-components.css'
]);

export function pickBootSeedFiles(files) {
  const out = [];
  const seen = new Set();
  for (const file of files || []) {
    if (typeof file !== 'string') continue;
    if (!BOOT_SEED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  out.sort();
  return out;
}
