import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getRouteBootSpec } from '../../self/boot-spec.js';
import { pickBootSeedFiles, shouldHydrateFullManifest } from '../../self/config/boot-seed.js';
import {
  buildZeroGeminiProxyConfig,
  ZERO_MANAGED_MAX_ITERATIONS
} from '../../self/ui/boot-wizard/zero-function.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '../../self/config/vfs-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const firebaseConfigPath = path.resolve(__dirname, '../../firebase.json');
const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf8'));

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

  it('skips full manifest hydration for reploid_home only', () => {
    expect(shouldHydrateFullManifest('reploid_home')).toBe(false);
    expect(shouldHydrateFullManifest('zero_home')).toBe(true);
    expect(shouldHydrateFullManifest('x_home')).toBe(true);
    expect(shouldHydrateFullManifest('wizard')).toBe(true);
  });

  it('routes /0 to the Zero tabula-rasa profile', () => {
    expect(getRouteBootSpec('/0')).toMatchObject({
      mode: 'zero',
      bootProfile: 'zero_home',
      genesisLevel: 'spark',
      surface: 'zero'
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

  it('caps the managed Zero server proxy model loop', () => {
    expect(buildZeroGeminiProxyConfig()).toMatchObject({
      maxIterations: ZERO_MANAGED_MAX_ITERATIONS
    });
    expect(ZERO_MANAGED_MAX_ITERATIONS).toBe(99);
  });
});
