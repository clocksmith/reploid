import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pickBootSeedFiles, shouldHydrateFullManifest } from '../../self/config/boot-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '../../self/config/vfs-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

describe('boot seed manifest', () => {
  it('includes the shared instance helper in the checked-in VFS manifest', () => {
    expect(manifest.files).toContain('self/instance.js');
  });

  it('hydrates self/instance.js in the reploid home boot seed', () => {
    const bootFiles = pickBootSeedFiles(manifest.files, 'reploid_home');

    expect(bootFiles).toContain('self/host/start-reploid.js');
    expect(bootFiles).toContain('self/kernel/boot.js');
    expect(bootFiles).toContain('self/boot-spec.js');
    expect(bootFiles).toContain('self/dream-instance.js');
    expect(bootFiles).toContain('self/instance.js');
    expect(bootFiles).toContain('blueprints/rgr-dream-instance-manifest.md');
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
});
