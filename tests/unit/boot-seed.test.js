import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getRouteBootSpec } from '../../self/boot-spec.js';
import {
  pickBootSeedFiles,
  shouldAwaitFullManifestBeforeStart,
  shouldHydrateFullManifest
} from '../../self/config/boot-seed.js';
import { AWAKEN_REQUIRED_MODULES } from '../../self/config/module-resolution.js';
import { resolveModules } from '../../self/boot-helpers/config.js';
import {
  buildZeroGeminiProxyConfig,
  ZERO_GEMINI_AGENT_THROTTLE,
  ZERO_MANAGED_MAX_ITERATIONS
} from '../../self/ui/boot-wizard/zero-function.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '../../self/config/vfs-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const firebaseConfigPath = path.resolve(__dirname, '../../firebase.json');
const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf8'));
const genesisConfigPath = path.resolve(__dirname, '../../self/config/genesis-levels.json');
const genesisConfig = JSON.parse(readFileSync(genesisConfigPath, 'utf8'));
const moduleRegistryPath = path.resolve(__dirname, '../../self/config/module-registry.json');
const moduleRegistry = JSON.parse(readFileSync(moduleRegistryPath, 'utf8'));

describe('boot seed manifest', () => {
  it('includes the shared instance helper in the checked-in VFS manifest', () => {
    expect(manifest.files).toContain('self/instance.js');
  });

  it('hydrates self/instance.js and tabula-rasa contracts in the reploid home boot seed', () => {
    const bootFiles = pickBootSeedFiles(manifest.files, 'reploid_home');

    expect(bootFiles).toContain('self/host/start-reploid.js');
    expect(bootFiles).toContain('self/kernel/boot.js');
    expect(bootFiles).toContain('self/boot-spec.js');
    expect(bootFiles).not.toContain('self/dream-instance.js');
    expect(bootFiles).toContain('self/instance.js');
    expect(bootFiles).toContain('blueprints/tabula-rasa-runtime.md');
    expect(bootFiles).toContain('blueprints/blueprint-index-contract.md');
    expect(bootFiles).toContain('blueprints/tool-contract.md');
    expect(bootFiles).toContain('blueprints/promotion-contract.md');
    expect(bootFiles).not.toContain('blueprints/0x000112-recursive-gepa-ring.md');
    expect(bootFiles).not.toContain('blueprints/rgr-dream-instance-manifest.md');
    expect(bootFiles).toContain('ui/reploid-home/index.js');
    expect(bootFiles).toContain('capabilities/communication/swarm-transport.js');
    expect(bootFiles).toContain('core/utils.js');
    expect(bootFiles).toContain('infrastructure/event-bus.js');
    expect(bootFiles).not.toContain('ui/boot-home/index.js');
    expect(bootFiles.some((file) => file.startsWith('ui/boot-wizard/'))).toBe(false);
  });

  it('skips full manifest hydration for locked and minimal home profiles', () => {
    expect(shouldHydrateFullManifest('reploid_home')).toBe(false);
    expect(shouldHydrateFullManifest('zero_home')).toBe(false);
    expect(shouldHydrateFullManifest('pool_home')).toBe(false);
    expect(shouldHydrateFullManifest('substrate_console')).toBe(false);
    expect(shouldHydrateFullManifest('x_home')).toBe(true);
    expect(shouldHydrateFullManifest('wizard')).toBe(true);
  });

  it('awaits full VFS hydration before start only for the mature workspace', () => {
    expect(shouldAwaitFullManifestBeforeStart('x_home')).toBe(true);
    expect(shouldAwaitFullManifestBeforeStart('zero_home')).toBe(false);
    expect(shouldAwaitFullManifestBeforeStart('reploid_home')).toBe(false);
    expect(shouldAwaitFullManifestBeforeStart('pool_home')).toBe(false);
    expect(shouldAwaitFullManifestBeforeStart('wizard')).toBe(false);
  });

  it('hydrates the Zero runtime UI files in the locked boot seed', () => {
    const bootFiles = pickBootSeedFiles(manifest.files, 'zero_home');

    expect(bootFiles).toContain('blueprint-index.json');
    expect(bootFiles).toContain('blueprints/blueprint-index-contract.md');
    expect(bootFiles).toContain('blueprints/tool-contract.md');
    expect(bootFiles).not.toContain('blueprints/promotion-contract.md');
    expect(bootFiles).not.toContain('blueprints/rgr-runtime-contract.md');
    expect(bootFiles).toContain('ui/zero/index.js');
    expect(bootFiles).toContain('styles/zero.css');
    expect(bootFiles).toContain('core/run-replay-bundle.js');
    expect(bootFiles).not.toContain('styles/poolday.css');
    expect(bootFiles).not.toContain('styles/rd-components.css');
    expect(bootFiles).not.toContain('styles/rd-primitives.css');
    expect(bootFiles).not.toContain('styles/rd-tokens.css');
    expect(bootFiles).toContain('ui/boot-home/index.js');
    expect(bootFiles).toContain('ui/boot-wizard/zero-function.js');
    expect(bootFiles).toContain('ui/boot-wizard/steps/goal.js');
    expect(bootFiles).not.toContain('ui/pool-home/index.js');
    expect(bootFiles).not.toContain('ui/reploid-home/index.js');
  });

  it('hydrates the Poolday route extension only in Poolday home boot seeds', () => {
    const poolBootFiles = pickBootSeedFiles(manifest.files, 'pool_home');
    const reploidHomeFiles = pickBootSeedFiles(manifest.files, 'reploid_home');
    const zeroBootFiles = pickBootSeedFiles(manifest.files, 'zero_home');

    expect(poolBootFiles).toContain('styles/poolday.css');
    expect(reploidHomeFiles).toContain('styles/poolday.css');
    expect(zeroBootFiles).not.toContain('styles/poolday.css');
  });

  it('keeps Zero lightweight while X absorbs the Zero boot surface', () => {
    const zeroBootFiles = pickBootSeedFiles(manifest.files, 'zero_home');
    const xBootFiles = pickBootSeedFiles(manifest.files, 'x_home');
    const xBootSet = new Set(xBootFiles);

    expect(zeroBootFiles.length).toBeLessThanOrEqual(120);
    expect(zeroBootFiles).not.toContain('tools/DeleteFile.js');
    expect(zeroBootFiles).not.toContain('tools/CopyFile.js');
    expect(zeroBootFiles).not.toContain('tools/git.js');
    expect(zeroBootFiles).not.toContain('tools/Promote.js');
    expect(zeroBootFiles).not.toContain('blueprints/promotion-contract.md');
    expect(zeroBootFiles).not.toContain('blueprints/rgr-runtime-contract.md');
    expect(zeroBootFiles).not.toContain('capabilities/system/README.md');
    expect(zeroBootFiles).not.toContain('core/README.md');
    expect(zeroBootFiles).not.toContain('infrastructure/README.md');
    expect(zeroBootFiles.every((file) => xBootSet.has(file))).toBe(true);
    expect(xBootFiles).toContain('blueprints/promotion-contract.md');
    expect(xBootFiles).toContain('blueprints/rgr-runtime-contract.md');
    expect(xBootFiles).toContain('tools/Promote.js');
    expect(xBootFiles).toContain('ui/proto/index.js');
    expect(xBootFiles).toContain('styles/proto/index.css');
  });

  it('routes /zero to the Zero tabula-rasa profile', () => {
    expect(getRouteBootSpec('/zero')).toMatchObject({
      mode: 'zero',
      bootProfile: 'zero_home',
      genesisLevel: 'spark',
      surface: 'zero'
    });
  });

  it('normalizes substrate route trailing slashes', () => {
    expect(getRouteBootSpec('/zero/')).toMatchObject({
      mode: 'zero',
      bootProfile: 'zero_home'
    });
    expect(getRouteBootSpec('/x/')).toMatchObject({
      mode: 'x',
      bootProfile: 'x_home'
    });
  });

  it('rewrites the deployed API proxy to Cloud Run', () => {
    const hosting = firebaseConfig.hosting.find((entry) => entry.target === 'reploid');
    expect(hosting?.rewrites).toContainEqual({
      source: '/api/**',
      run: {
        serviceId: 'reploid-pool',
        region: 'us-central1'
      }
    });
  });

  it('rewrites the Zero model proxy to a Firebase function', () => {
    const hosting = firebaseConfig.hosting.find((entry) => entry.target === 'reploid');
    expect(firebaseConfig.functions).toMatchObject({
      source: 'functions'
    });
    expect(hosting?.rewrites).toContainEqual({
      source: '/zero/gemini',
      function: {
        functionId: 'zeroGemini',
        region: 'us-central1'
      }
    });
  });

  it('routes stale split rd.css requests back to the self-contained bundle', () => {
    const hosting = firebaseConfig.hosting.find((entry) => entry.target === 'reploid');

    for (const source of [
      '/styles/rd-tokens.css',
      '/styles/rd-primitives.css',
      '/styles/rd-components.css',
      '/rd-tokens.css',
      '/rd-primitives.css',
      '/rd-components.css'
    ]) {
      expect(hosting?.rewrites).toContainEqual({
        source,
        destination: '/styles/rd.css'
      });
    }
  });

  it('caps the managed Zero server proxy model loop', () => {
    expect(buildZeroGeminiProxyConfig()).toMatchObject({
      maxIterations: ZERO_MANAGED_MAX_ITERATIONS,
      agentThrottle: ZERO_GEMINI_AGENT_THROTTLE
    });
    expect(ZERO_MANAGED_MAX_ITERATIONS).toBe(99);
    expect(ZERO_GEMINI_AGENT_THROTTLE).toMatchObject({
      minProviderRequestIntervalMs: 6000,
      providerAutoResume: true
    });
  });

  it('expands capsule genesis into a complete awaken runtime', () => {
    const resolved = resolveModules('capsule', genesisConfig, moduleRegistry, {});

    expect(resolved).toEqual(expect.arrayContaining(AWAKEN_REQUIRED_MODULES));
    expect(resolved).toEqual(expect.arrayContaining([
      'ContextManager',
      'PersonaManager',
      'CircuitBreaker',
      'ProviderRegistry'
    ]));
  });
});
