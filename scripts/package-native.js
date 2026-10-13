#!/usr/bin/env node
/** Deliver the existing native application by copying its canonical source bytes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { collectModuleClosure, walkFiles } from './hosting-file-set.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function nativePackageManifest(application) {
  for (const [name, spec] of Object.entries({
    'doppler-gpu': application.dependencies?.['doppler-gpu'], ws: application.dependencies?.ws,
    '@roamhq/wrtc': application.optionalDependencies?.['@roamhq/wrtc'],
    webgpu: application.optionalDependencies?.webgpu,
  })) {
    if (typeof spec !== 'string' || !spec.length) throw new Error(`Application must declare native dependency ${name}`);
  }
  return {
    name: application.name, version: application.version, private: true, type: 'module',
    description: 'Native delivery of the Reploid application', license: application.license,
    engines: { node: '>=22.13.0' },
    bin: { 'reploid-participant': './server/native-participant.js' },
    scripts: { start: 'node server/native-participant.js' },
    dependencies: {
      'doppler-gpu': application.dependencies['doppler-gpu'],
      ws: application.dependencies.ws,
      '@roamhq/wrtc': application.optionalDependencies['@roamhq/wrtc'],
    },
    optionalDependencies: { webgpu: application.optionalDependencies.webgpu },
  };
}

export async function collectNativeFiles(sourceRoot) {
  const available = new Set();
  for (const directory of ['server', 'packages/reploid/src', 'self']) {
    for (const file of await walkFiles(path.join(sourceRoot, directory))) available.add(`${directory}/${file}`);
  }
  const selected = await collectModuleClosure({ root: sourceRoot, available, entries: ['server/native-participant.js'] });
  const catalogBytes = await fs.readFile(path.join(sourceRoot, 'self/config/chat-models.json'));
  const retained = new Map([['self/config/chat-models.json', catalogBytes]]);
  const catalog = JSON.parse(catalogBytes);
  for (const model of catalog) {
    for (const file of model.source?.files || []) {
      const bundled = /^\/config\/model-(manifests|pieces|artifacts)\/[a-zA-Z0-9_.-]+$/.test(file.url || '');
      if (file.role === 'model-piece-index' && !bundled) throw new Error('Native piece index must be a bundled catalog file');
      const signedMetadata = model.capsule?.artifacts?.some(artifact => artifact.role !== 'weight-shard'
        && artifact.hash === 'sha256:' + file.hash && artifact.sizeBytes === file.sizeBytes);
      if (signedMetadata && !bundled) throw new Error('Native signed metadata must be a bundled catalog file');
      if (!bundled) continue;
      const name = `self${file.url}`;
      const bytes = await fs.readFile(path.join(sourceRoot, name));
      if (file.hashAlgorithm !== 'sha256' || digest(bytes) !== file.hash || bytes.length !== file.sizeBytes) {
        throw new Error(`Native catalog metadata differs: ${name}`);
      }
      selected.add(name);
      retained.set(name, bytes);
    }
  }
  const pinBytes = await fs.readFile(path.join(sourceRoot, 'self/config/doppler-package.json'));
  retained.set('self/config/doppler-package.json', pinBytes);
  const pin = JSON.parse(pinBytes);
  const archive = `deploy/artifacts/doppler-gpu-${pin.version}.tgz`;
  if (pin.spec !== `file:${archive}`) throw new Error('Native delivery requires the accepted application archive');
  const archiveBytes = await fs.readFile(path.join(sourceRoot, archive));
  const integrity = 'sha512-' + createHash('sha512').update(archiveBytes).digest('base64');
  if (integrity !== pin.integrity) throw new Error('Pinned Doppler archive integrity mismatch');
  selected.add(archive);
  retained.set(archive, archiveBytes);
  selected.add('docs/native-participant.md');
  const files = [...selected].sort();
  const contents = new Map(await Promise.all(files.map(async name => [name, retained.get(name) || await fs.readFile(path.join(sourceRoot, name))])));
  // Bind the retained bytes, not a subsequent checkout read, to the runtime pin.
  if ('sha512-' + createHash('sha512').update(contents.get(archive)).digest('base64') !== pin.integrity) {
    throw new Error('Pinned Doppler archive changed during packaging');
  }
  return { files, pin, contents };
}

export async function packageNative({ sourceRoot = root, outputParent = path.join(root, 'output') } = {}) {
  const { files, pin, contents } = await collectNativeFiles(sourceRoot);
  const application = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json')));
  const manifest = nativePackageManifest(application);
  if (manifest.dependencies['doppler-gpu'] !== pin.spec) throw new Error('Application Doppler dependency differs from its pin');
  await fs.mkdir(outputParent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outputParent, 'reploid-native-'));
  const directory = path.join(staging, 'reploid');
  await fs.mkdir(directory);
  const entries = [];
  for (const name of files) {
    const bytes = contents.get(name);
    const target = path.join(directory, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    entries.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  await fs.chmod(path.join(directory, 'server/native-participant.js'), 0o755);
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Start from the application's resolved graph, then prune unrelated packages.
  // Native install scripts are not executed while producing the delivery.
  await fs.copyFile(path.join(sourceRoot, 'package-lock.json'), path.join(directory, 'package-lock.json'));
  await exec('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory });
  const lock = JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json')));
  if (lock.packages['node_modules/doppler-gpu']?.integrity !== pin.integrity) throw new Error('Installed runtime lock differs from the accepted archive');
  for (const name of ['package.json', 'package-lock.json']) {
    const bytes = await fs.readFile(path.join(directory, name));
    entries.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const receipt = { schema: 'reploid.native-delivery/v1', version: application.version,
    runtime: { name: pin.name, version: pin.version, integrity: pin.integrity }, entries };
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'native-delivery.json'), bytes);
  const archive = path.join(staging, `reploid-native-${application.version}.tgz`);
  await exec('tar', ['-czf', archive, '-C', staging, 'reploid']);
  return { directory, archive, fileCount: entries.length, manifestSha256: digest(bytes),
    archiveSha256: digest(await fs.readFile(archive)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await packageNative(), null, 2));
}
