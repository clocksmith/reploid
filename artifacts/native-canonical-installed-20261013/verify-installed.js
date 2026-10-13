// Package membership and bytes are checked against the frozen source and npm's
// exact pack manifest. No checkout import, provider initialization or inference.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [base, evidence] = process.argv.slice(2);
assert(base && evidence);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pack = JSON.parse(await readFile(path.join(base, 'pack.json')))[0];
const installed = path.join(base, 'consumer/node_modules/doppler-gpu');
const entries = [];
for (const { path: file } of pack.files) {
  const source = await readFile(path.join(base, 'doppler', file));
  const actual = await readFile(path.join(installed, file));
  assert(source.equals(actual), 'Installed/source bytes differ: ' + file);
  entries.push({ path: file, bytes: source.length, sha256: hash(source) });
}
const actualFiles = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
    else { assert(entry.isFile(), 'Unexpected linked package member'); actualFiles.push(relative); }
  }
}
await walk(installed);
assert.deepEqual(actualFiles.sort(), entries.map(entry => entry.path).sort());
const binding = { schema: 'reploid.installed-canonical-contract-check/v1',
  dopplerSource: 'c240d4a8', applicationSource: '054ff99438e51de184e13dd3e69e4645c90895b5',
  installedDirectory: installed, node: process.version, platform: process.platform, architecture: process.arch,
  package: { name: pack.name, version: pack.version, integrity: pack.integrity, sha256: hash(await readFile(path.join(base, pack.filename))) },
  sourceArchiveSha256: hash(await readFile(path.join(base, 'source.tar'))),
  packageMembers: entries, installedMemberCount: entries.length,
  explicitInjections: ['selected token IDs and decoded text', 'transactional in-memory store with faults', 'Capsule opener and resident object for factory forwarding only'],
  GPUProviderInstalled: false, GPUOpened: false, physicalResidentQualified: false,
  scope: 'Installed public contracts, actual WebCrypto authentication and publication state machine; not model inference or durable filesystem acceptance',
  retainedFiles: {} };
for (const file of ['pack.json', 'install.txt', 'prepare.txt', 'publication.txt', 'factory.json', 'factory-stderr.txt',
  'consumer/package-lock.json', 'consumer/tests/publication-installed.js', 'consumer/tests/factory-installed.js',
  'consumer/tests/fixtures/canonical-generation-policy.json']) binding.retainedFiles[file] = hash(await readFile(path.join(base, file)));
await writeFile(evidence, JSON.stringify(binding, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, members: entries.length, archive: binding.package.sha256, scope: binding.scope }));
