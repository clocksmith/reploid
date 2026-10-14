// CPU-only checks run before staging a signed catalog into an application export.
// Opens no GPU, browser, server, peer, stored checkpoint or ledger, and writes only
// its receipt plus a runtime extraction into a caller-supplied new directory.
//
// New script. Its runtime-archive and catalog-shape checks are adapted from
// artifacts/basic-signed-candidate-20261013/final/verify-native.js. Every difference
// from that original:
//  1. Expected runtime archive is 2df37d88... (original: 0fadac51...).
//  2. It inspects the application export before packaging, so there is no native
//     descriptor or native tarball check (original: verified an installed native package).
//  3. The archive is extracted into a new caller-supplied directory that is left in
//     place (original: temporary directory, removed recursively afterwards).
//  4. Both installed runtime copies are compared with the archive: the npm install and
//     the browser vendor projection (original: the npm install only).
//  5. The catalog is the prepared catalog passed as an argument, checked against an
//     expected SHA-256 (original: the installed self/config/chat-models.json).
// Added for the ordered three-stage route:
//  6. Plan admission: the application's own createWorkPartitionPlan is called with the
//     installed runtime, the signed manifest and the catalog row for every stage.
//  7. Machine names: every metadata file staging would copy is searched for this
//     machine's own names, tailnet domains and login-shaped strings. Values are never
//     written; only the first character and length are recorded.
//  8. Release history: the application's own prepareLocalPackRelease, given an in-memory
//     checkpoint store, feeds the installed runtime's verifyCapsuleMetadata. The chained
//     history must be accepted from no checkpoint, from the earlier release and from this
//     release, and every forked sequence-1 history or checkpoint must be rejected. No real
//     checkpoint store is opened.
// Changed from the first-pass copy one directory up: item 8 replaces a comparison with one
// previous Capsule (arguments now name the earlier digest and the fork sources); plan
// admission becomes a stop only if any stage fails, unchanged; the receipt schema is v2.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const [applicationRoot, capsuleRoot, catalogPath, catalogSha256, earlierDigest, forkList, extraction, output] = process.argv.slice(2);
assert(output, 'Provide application export, Capsule directory, catalog, expected catalog SHA-256, earlier sequence-1 digest, comma-separated fork Capsule directories, new extraction directory and receipt path');
const RUNTIME_ARCHIVE_SHA256 = '2df37d88f592b523bb90c4c79840354fd301af9803a7d9009e1c8939561c71f8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const load = relative => import(pathToFileURL(path.join(applicationRoot, relative)).href);
const stop = [];

// Runtime archive, pin, lock and both installed copies.
const pin = await read(path.join(applicationRoot, 'self/config/doppler-package.json'));
const archivePath = path.join(applicationRoot, `deploy/artifacts/doppler-gpu-${pin.version}.tgz`);
const runtimeArchive = await fs.readFile(archivePath);
assert.equal(hash(runtimeArchive), RUNTIME_ARCHIVE_SHA256, 'Application runtime archive differs from the qualified candidate');
assert.equal(pin.integrity, 'sha512-' + createHash('sha512').update(runtimeArchive).digest('base64'));
const lock = await read(path.join(applicationRoot, 'package-lock.json'));
assert.equal(lock.packages['node_modules/doppler-gpu'].integrity, pin.integrity);
await fs.mkdir(extraction);
await exec('tar', ['-xzf', archivePath, '-C', extraction]);
async function compare(source, installed) {
  let files = 0;
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    assert(!item.isSymbolicLink());
    if (item.isDirectory()) files += await compare(path.join(source, item.name), path.join(installed, item.name));
    else { assert((await fs.readFile(path.join(source, item.name))).equals(await fs.readFile(path.join(installed, item.name))), item.name); files++; }
  }
  return files;
}
const runtime = { archive: archivePath, archiveSha256: hash(runtimeArchive), version: pin.version, integrity: pin.integrity,
  npmInstalledFiles: await compare(path.join(extraction, 'package'), path.join(applicationRoot, 'node_modules/doppler-gpu')),
  browserVendorFiles: await compare(path.join(extraction, 'package'), path.join(applicationRoot, 'self/vendor/doppler', pin.version)) };

// Catalog bytes and shape.
const catalogBytes = await fs.readFile(catalogPath);
assert.equal(hash(catalogBytes), catalogSha256, 'Catalog differs from its preparation receipt');
const catalog = JSON.parse(catalogBytes);
assert(catalog.length === 1 && catalog.every(model => !model.canonicalGeneration && model.capsule && model.executablePack && model.packOpenOptions), 'Explicit signed legacy catalog required');
const model = catalog[0], plan = model.partitionPlan;
assert.equal(model.packOpenOptions.maxAcquisitionChunkBytes, 16777216);
assert.equal(Object.hasOwn(model, 'partitionSplitLayer'), false);
const { snapshotWorkPartitionSelection, createWorkPartitionPlan } = await load('self/host/work-partition-plan.js');
snapshotWorkPartitionSelection(model);

