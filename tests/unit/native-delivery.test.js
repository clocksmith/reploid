// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectNativeFiles, nativePackageManifest } from '../../scripts/package-native.js';

const exec = promisify(execFile);
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));

it('rejects undeclared native dependencies instead of emitting an incomplete installer', () => {
  expect(() => nativePackageManifest({ dependencies: { 'doppler-gpu': 'file:runtime.tgz', ws: '8.21.0' },
    optionalDependencies: { '@roamhq/wrtc': '0.10.0' } })).toThrow('Application must declare native dependency webgpu');
});

it('delivers the same native source and all catalog metadata outside the checkout without loading providers', async () => {
  const sourceRoot = path.resolve(import.meta.dirname, '../..');
  const { files, contents, pin } = await collectNativeFiles(sourceRoot);
  const application = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json')));
  const manifest = nativePackageManifest(application);
  expect(manifest.dependencies['doppler-gpu']).toBe(pin.spec);
  expect(manifest.dependencies['@roamhq/wrtc']).toBe(application.optionalDependencies['@roamhq/wrtc']);
  expect(manifest.optionalDependencies.webgpu).toBe(application.optionalDependencies.webgpu);
  expect(files).not.toContain('server/proxy.js');
  expect(files).toContain('server/native-canonical-epochs.js');
  expect(files.some(name => /shard_.*\.bin$/.test(name))).toBe(false);
  expect(files.filter(name => name.includes('/model-pieces/')).length).toBeGreaterThan(0);
  const catalog = JSON.parse(contents.get('self/config/chat-models.json'));
  for (const model of catalog) for (const file of model.source?.files || []) {
    if (/^\/config\/model-(manifests|pieces)\//.test(file.url || '')) expect(files).toContain(`self${file.url}`);
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-delivery-test-')); roots.push(directory);
  for (const name of files) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), contents.get(name));
  }
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
  const { stdout } = await exec(process.execPath, ['server/native-participant.js', '--help'], { cwd: directory });
  expect(stdout).toContain('--share-files');
  expect(stdout).toContain('--gpu-module');
  expect(stdout).toContain('--canonical');
  await expect(fs.stat(path.join(directory, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(directory, 'state'))).rejects.toMatchObject({ code: 'ENOENT' });
  const copied = await fs.readFile(path.join(directory, pin.spec.slice(5)));
  expect('sha512-' + createHash('sha512').update(copied).digest('base64')).toBe(pin.integrity);
});

it('packages pinned signed metadata and rejects remote or changed closure bytes', async () => {
  const original = await collectNativeFiles(path.resolve(import.meta.dirname, '../..'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-signed-delivery-')); roots.push(root);
  for (const [name, bytes] of original.contents) {
    const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  }
  await fs.mkdir(path.join(root, 'packages/reploid/src'), { recursive: true });
  const bytes = Buffer.from('signed WGSL bytes'), hash = createHash('sha256').update(bytes).digest('hex');
  const name = 'self/config/model-artifacts/' + hash + '.wgsl';
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), bytes);
  const catalog = JSON.parse(original.contents.get('self/config/chat-models.json'));
  const file = { path: 'artifacts/program/kernel.wgsl', role: 'wgsl', hashAlgorithm: 'sha256', hash,
    sizeBytes: bytes.length, url: name.slice(4) };
  catalog[0].source.files.push(file);
  catalog[0].capsule = { artifacts: [{ artifactId: 'kernel', role: 'wgsl', hash: 'sha256:' + hash, sizeBytes: bytes.length }] };
  const save = () => fs.writeFile(path.join(root, 'self/config/chat-models.json'), JSON.stringify(catalog));
  await save();
  expect((await collectNativeFiles(root)).contents.get(name)).toEqual(bytes);
  file.url = 'https://example.invalid/kernel.wgsl'; await save();
  await expect(collectNativeFiles(root)).rejects.toThrow('signed metadata must be a bundled');
  file.url = name.slice(4); await save(); await fs.writeFile(path.join(root, name), 'changed');
  await expect(collectNativeFiles(root)).rejects.toThrow('Native catalog metadata differs');
});
