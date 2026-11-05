import sourceCatalog from './self-source-catalog.json' with { type: 'json' };
/** Declarative resources composed once by surface-intents. */
export const SHARED_BOOT_UI_PREFIXES = Object.freeze([
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
  'config/doppler-local-models.js',
  'config/immutability.js',
  'config/reploid-environments.js',
  'config/surface-intents.js',
  'config/tool-surfaces.js',
  'config/file-tool-schemas.json',
  'config/zero-inference.js',
  'config/boot-modes.js',
  'config/boot-seed.js',
  'config/module-resolution.js',
  'core/utils.js',
  'core/security-config.js',
  'ui/boot-home/',
  'ui/boot-wizard/connection-tests.js',
  'ui/boot-wizard/detection.js',
  'ui/boot-wizard/goals.js',
  'ui/boot-wizard/reploid-inference.js',
  'ui/boot-wizard/state.js',
  'ui/boot-wizard/steps/browser.js',
  'ui/boot-wizard/steps/choose.js',
  'ui/boot-wizard/steps/direct.js',
  'ui/boot-wizard/steps/goal.js',
  'ui/boot-wizard/steps/proxy.js',
  'ui/components/html.js',
  'ui/components/vfs-progress.js',
  'ui/shared/',
  'styles/boot.css',
  'styles/rd.css'
]);

// Compatibility exports retain the existing seed API. The selected closure, not
// a broad prefix directory, owns the minimal lab's source inventory.
export const X_SEED_PREFIXES = Object.freeze([...sourceCatalog.profiles.spark.seedFiles]);
export const ZERO_SEED_PREFIXES = X_SEED_PREFIXES;
export const ZERO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([]);

export const PROTO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([
  { sourcePath: '/ui/toast.js', targetPath: '/self/ui/toast.js' },
  { sourcePrefix: '/ui/components/', targetPrefix: '/self/ui/components/' },
  { sourcePrefix: '/ui/panels/', targetPrefix: '/self/ui/panels/' },
  { sourcePrefix: '/ui/proto/', targetPrefix: '/self/ui/proto/' },
  { sourcePrefix: '/styles/proto/', targetPrefix: '/self/styles/proto/' }
]);

export const ZERO_RUNTIME_UI = Object.freeze({
  name: 'zero',
  stylePath: '/styles/zero.css',
  vfsModulePath: '/ui/zero/index.js',
  sourceModulePath: '/ui/zero/index.js',
  allowSourceFallback: false
});

export const PROTO_RUNTIME_UI = Object.freeze({
  name: 'proto',
  stylePath: '/self/styles/proto/index.css',
  vfsModulePath: '/self/ui/proto/index.js',
  sourceModulePath: '/ui/proto/index.js',
  allowSourceFallback: false
});
