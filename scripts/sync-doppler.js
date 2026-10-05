#!/usr/bin/env node
// Install an ordinary npm package, then derive every delivery mirror from it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, access, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const exec = promisify(execFile);
const source = resolve(process.argv[2] || resolve(root, '../doppler'));
let staging;
try {
  const artifacts = resolve(root, 'deploy/artifacts');
  await mkdir(artifacts, { recursive: true });
  staging = await mkdtemp(resolve(tmpdir(), 'reploid-doppler-package-'));
  const { stdout } = await exec('npm', ['pack', source, '--pack-destination', staging, '--json'], { cwd: root });
  const [packed] = JSON.parse(stdout);
  const archive = resolve(artifacts, packed.filename);
  const packedBytes = await readFile(resolve(staging, packed.filename));
  try {
    if (!(await readFile(archive)).equals(packedBytes)) {
      throw new Error(`Doppler ${packed.version} package bytes changed; increment its ordinary package version before synchronization`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copyFile(resolve(staging, packed.filename), archive);
  const old = JSON.parse(await readFile(resolve(root, 'package-lock.json'))).packages['node_modules/doppler-gpu'];
  await exec('npm', ['install', '--save-exact', '--ignore-scripts', `file:${relative(root, archive)}`], { cwd: root });
  for (const name of ['Dockerfile', '.gcloudignore', '.dockerignore']) {
    const file = resolve(root, name);
    const text = await readFile(file, 'utf8');
    const oldName = old.resolved.split('/').at(-1);
    await writeFile(file, text.replaceAll(oldName, packed.filename));
  }
  await exec(process.execPath, ['scripts/vendor-doppler.js', archive], { cwd: root });
  await exec(process.execPath, ['scripts/sync-doppler-generation-contract.js'], { cwd: root });
  const configPath = resolve(root, 'self/pool/pool-config.json');
  const config = JSON.parse(await readFile(configPath));
  // This is an explicit dependency upgrade, not a qualification receipt. Every
  // active consumer uses that dependency; old receipts remain historical proof.
  for (const model of config.modelCatalog || []) {
    if (model.enabled !== false && model.runtime === 'doppler') model.runtimeVersion = packed.version;
  }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const retentionPath = resolve(artifacts, 'retention.json');
  const retention = JSON.parse(await readFile(retentionPath));
  for (const previous of retention.expandedVersions || []) {
    if (previous.version === packed.version || retention.archivedVersions.some(row => row.version === previous.version)) continue;
    const filename = `doppler-gpu-${previous.version}.tgz`;
    const bytes = await readFile(resolve(artifacts, filename));
    retention.archivedVersions.push({ version: previous.version, archive: `deploy/artifacts/${filename}`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
  }
  retention.archivedVersions = retention.archivedVersions.filter(row => row.version !== packed.version);
  retention.expandedVersions = [{ version: packed.version, reason: 'Current standard package-lock and browser pin' }];
  await writeFile(retentionPath, JSON.stringify(retention, null, 2) + '\n');
  const vendor = resolve(root, 'self/vendor/doppler');
  for (const entry of await readdir(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === packed.version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.name)) continue;
    await access(resolve(artifacts, `doppler-gpu-${entry.name}.tgz`));
    await rm(resolve(vendor, entry.name), { recursive: true });
  }
  for (const script of ['scripts/sync-runtime-config.js', 'scripts/build-module-inventory.js',
    'scripts/build-vfs-manifest.js', 'scripts/build-browser-bundle-manifest.js']) {
    await exec(process.execPath, [script, ...(script.includes('sync-runtime') ? ['--write'] : [])], { cwd: root });
  }
  console.log(`[doppler] installed standard package ${packed.version}; run npm test and npm run test:distributed`);
} catch (error) {
  console.error(`[doppler] ${error.stderr || error.message}`); process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
}
