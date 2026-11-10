#!/usr/bin/env node
// Install an ordinary npm package, then derive every delivery mirror from it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, access, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveServedFile } from '../server/browser-roots.js';

const root = resolve(import.meta.dirname, '..');
const exec = promisify(execFile);
const rawArg = process.argv[2];
const isLocalDirectory = !rawArg || existsSync(resolve(rawArg));
const source = isLocalDirectory ? resolve(rawArg || resolve(root, '../doppler')) : null;
const registrySpec = !isLocalDirectory
  ? (rawArg.startsWith('doppler-gpu@') ? rawArg : `doppler-gpu@${rawArg}`)
  : null;
let staging;
try {
  const artifacts = resolve(root, 'deploy/artifacts');
  await mkdir(artifacts, { recursive: true });
  const old = JSON.parse(await readFile(resolve(root, 'package-lock.json'))).packages['node_modules/doppler-gpu'];
  const oldFilename = `doppler-gpu-${old.version}.tgz`;
  let version;
  let filename;
  if (isLocalDirectory) {
    staging = await mkdtemp(resolve(tmpdir(), 'reploid-doppler-package-'));
    const { stdout } = await exec('npm', ['pack', source, '--pack-destination', staging, '--json'], { cwd: root });
    const [packed] = JSON.parse(stdout);
    version = packed.version;
    filename = packed.filename;
    const archive = resolve(artifacts, filename);
    const packedBytes = await readFile(resolve(staging, filename));
    try {
      if (!(await readFile(archive)).equals(packedBytes)) {
        throw new Error(`Doppler ${version} package bytes changed; increment its ordinary package version before synchronization`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await copyFile(resolve(staging, filename), archive);
    await exec('npm', ['install', '--save-exact', '--ignore-scripts', `file:${relative(root, archive)}`], { cwd: root });
    await exec(process.execPath, ['scripts/vendor-doppler.js', archive], { cwd: root });
  } else {
    await exec('npm', ['install', '--save-exact', '--ignore-scripts', registrySpec], { cwd: root });
    const installedPin = JSON.parse(await readFile(resolve(root, 'package-lock.json'))).packages['node_modules/doppler-gpu'];
    version = installedPin.version;
    filename = `doppler-gpu-${version}.tgz`;
    await exec(process.execPath, ['scripts/vendor-doppler.js'], { cwd: root });
  }
  for (const name of ['deploy/Dockerfile', '.gcloudignore', '.dockerignore']) {
    const file = resolve(root, name);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replaceAll(oldFilename, filename));
  }
  await exec(process.execPath, ['scripts/sync-doppler-generation-contract.js'], { cwd: root });
  await exec(process.execPath, ['scripts/sync-doppler-partition-contract.js'], { cwd: root });
  await exec(process.execPath, ['scripts/sync-reploid-library.js'], { cwd: root });
  const configPath = resolveServedFile('pool/pool-config.json');
  const config = JSON.parse(await readFile(configPath));
  // This is an explicit dependency upgrade, not a qualification receipt. Every
  // active consumer uses that dependency; old receipts remain historical proof.
  for (const model of config.modelCatalog || []) {
    if (model.enabled !== false && model.runtime === 'doppler') model.runtimeVersion = version;
  }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const retentionPath = resolve(artifacts, 'retention.json');
  const retention = JSON.parse(await readFile(retentionPath));
  for (const previous of retention.expandedVersions || []) {
    if (previous.version === version || retention.archivedVersions.some(row => row.version === previous.version)) continue;
    const previousFilename = `doppler-gpu-${previous.version}.tgz`;
    const bytes = await readFile(resolve(artifacts, previousFilename));
    retention.archivedVersions.push({ version: previous.version, archive: `deploy/artifacts/${previousFilename}`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
  }
  retention.archivedVersions = retention.archivedVersions.filter(row => row.version !== version);
  retention.expandedVersions = [{ version, reason: 'Current standard package-lock and browser pin' }];
  await writeFile(retentionPath, JSON.stringify(retention, null, 2) + '\n');
  const vendor = resolve(root, 'shared/vendor/doppler');
  for (const entry of await readdir(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.name)) continue;
    await access(resolve(artifacts, `doppler-gpu-${entry.name}.tgz`));
    await rm(resolve(vendor, entry.name), { recursive: true });
  }
  for (const script of ['scripts/sync-runtime-config.js', 'scripts/build-change-passport-sdk.js',
    'scripts/build-module-inventory.js', 'scripts/build-ownership-inventory.js',
    'scripts/build-vfs-manifest.js', 'scripts/build-zero-source.js', 'scripts/build-browser-bundle-manifest.js']) {
    await exec(process.execPath, [script, ...(script.includes('sync-runtime') ? ['--write'] : [])], { cwd: root });
  }
  console.log(`[doppler] installed standard package ${version}; run npm test and npm run test:distributed`);
} catch (error) {
  console.error(`[doppler] ${error.stderr || error.message}`); process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
}
