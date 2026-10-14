// CPU-only verification of the produced browser payload and native package. Opens no GPU,
// browser, server, peer, provider, checkpoint store or ledger, and never starts the application.
//
// Adapted from artifacts/basic-signed-candidate-20261013/final/verify-native.js. Every
// difference from that original:
//  1. Runtime archive is 2df37d88... (original: 0fadac51...).
//  2. The native tarball is extracted into a new local directory and installed there with
//     `npm ci --ignore-scripts --no-audit --no-fund` (original: verified a directory installed
//     on a remote host with install scripts). No installed program is run.
//  3. The extracted runtime archive is kept in that directory instead of a removed temporary.
//  4. Added: the browser hosting payload is compared file by file with the export's served
//     files, its descriptor and bundle hash are read, and every vendored runtime file it serves
//     is compared with the archive.
//  5. Added: the staged catalog must differ from the prepared catalog only in metadata URLs,
//     each staged metadata file must match its pinned hash in the export, the payload and the
//     package, and every signed artifact must resolve through the installed application.
//  6. Added: ordered plan admission for every stage through the installed package's own
//     application code and runtime.
//  7. Added: tailnet, login-shaped and this machine's own names are counted in the staged
//     catalog and metadata of the export, payload and package (values never written).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const [applicationRoot, preparedPath, preparedSha256, archive, installRoot, output] = process.argv.slice(2);
assert(output, 'Provide application export, prepared catalog, its SHA-256, native tarball, new install directory and receipt path');
const RUNTIME = '2df37d88f592b523bb90c4c79840354fd301af9803a7d9009e1c8939561c71f8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const self = path.join(applicationRoot, 'self'), payload = path.join(applicationRoot, '.firebase-hosting/reploid');
async function walk(root, prefix = '') {
  const files = [];
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), 'Unexpected link ' + item.name);
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) files.push(...await walk(root, name)); else files.push(name);
  }
  return files.sort();
}
async function compare(source, other) {
  const files = await walk(source);
  for (const name of files) assert((await fs.readFile(path.join(source, name))).equals(await fs.readFile(path.join(other, name))), name);
  return files.length;
}

// Native tarball: extract, check every descriptor member, install, compare runtime.
const nativeArchiveSha256 = hash(await fs.readFile(archive));
await fs.mkdir(installRoot);
await exec('tar', ['-xzf', archive, '-C', installRoot]);
const directory = path.join(installRoot, 'reploid');
const descriptorBytes = await fs.readFile(path.join(directory, 'native-delivery.json'));
const descriptor = JSON.parse(descriptorBytes);
for (const entry of descriptor.entries) {
  assert(!entry.path.split('/').includes('..') && !path.isAbsolute(entry.path));
  const bytes = await fs.readFile(path.join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path); assert.equal(hash(bytes), entry.sha256, entry.path);
}
const packaged = (await walk(directory)).filter(name => name !== 'native-delivery.json');
assert.deepEqual(packaged, descriptor.entries.map(entry => entry.path).sort(), 'Native package members differ from its descriptor');
const runtimeArchive = await fs.readFile(path.join(directory, 'deploy/artifacts/doppler-gpu-0.6.28.tgz'));
assert.equal(hash(runtimeArchive), RUNTIME);
const pin = JSON.parse(await fs.readFile(path.join(directory, 'self/config/doppler-package.json')));
assert.equal(pin.integrity, 'sha512-' + createHash('sha512').update(runtimeArchive).digest('base64'));
const install = await exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory });
const extracted = path.join(installRoot, 'runtime-archive');
await fs.mkdir(extracted);
await exec('tar', ['-xzf', path.join(directory, 'deploy/artifacts/doppler-gpu-0.6.28.tgz'), '-C', extracted]);
const runtimeFiles = await compare(path.join(extracted, 'package'), path.join(directory, 'node_modules/doppler-gpu'));
const dependencyVersions = {};
for (const name of ['doppler-gpu', '@roamhq/wrtc', 'ws', 'webgpu']) {
  dependencyVersions[name] = JSON.parse(await fs.readFile(path.join(directory, 'node_modules', name, 'package.json'))).version;
}

// Browser payload: same files and bytes as the export's served set, runtime equal to the archive.
const served = (await walk(payload));
const browserDescriptor = JSON.parse(await fs.readFile(path.join(payload, 'config/browser-bundle-manifest.json')));
assert.equal(served.length, browserDescriptor.files.length + 1, 'Payload differs from its descriptor file list');
for (const name of served) assert((await fs.readFile(path.join(payload, name))).equals(await fs.readFile(path.join(self, name))), name);
// The payload serves a subset of the vendored runtime; every served runtime file must equal the archive.
const payloadRuntimeFiles = await compare(path.join(payload, 'vendor/doppler/0.6.28'), path.join(extracted, 'package'));

