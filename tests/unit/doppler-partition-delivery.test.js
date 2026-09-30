import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as installed from 'doppler-gpu/partitions';
import pin from '../../self/config/doppler-package.json' with { type: 'json' };
import { DOPPLER_PARTITIONS_MODULE_URL } from '../../self/config/doppler-local-models.js';

const archive = path.resolve(`deploy/artifacts/doppler-gpu-${pin.version}.tgz`);
const sha512 = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

describe('partition candidate delivery', () => {
  it('ships identical installed and hosted contract bytes from the pinned archive', async () => {
    expect(sha512(readFileSync(archive))).toBe(pin.integrity);
    const hosted = path.resolve('self' + DOPPLER_PARTITIONS_MODULE_URL);
    const modulePath = 'src/partitions.js';
    const packed = execFileSync('tar', ['-xOf', archive, 'package/' + modulePath]);
    expect(readFileSync(hosted)).toEqual(packed);
    expect(readFileSync(path.join('node_modules/doppler-gpu', modulePath))).toEqual(packed);
    const browser = await import(hosted);
    expect(Object.keys(browser).sort()).toEqual(Object.keys(installed).sort());
    const args = { modelId: 'delivery-contract', numLayers: 4, hiddenSize: 2,
      vocabSize: 8, splitLayer: 2, activationDtype: 'f32' };
    expect(browser.createLayerPartitionPlan(args)).toEqual(installed.createLayerPartitionPlan(args));
  });

  it('replaces stale generated files and rejects changed archive bytes before replacing assets', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'reploid-doppler-delivery-'));
    try {
      mkdirSync(path.join(fixture, 'scripts'));
      mkdirSync(path.join(fixture, 'self/config'), { recursive: true });
      cpSync('scripts/vendor-doppler.js', path.join(fixture, 'scripts/vendor-doppler.js'));
      writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module',
        dependencies: { 'doppler-gpu': pin.spec } }));
      writeFileSync(path.join(fixture, 'package-lock.json'), JSON.stringify({ packages: {
        'node_modules/doppler-gpu': pin,
      } }));
      const target = path.join(fixture, 'self/vendor/doppler', pin.version);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'removed-module.js'), 'stale');
      execFileSync(process.execPath, [path.join(fixture, 'scripts/vendor-doppler.js'), archive]);
      expect(existsSync(path.join(target, 'removed-module.js'))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(fixture, 'self/config/doppler-package.json')))).toEqual(pin);
      const prior = readFileSync(path.join(target, 'package.json'));
      const damaged = path.join(fixture, 'damaged.tgz');
      writeFileSync(damaged, Buffer.concat([readFileSync(archive), Buffer.from('changed')]));
      expect(() => execFileSync(process.execPath,
        [path.join(fixture, 'scripts/vendor-doppler.js'), damaged], { stdio: 'pipe' })).toThrow();
      expect(readFileSync(path.join(target, 'package.json'))).toEqual(prior);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
});
