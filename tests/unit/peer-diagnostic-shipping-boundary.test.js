// @vitest-environment node
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import dopplerPackage from '../../shared/config/doppler-package.json' with { type: 'json' };

const profile = 'qwen3-6-35b-a3b-q4_0-pooled-q8-common-diagnostic.json';
const vendor = `shared/vendor/doppler/${dopplerPackage.version}/`;

describe('peer diagnostic shipping boundary', () => {
  it('re-vendors reproducibly and rejects a changed diagnostic before replacing the prior tree', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'reploid-vendor-boundary-'));
    const put = (name, bytes) => {
      const file = path.join(root, name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes);
    };
    try {
      const excluded = `src/config/runtime/profiles/${profile}`;
      const registry = Buffer.from(JSON.stringify({ operations: { probe: { reachability: {
        inlineConfigs: [profile.replace('.json', '')]
      } } } }));
      put(`archive/package/${excluded}`, readFileSync(`tests/fixtures/peers/pooled/${profile}`));
      put('archive/package/src/config/kernels/registry.json', registry);
      put('archive/package/src/version.js', "export const DOPPLER_VERSION = '0.0.1';");
      put('archive/package/package.json', JSON.stringify({ name: 'dopplerx', version: '0.0.1' }));
      put('scripts/vendor-doppler.js', readFileSync('scripts/vendor-doppler.js'));
      put('scripts/doppler-browser-assets.json', readFileSync('scripts/doppler-browser-assets.json'));
      put('package.json', JSON.stringify({ type: 'module', dependencies: {
        'dopplerx': 'file:deploy/artifacts/doppler-gpu-0.0.1.tgz'
      } }));
      mkdirSync(path.join(root, 'shared/config'), { recursive: true });
      mkdirSync(path.join(root, 'deploy/artifacts'), { recursive: true });
      const archive = path.join(root, 'deploy/artifacts/doppler-gpu-0.0.1.tgz');
      const pack = () => {
        execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'archive'), 'package']);
        put('package-lock.json', JSON.stringify({ packages: { 'node_modules/dopplerx': {
          version: '0.0.1', integrity: 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64')
        } } }));
      };
      const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/vendor-doppler.js'), archive],
        { cwd: root, encoding: 'utf8', timeout: 10000 });
      pack();
      for (let pass = 0; pass < 2; pass++) {
        const result = run(); expect(result.status, result.stderr).toBe(0);
        const target = path.join(root, 'shared/vendor/doppler/0.0.1');
        expect(existsSync(path.join(target, excluded))).toBe(false);
        expect(readFileSync(path.join(target, 'src/config/kernels/registry.json')).equals(registry)).toBe(true);
      }
      put('shared/vendor/doppler/0.0.1/prior-tree', 'keep');
      put(`archive/package/${excluded}`, 'changed diagnostic'); pack();
      const refused = run();
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain('Excluded Doppler profile differs from its reviewed identity');
      expect(readFileSync(path.join(root, 'shared/vendor/doppler/0.0.1/prior-tree'), 'utf8')).toBe('keep');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 15000);

  it('preserves the pinned kernel registry, including historical reachability metadata', () => {
    const registry = readFileSync(`${vendor}src/config/kernels/registry.json`);
    const archive = dopplerPackage.resolved.replace(/^file:/, '');
    const archived = execFileSync('tar', ['-xOf', archive, 'package/src/config/kernels/registry.json']);
    expect(registry.equals(archived)).toBe(true);
  });
  it('retains the exact diagnostic identity only in explicit peer fixtures', () => {
    const bytes = readFileSync(`tests/fixtures/peers/pooled/${profile}`);
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe('de27a1fd23f676039b06111b7abd1085b36dd682dcb7baa49fedfe882decf297');
    expect(JSON.parse(bytes).model).toBe('qwen-3-6-35b-a3b-text-source-q4_0-af32-pooled-q8-common');
    expect(existsSync(`${vendor}src/config/runtime/profiles/${profile}`)).toBe(false);
  });

  it('excludes the peer diagnostic profile from served inventories', () => {
    for (const file of [
      'self/config/vfs-manifest.json',
      'docs/ownership-inventory.json',
      'apps/poolday/config/browser-bundle-manifest.json'
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(profile.replace('.json', ''));
    }
  });
});
