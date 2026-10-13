// CPU-only installed delivery verification; no host/provider initialization.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const [directory, archive, output] = process.argv.slice(2);
assert(directory && archive && output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const descriptorBytes = await fs.readFile(path.join(directory, 'native-delivery.json'));
const descriptor = JSON.parse(descriptorBytes);
for (const entry of descriptor.entries) {
  assert(!entry.path.split('/').includes('..') && !path.isAbsolute(entry.path));
  const bytes = await fs.readFile(path.join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path); assert.equal(hash(bytes), entry.sha256, entry.path);
}
const runtimeArchive = await fs.readFile(path.join(directory, 'deploy/artifacts/doppler-gpu-0.6.28.tgz'));
assert.equal(hash(runtimeArchive), '9264d265a90c7c0b046adf46135965b2032d2d9f6e5e60d6a8149d10f0988ec4');
const pin = JSON.parse(await fs.readFile(path.join(directory, 'self/config/doppler-package.json')));
assert.equal(pin.integrity, 'sha512-' + createHash('sha512').update(runtimeArchive).digest('base64'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-native-verify-'));
let runtimeFiles = 0;
async function compare(source, installed) {
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    assert(!item.isSymbolicLink());
    if (item.isDirectory()) await compare(path.join(source, item.name), path.join(installed, item.name));
    else { assert((await fs.readFile(path.join(source, item.name))).equals(await fs.readFile(path.join(installed, item.name))), item.name); runtimeFiles++; }
  }
}
try {
  await exec('tar', ['-xzf', path.join(directory, 'deploy/artifacts/doppler-gpu-0.6.28.tgz'), '-C', temporary]);
  await compare(path.join(temporary, 'package'), path.join(directory, 'node_modules/doppler-gpu'));
} finally { await fs.rm(temporary, { recursive: true }); }
const catalogBytes = await fs.readFile(path.join(directory, 'self/config/chat-models.json'));
const catalog = JSON.parse(catalogBytes);
assert(catalog.every(model => !model.canonicalGeneration && !model.capsule), 'Base must not masquerade as finalized signed catalog');
const dependencyVersions = {};
for (const name of ['doppler-gpu', '@roamhq/wrtc', 'ws', 'webgpu']) {
  dependencyVersions[name] = JSON.parse(await fs.readFile(path.join(directory, 'node_modules', name, 'package.json'))).version;
}
await fs.writeFile(output, JSON.stringify({ schema: 'reploid.native-base-verification/v1', directory,
  nativeArchiveSha256: hash(await fs.readFile(archive)), descriptorSha256: hash(descriptorBytes),
  nativeFiles: descriptor.entries.length, runtimeFiles, runtimeArchiveSha256: hash(runtimeArchive),
  catalogSha256: hash(catalogBytes), catalogStage: 'committed unsigned base; no ordered signed eligibility',
  dependencyVersions, node: process.version, platform: process.platform, architecture: process.arch,
  GPUOpened: false, publicContributorChanged: false, ledgerOpened: false, physicalQualified: false }, null, 2) + '\n');
console.log(`Verified ${descriptor.entries.length} native files and ${runtimeFiles} runtime files; no GPU opened`);
