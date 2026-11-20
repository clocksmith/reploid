#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const browserAssets = JSON.parse(readFileSync(path.join(root, 'scripts/doppler-browser-assets.json')));
if (browserAssets.schema !== 'reploid.doppler-browser-assets/v1' || !Array.isArray(browserAssets.excludedRuntimeProfiles)) {
  throw new Error('Invalid Doppler browser asset policy');
}
const pin = JSON.parse(readFileSync(path.join(root, 'package-lock.json'))).packages['node_modules/dopplerx'];
const hex = Buffer.from(pin.integrity.split('-')[1], 'base64').toString('hex');
const cache = execFileSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).trim();
const archive = process.argv[2] || path.join(cache, '_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
if (!existsSync(archive)) throw new Error('Supply the exact pinned Doppler archive; it is not in the npm cache.');
const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
if (integrity !== pin.integrity) throw new Error('Doppler archive integrity mismatch');
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (entries.some(entry => !entry.startsWith('package/') || entry.split('/').includes('..'))) throw new Error('Unsafe archive path');
const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
if (listing.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw new Error('Archive links are not supported');
const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
if (manifest.name !== 'dopplerx' || manifest.version !== pin.version) throw new Error('Archive package identity mismatch');
const versionSource = execFileSync('tar', ['-xOf', archive, 'package/src/version.js'], { encoding: 'utf8' });
const runtimeVersion = versionSource.match(/export const DOPPLER_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
if (runtimeVersion !== pin.version) throw new Error('Archive runtime version differs from package identity');
const target = path.join(root, 'shared/vendor/doppler', pin.version);
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(pin.version)) throw new Error('Invalid Doppler version');
mkdirSync(path.dirname(target), { recursive: true });
// Replace the complete generated tree: unpacking over an older tree leaves
// removed modules available under an otherwise correctly identified version.
const staging = mkdtempSync(path.join(path.dirname(target), '.doppler-'));
const backup = `${staging}-previous`;
let replaced = false;
try {
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', staging]);
  // Select browser assets without rewriting any retained package bytes. Historical
  // kernel reachability labels remain exactly as authenticated by the archive.
  for (const profile of browserAssets.excludedRuntimeProfiles) {
    if (!/^[a-zA-Z0-9_.-]+\.json$/.test(profile.file) || !/^[a-f0-9]{64}$/.test(profile.sha256)) {
      throw new Error('Invalid excluded Doppler profile identity');
    }
    const file = path.join(staging, 'src/config/runtime/profiles', profile.file);
    if (!existsSync(file)) continue;
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== profile.sha256) {
      throw new Error(`Excluded Doppler profile differs from its reviewed identity: ${profile.file}`);
    }
    rmSync(file);
  }
  if (existsSync(target)) renameSync(target, backup);
  try { renameSync(staging, target); replaced = true; }
  catch (error) {
    if (existsSync(backup)) renameSync(backup, target);
    throw error;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
  if (replaced) rmSync(backup, { recursive: true, force: true });
}
const archiveDirectory = path.join(root, 'deploy/artifacts');
mkdirSync(archiveDirectory, { recursive: true });
const archived = path.join(archiveDirectory, `${pin.name}-${pin.version}.tgz`);
if (path.resolve(archive) !== archived) copyFileSync(archive, archived);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json')));
// The pin is shared browser configuration; this script runs standalone, so it names its root.
writeFileSync(path.join(root, 'shared/config/doppler-package.json'), JSON.stringify({
  name: manifest.name, version: pin.version, spec: packageJson.dependencies[manifest.name],
  resolved: pin.resolved, integrity: pin.integrity,
}, null, 2) + '\n');
console.log(JSON.stringify({ version: pin.version, integrity, files: entries.length, target }));