// Plan admission through the application's own host function and the installed runtime.
const partitions = await load('node_modules/doppler-gpu/src/partitions.js');
const { partitionActivationContract } = await load('self/vendor/reploid/mesh/partitions/partition-contract.js');
const manifestArtifact = model.capsule.artifacts.find(row => row.artifactId === model.capsule.program.manifestArtifactId);
const manifest = await read(path.join(capsuleRoot, manifestArtifact.path));
const frames = error => String(error.stack).split('\n').map(line => /([\w.-]+\/[\w.-]+\.js):(\d+):\d+\)?$/.exec(line))
  .filter(Boolean).map(match => `${match[1]}:${match[2]}`).slice(0, 3);
const admission = [];
for (let index = 0; index < plan.stageCount; index++) {
  try { admission.push({ index, ok: true, planId: partitions.hashLayerPartitionPlan(createWorkPartitionPlan(partitions, manifest, model, index)) }); }
  catch (error) { admission.push({ index, ok: false, message: error.message, frames: frames(error) }); }
}
// The same remaining statements with the validator called as the runtime declares it.
const declared = [];
for (let index = 0; index < plan.stageCount; index++) {
  partitions.validateOrderedLayerPartitionPlan(manifest, plan);
  const partition = partitions.resolveLayerPartition(manifest, { plan, index });
  partitionActivationContract(partitions, plan);
  declared.push({ index, layerRange: partition.layerRange });
}
const planSource = await fs.readFile(path.join(applicationRoot, 'self/host/work-partition-plan.js'), 'utf8');
const callLine = planSource.split('\n').findIndex(line => line.includes('runtime.validateOrderedLayerPartitionPlan(')) + 1;
const planAdmission = { planSchema: plan.schema, splitLayers: plan.splitLayers, planId: partitions.hashLayerPartitionPlan(plan),
  applicationFile: 'self/host/work-partition-plan.js', applicationFileSha256: hash(planSource), applicationCallLine: callLine,
  applicationCall: planSource.split('\n')[callLine - 1].trim(),
  runtimeValidatorParameters: partitions.validateOrderedLayerPartitionPlan.length,
  applicationResult: admission, withDeclaredTwoArgumentCall: declared };
if (admission.some(row => !row.ok)) stop.push('plan-admission');

// Machine names in the metadata staging would copy. Values are masked.
const names = new Set([os.hostname()]);
for (const key of ['LocalHostName', 'ComputerName', 'HostName']) {
  try { names.add((await exec('scutil', ['--get', key])).stdout.trim()); } catch { /* Not set or not macOS. */ }
}
const needles = [...names].filter(name => name.length >= 4).flatMap(name => [name, name + '.local']).map(name => name.toLowerCase());
const mask = value => value[0] + '*'.repeat(value.length - 1);
const patterns = { tailnet: /[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net/gi,
  login: /(?<![\w.@/-])[a-z_][a-z0-9_-]{1,31}@[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?![\w-])/gi };
const copied = model.source.files.map(file => model.capsule.artifacts.find(row => row.role !== 'weight-shard'
  && row.hash === 'sha256:' + file.hash && row.sizeBytes === file.sizeBytes));
assert(copied.every(Boolean) && copied.length === model.capsule.artifacts.filter(row => row.role !== 'weight-shard').length);
const findings = [];
const fields = (value, at, found) => {
  if (Array.isArray(value)) value.forEach((item, index) => fields(item, `${at}[${index}]`, found));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) fields(item, `${at}.${key}`, found);
  else if (typeof value === 'string' && needles.some(needle => value.toLowerCase().includes(needle))) found.push({ field: at, masked: mask(value), length: value.length });
  return found;
};
let tailnet = 0, login = 0;
for (const [label, file, role] of [['prepared catalog', catalogPath, 'catalog'],
  ...copied.map(row => [row.path, path.join(capsuleRoot, row.path), row.role])]) {
  const text = await fs.readFile(file, 'utf8'), lower = text.toLowerCase();
  tailnet += (text.match(patterns.tailnet) || []).length;
  if (role !== 'tokenizer') login += (text.match(patterns.login) || []).length;
  const occurrences = needles.reduce((count, needle) => count + lower.split(needle).length - 1, 0);
  if (occurrences) findings.push({ file: label, role, sha256: hash(text), occurrences,
    fields: file.endsWith('.json') ? fields(JSON.parse(text), '$', []) : [] });
}
const addresses = { filesSearched: copied.length + 1, tailnetDomains: tailnet, loginShaped: login,
  ownMachineNamesChecked: needles.length, ownMachineNameMatches: findings,
  scope: 'This machine only; names of other hosts cannot be derived locally and are covered only by the tailnet and login patterns' };
if (findings.length || tailnet || login) stop.push('machine-name-in-signed-metadata');

