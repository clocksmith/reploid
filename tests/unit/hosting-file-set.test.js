// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectModuleClosure, buildHostingFileSet, walkFiles } from '../../scripts/hosting-file-set.js';
import { packageHosting } from '../../scripts/package-hosting.js';
import { buildBrowserBundleManifest, BROWSER_BUNDLE_DESCRIPTOR_PATH } from '../../self/pool/browser-release-identity.js';

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'reploid-hosting-test-'));
  fixtures.push(root);
  return root;
}
async function put(root, name, content) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), content);
}

describe('Hosting dependency projection', () => {
  it('keeps static exports, lazy imports and runtime assets without copying unrelated source', async () => {
    const root = await fixture();
    await put(root, 'src/index.js', "export * from './required.js'; export const lazy = () => import('./lazy.js');");
    await put(root, 'src/required.js', "export const data = new URL('./required.json', import.meta.url);");
    await put(root, 'src/required.json', '{}');
    await put(root, 'src/lazy.js', 'export const ready = true;');
    await put(root, 'src/unused.js', 'export const unused = true;');
    await put(root, 'src/index.d.ts', 'export declare const ready: boolean;');
    const selected = await collectModuleClosure({ root, entries: ['src/index.js'] });
    expect([...selected].sort()).toEqual(['src/index.js', 'src/lazy.js', 'src/required.js', 'src/required.json']);
    await rm(path.join(root, 'src/lazy.js'));
    await expect(collectModuleClosure({ root, entries: ['src/index.js'] })).rejects.toThrow('Missing browser dependency: src/lazy.js');
  });

  it('excludes retired packages and declarations from the real runtime selection', async () => {
    const selfDir = path.resolve(import.meta.dirname, '../../self');
    const selected = await buildHostingFileSet({ selfDir });
    const pin = JSON.parse(await readFile(path.join(selfDir, 'config/doppler-package.json')));
    expect(selected.some(name => name.startsWith(`vendor/doppler/${pin.version}/`))).toBe(true);
    expect([...new Set(selected.filter(name => name.startsWith('vendor/doppler/')).map(name => name.split('/')[2]))])
      .toEqual([pin.version]);
    expect(selected.some(name => name.startsWith('vendor/doppler/0.6.3-dev.split.12/'))).toBe(false);
    expect(selected.some(name => name.startsWith('vendor/doppler/0.6.3-dev.split.1/'))).toBe(false);
    expect(selected.some(name => name.endsWith('.d.ts'))).toBe(false);
    expect(selected.some(name => name.includes('/src/cli/'))).toBe(false);
  });

  it('copies exact archive bytes, removes stale output and rejects a changed vendored module', async () => {
    const root = await fixture();
    const selfDir = path.join(root, 'self');
    const prefix = 'vendor/doppler/0.0.1/';
    for (const entry of ['src/index.js', 'src/partitions.js', 'src/tooling-exports.browser.js', 'src/tooling-exports/storage.js']) {
      await put(selfDir, prefix + entry, 'export const ready = true;');
      await put(path.join(root, 'archive'), 'package/' + entry, 'export const ready = true;');
    }
    await put(selfDir, prefix + 'LICENSE', 'MIT');
    await put(path.join(root, 'archive'), 'package/LICENSE', 'MIT');
    await mkdir(path.join(root, 'deploy/artifacts'), { recursive: true });
    const archive = path.join(root, 'deploy/artifacts/doppler-gpu-0.0.1.tgz');
    await promisify(execFile)('tar', ['-czf', archive, '-C', path.join(root, 'archive'), 'package']);
    const integrity = `sha512-${createHash('sha512').update(await readFile(archive)).digest('base64')}`;
    await put(selfDir, 'config/doppler-package.json', JSON.stringify({ version: '0.0.1', integrity }));
    await put(selfDir, 'pool/pool-config.json', JSON.stringify({ browserRuntime: {
      dopplerModuleUrl: '/vendor/doppler/0.0.1/src/index.js',
      dopplerStorageModuleUrl: '/vendor/doppler/0.0.1/src/tooling-exports/storage.js'
    } }));
    await put(selfDir, BROWSER_BUNDLE_DESCRIPTOR_PATH, '{}');
    const files = await buildHostingFileSet({ selfDir });
    const entries = await Promise.all(files.filter(name => name !== BROWSER_BUNDLE_DESCRIPTOR_PATH)
      .map(async name => ({ path: name, bytes: new Uint8Array(await readFile(path.join(selfDir, name))) })));
    await put(selfDir, BROWSER_BUNDLE_DESCRIPTOR_PATH, JSON.stringify(await buildBrowserBundleManifest(entries)));
    const outputDir = path.join(root, 'output');
    await put(outputDir, 'retired.js', 'stale');
    await packageHosting({ selfDir, outputDir });
    expect(await walkFiles(outputDir)).toEqual(files);
    expect(await readFile(path.join(outputDir, prefix + 'src/index.js'), 'utf8')).toBe('export const ready = true;');
    await put(selfDir, prefix + 'src/index.js', 'export const ready = false;');
    await expect(packageHosting({ selfDir, outputDir })).rejects.toThrow('Doppler asset differs from its archive');
    await put(selfDir, 'pool/pool-config.json', JSON.stringify({ browserRuntime: {
      dopplerModuleUrl: '/vendor/doppler/0.0.2/src/index.js',
      dopplerStorageModuleUrl: '/vendor/doppler/0.0.1/src/tooling-exports/storage.js'
    } }));
    await expect(buildHostingFileSet({ selfDir })).rejects.toThrow('Doppler consumer differs from the pinned package');
  });
});