// Catalog: staged versus prepared, metadata in all three places, signed artifact mapping.
const preparedBytes = await fs.readFile(preparedPath);
assert.equal(hash(preparedBytes), preparedSha256);
const stagedBytes = await fs.readFile(path.join(self, 'config/chat-models.json'));
for (const root of [payload, path.join(directory, 'self')]) assert((await fs.readFile(path.join(root, 'config/chat-models.json'))).equals(stagedBytes));
const prepared = JSON.parse(preparedBytes), staged = JSON.parse(stagedBytes);
const withoutUrls = catalog => catalog.map(model => ({ ...model, source: { ...model.source, files: model.source.files.map(({ url, ...file }) => file) } }));
assert.deepEqual(withoutUrls(staged), withoutUrls(prepared), 'Staging changed more than metadata URLs');
const model = staged[0], metadata = new Map();
assert(staged.length === 1 && !model.canonicalGeneration && model.capsule && model.executablePack && model.packOpenOptions);
for (const file of model.source.files) {
  assert.match(file.url, /^\/config\/model-(artifacts|manifests|pieces)\/[a-f0-9]{64}\.[a-zA-Z0-9]+$/);
  for (const root of [self, payload, path.join(directory, 'self')]) {
    const bytes = await fs.readFile(path.join(root, file.url));
    assert(bytes.length === file.sizeBytes && hash(bytes) === file.hash, `${root}${file.url}`);
  }
  metadata.set(file.url, file.hash);
}
const manifestFile = model.source.files.find(file => file.role === 'model-manifest');
const manifest = JSON.parse(await fs.readFile(path.join(self, manifestFile.url)));
const installed = relative => import(pathToFileURL(path.join(directory, relative)).href);
const { resolvePartitionArtifactSource } = await installed('self/host/work-partition-artifact-source.js');
for (const artifact of model.capsule.artifacts) resolvePartitionArtifactSource(model, manifest, model.source.files, artifact);

// Ordered plan admission through the installed package's application code and runtime.
const runtime = await installed('node_modules/doppler-gpu/src/partitions.js');
const { createWorkPartitionPlan } = await installed('self/host/work-partition-plan.js');
const admission = [];
for (let index = 0; index < model.partitionPlan.stageCount; index++) {
  const plan = createWorkPartitionPlan(runtime, manifest, model, index);
  admission.push({ index, layerRange: plan.partitions[index].layerRange, planId: runtime.hashLayerPartitionPlan(plan) });
}

// Address search over staged catalog and metadata in all three places.
const names = new Set([os.hostname()]);
for (const key of ['LocalHostName', 'ComputerName', 'HostName']) {
  try { names.add((await exec('scutil', ['--get', key])).stdout.trim()); } catch { /* Not set or not macOS. */ }
}
const needles = [...names].filter(name => name.length >= 4).map(name => name.toLowerCase());
const searched = [];
for (const root of [self, payload, path.join(directory, 'self')]) {
  searched.push(path.join(root, 'config/chat-models.json'), ...[...metadata.keys()].map(url => path.join(root, url)));
}
let tailnet = 0, login = 0, ownNames = 0;
for (const file of searched) {
  const text = await fs.readFile(file, 'utf8'), lower = text.toLowerCase();
  tailnet += (text.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net/gi) || []).length;
  if (!file.includes('/model-artifacts/' + model.source.files.find(row => row.role === 'tokenizer').hash)) {
    login += (text.match(/(?<![\w.@/-])[a-z_][a-z0-9_-]{1,31}@[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?![\w-])/gi) || []).length;
  }
  ownNames += needles.reduce((count, needle) => count + lower.split(needle).length - 1, 0);
}

await fs.writeFile(output, JSON.stringify({ schema: 'reploid.signed-completion-delivery-verification/v1', applicationRoot,
  native: { archive, nativeArchiveSha256, descriptorSha256: hash(descriptorBytes), nativeFiles: descriptor.entries.length,
    installDirectory: directory, install: 'npm ci --ignore-scripts --no-audit --no-fund', installLog: (install.stdout + install.stderr).trim(),
    runtimeFiles, runtimeArchiveSha256: hash(runtimeArchive), dependencyVersions },
  browser: { payload, browserFiles: served.length, bundleHash: browserDescriptor.bundleHash,
    browserManifestSha256: hash(await fs.readFile(path.join(self, 'config/browser-bundle-manifest.json'))), vendoredRuntimeFiles: payloadRuntimeFiles },
  catalog: { preparedSha256, stagedSha256: hash(stagedBytes), onlyMetadataUrlsChanged: true, sourceFiles: model.source.files.length,
    distinctMetadataFiles: metadata.size, artifactMappings: model.capsule.artifacts.length,
    releaseHistory: model.packOpenOptions.releaseEvents.map(event => ({ sequence: event.sequence, digest: event.digest })),
    minimumSequence: model.packOpenOptions.releasePolicy.minimumSequence, maxAcquisitionChunkBytes: model.packOpenOptions.maxAcquisitionChunkBytes },
  orderedPlanAdmission: admission,
  addresses: { filesSearched: searched.length, tailnetDomains: tailnet, loginShaped: login, ownMachineNames: ownNames },
  node: process.version, platform: process.platform, architecture: process.arch,
  GPUOpened: false, applicationStarted: false, publicContributorChanged: false, ledgerOpened: false, physicalQualified: false }, null, 2) + '\n', { flag: 'wx' });
assert(tailnet === 0 && login === 0 && ownNames === 0, 'Address found in staged metadata');
console.log(`Verified ${descriptor.entries.length} native files, ${runtimeFiles} installed runtime files, ${served.length} browser files and ${metadata.size} metadata files; no GPU opened`);