// Release history through the application's checkpoint policy and the installed runtime.
const { hashDopplerEvidence } = await load('self/pool/executable-pack.js');
const { prepareLocalPackRelease } = await load('self/pool/pack-release-policy.js');
const { verifyCapsuleMetadata } = await load('node_modules/doppler-gpu/src/config/capsule.js');
const history = model.packOpenOptions.releaseEvents, last = history.at(-1);
const forks = await Promise.all(forkList.split(',').map(async root => (await read(path.join(root, 'release-events.json'))).at(-1)));
const memoryStore = initial => ({ async read() { return structuredClone(initial); }, async advance() { throw new Error('Preflight never advances a checkpoint'); }, close() {} });
const open = async (label, checkpoint, releaseEvents, expected) => {
  const candidate = { ...model, packOpenOptions: { ...model.packOpenOptions, releaseEvents } };
  const release = await prepareLocalPackRelease({ model: candidate, openCheckpoints: async () => memoryStore(checkpoint) });
  let result;
  try {
    const { persistReleaseCheckpoint, ...options } = release.options;
    const verified = await verifyCapsuleMetadata(model.capsule, options);
    result = { label, checkpoint, presented: releaseEvents.map(event => event.sequence + ':' + event.digest.slice(7, 15)),
      minimumSequence: options.releasePolicy.minimumSequence, accepted: true, verifiedCheckpoint: verified.lifecycle.checkpoint };
  } catch (error) {
    result = { label, checkpoint, presented: releaseEvents.map(event => event.sequence + ':' + event.digest.slice(7, 15)), accepted: false, message: error.message };
  } finally { release.close(); }
  result.asExpected = result.accepted === expected.accepted && (expected.message === undefined || result.message === expected.message);
  return result;
};
const conflict = 'Release history conflicts with the persisted checkpoint.';
const cases = [
  await open('no checkpoint', { sequence: 0, digest: null }, history, { accepted: true }),
  await open('holds the earlier release', { sequence: 1, digest: earlierDigest }, history, { accepted: true }),
  await open('holds this release', { sequence: last.sequence, digest: last.digest }, history, { accepted: true }),
  ...await Promise.all(forks.map(fork => open('holds forked sequence 1 ' + fork.digest.slice(7, 15), { sequence: 1, digest: fork.digest }, history, { accepted: false, message: conflict }))),
  ...await Promise.all(forks.map(fork => open('forked history ' + fork.digest.slice(7, 15) + ' offered to a holder of the earlier release', { sequence: 1, digest: earlierDigest }, [fork], { accepted: false, message: conflict }))),
  await open('earlier release alone, below minimum sequence', { sequence: 0, digest: null }, [history[0]], { accepted: false, message: 'Release history rolled back below the required sequence.' }),
];
const eventsSource = (await fs.readFile(path.join(applicationRoot, 'node_modules/doppler-gpu/src/config/capsule-release-events.js'), 'utf8')).split('\n');
const releaseHistory = {
  events: history.map(event => ({ sequence: event.sequence, digest: event.digest, previousEventDigest: event.previousEventDigest,
    capsuleSemanticRoot: event.capsule.semanticRoot, authority: event.signature.authority,
    applicationId: event.release.application.applicationId, expiresAtUtc: event.expiresAtUtc })),
  earlierDigestMatches: history[0].sequence === 1 && history[0].digest === earlierDigest,
  minimumSequence: model.packOpenOptions.releasePolicy.minimumSequence,
  applicationNamespace: await hashDopplerEvidence({ authority: history[0].signature.authority, applicationId: model.application.applicationId }),
  earlierReleaseNamespace: await hashDopplerEvidence({ authority: history[0].signature.authority, applicationId: history[0].release.application.applicationId }),
  forks: forks.map(fork => ({ sequence: fork.sequence, digest: fork.digest, capsuleSemanticRoot: fork.capsule.semanticRoot })),
  cases, runtimeConflictLine: eventsSource.findIndex(line => line.includes(conflict)) + 1,
  realCheckpointStoresOpened: false };
if (!releaseHistory.earlierDigestMatches || releaseHistory.minimumSequence !== last.sequence
  || releaseHistory.applicationNamespace !== releaseHistory.earlierReleaseNamespace || cases.some(row => !row.asExpected)) stop.push('release-history');

await fs.writeFile(output, JSON.stringify({ schema: 'reploid.signed-catalog-staging-preflight/v2', applicationRoot, capsuleRoot,
  catalogSha256, runtime, planAdmission, addresses, releaseHistory, stop, staged: false, GPUOpened: false,
  node: process.version, platform: process.platform, architecture: process.arch }, null, 2) + '\n', { flag: 'wx' });
console.log(stop.length ? `Stop before staging: ${stop.join(', ')}` : 'No stop condition found');
process.exitCode = stop.length ? 1 : 0;
