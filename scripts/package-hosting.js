#!/usr/bin/env node
/** Create an isolated, reproducible Firebase payload from canonical assets. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildHostingFileSet, walkFiles } from './hosting-file-set.js';
import { BROWSER_BUNDLE_DESCRIPTOR_PATH, validateBrowserBundleManifest } from '../self/pool/browser-release-identity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
async function verifyArchiveProjection(selfDir, files) {
  const pin = JSON.parse(await fs.readFile(path.join(selfDir, 'config/doppler-package.json'), 'utf8'));
  const versions = [...new Set(files.filter(name => name.startsWith('vendor/doppler/')).map(name => name.split('/')[2]))];
  const staging = await fs.mkdtemp(path.join(tmpdir(), 'reploid-hosting-integrity-'));
  try {
    for (const version of versions) {
      const archive = path.join(path.dirname(selfDir), 'deploy/artifacts', `doppler-gpu-${version}.tgz`);
      const bytes = await fs.readFile(archive);
      const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      if (version === pin.version && integrity !== pin.integrity) throw new Error('Pinned Doppler archive integrity mismatch');
      const { stdout: listing } = await exec('tar', ['-tzf', archive]);
      if (listing.trim().split('\n').some(name => !name.startsWith('package/') || name.split('/').includes('..'))) throw new Error('Unsafe Doppler archive path');
      const { stdout: details } = await exec('tar', ['-tvzf', archive]);
      if (details.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw new Error('Doppler archive links are not supported');
      const directory = path.join(staging, version);
      await fs.mkdir(directory);
      await exec('tar', ['-xzf', archive, '--strip-components=1', '-C', directory]);
      const prefix = `vendor/doppler/${version}/`;
      for (const name of files.filter(name => name.startsWith(prefix))) {
        const original = await fs.readFile(path.join(directory, name.slice(prefix.length)));
        const projected = await fs.readFile(path.join(selfDir, name));
        if (!original.equals(projected)) throw new Error(`Doppler asset differs from its archive: ${name}`);
      }
    }
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
export async function packageHosting({ selfDir = path.join(root, 'self'), outputDir = path.join(root, '.firebase-hosting/reploid') } = {}) {
  if (path.resolve(outputDir) === path.resolve(selfDir)
    || path.resolve(selfDir).startsWith(path.resolve(outputDir) + path.sep)) throw new Error('Hosting output cannot replace source');
  const files = await buildHostingFileSet({ selfDir });
  await verifyArchiveProjection(selfDir, files);
  const manifest = JSON.parse(await fs.readFile(path.join(selfDir, BROWSER_BUNDLE_DESCRIPTOR_PATH), 'utf8'));
  const entries = await Promise.all(files.filter(name => name !== BROWSER_BUNDLE_DESCRIPTOR_PATH)
    .map(async name => ({ path: name, bytes: new Uint8Array(await fs.readFile(path.join(selfDir, name))) })));
  const validation = await validateBrowserBundleManifest(manifest, { entries });
  if (!validation.ok) throw new Error(`Hosting manifest is stale: ${validation.reasons.join('; ')}`);
  await fs.rm(outputDir, { recursive: true, force: true });
  for (const name of files) {
    const target = path.join(outputDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(selfDir, name), target);
  }
  const copied = await walkFiles(outputDir);
  if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error('Hosting output file set differs');
  console.log(`[hosting] packaged ${files.length} files as ${manifest.bundleHash}`);
  return { files, bundleHash: manifest.bundleHash };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageHosting().catch(error => { console.error('[hosting]', error.message); process.exitCode = 1; });
}
