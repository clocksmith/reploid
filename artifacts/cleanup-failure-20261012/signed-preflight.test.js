import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildHostingFileSet } from '../../scripts/hosting-file-set.js';
import { buildBrowserBundleManifest } from '../../self/pool/browser-release-identity.js';
import { prepareSignedControl, assertSignedPreparation } from './signed-preflight.js';
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'signed-runner-synthetic-'));
  const selfRoot = path.join(root, 'self'); await mkdir(path.join(selfRoot, 'config'), { recursive: true });
  const save = async (name, value) => {
    const bytes = typeof value === 'string' ? value : JSON.stringify(value);
    const target = path.join(root, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    return { path: target, sha256: hash(bytes) };
  };
  const config = { mode: 'signed-capsule', selfRoot, url: 'http://localhost:8000/', requesterCdp: 'http://localhost:54307',
    inputPeer: 'synthetic-input', profile: path.join(root, 'profile'), output: path.join(root, 'new-result.json'),
    modelId: 'synthetic-only', sourceCommit: 'synthetic', surface: 'browser-webgpu', partitionIndex: 1 };
  const prefix = 'vendor/doppler/0.0.1/';
  for (const entry of ['src/index.js', 'src/partitions.js', 'src/tooling-exports.browser.js', 'src/tooling-exports/storage.js', 'LICENSE']) {
    await save('self/' + prefix + entry, '// Synthetic: never execute');
    await save('archive/package/' + entry, '// Synthetic: never execute');
  }
  const archivePath = path.join(root, 'deploy/artifacts/doppler-gpu-0.0.1.tgz');
  await mkdir(path.dirname(archivePath), { recursive: true });
  await promisify(execFile)('tar', ['-czf', archivePath, '-C', path.join(root, 'archive'), 'package']);
  config.archive = { path: archivePath, sha256: hash(await readFile(archivePath)) };
  await save('self/pool/pool-config.json', { browserRuntime: { dopplerModuleUrl: '/vendor/doppler/0.0.1/src/index.js',
    dopplerStorageModuleUrl: '/vendor/doppler/0.0.1/src/tooling-exports/storage.js' } });
  config.reference = await save('reference.json', { synthetic: true });
  config.evaluator = await save('evaluator.js', 'synthetic evaluator; never execute');
  config.manifest = await save('manifest.json', { modelId: config.modelId });
  config.archiveBinding = await save('archive-binding.json', { archiveSha256: config.archive.sha256.slice(7), manifestSha256: config.manifest.sha256.slice(7) });
  const plan = { schema: 'synthetic-plan', modelId: config.modelId };
  const identity = { executionGraphHash: hash('graph'), programLoadPolicy: { intermediatePrecision: 'two-f32' } };
  const contract = { schema: 'doppler.resident-qualification-contract/v1', tolerance: 0.001, comparedSteps: 55,
    referenceHash: config.reference.sha256, evaluatorHash: config.evaluator.sha256 };
  config.contract = await save('contract.json', contract);
  config.qualifications = [];
  const artifacts = [];
  for (const partitionIndex of [0, 1]) {
    const capture = await save(`capture${partitionIndex}.json`, { synthetic: true, partitionIndex });
    const provider = await save(`provider${partitionIndex}.json`, { archiveSha256: config.archive.sha256,
      captureSha256: capture.sha256, surface: 'browser-webgpu', adapter: 'synthetic', libraryIdentity: 'synthetic' });
    const report = await save(`report${partitionIndex}.json`, { schema: 'doppler.resident-partition-qualification/v1',
      operation: 'residentPartition', status: 'passed', modelId: config.modelId, manifestIdentity: config.manifest.sha256,
      partitionPlan: plan, partitionPlanHash: digest(plan), initialExecutionIdentity: identity,
      executionGraphHash: identity.executionGraphHash, surface: 'browser-webgpu', partitionIndex,
      comparison: { captureHash: capture.sha256, referenceHash: config.reference.sha256,
        evaluatorHash: config.evaluator.sha256, contractHash: digest(contract), tolerance: 0.001, complete: true,
        steps: Array.from({ length: 55 }, (_, index) => ({ index, maxAbsoluteError: 0 })) } });
    config.qualifications.push({ report, capture, provider, partitionIndex, initialExecutionIdentity: identity,
      providerFields: { adapter: { path: ['adapter'], expected: 'synthetic' }, libraryIdentity: { path: ['libraryIdentity'], expected: 'synthetic' } } });
    artifacts.push({ role: 'qualification-evidence', hash: report.sha256 });
  }
  const capsule = { modelId: config.modelId, artifacts, targetPlans: [{ initialExecutionIdentity: identity,
    qualification: config.qualifications.map(item => ({ operation: 'residentPartition', status: 'passed',
      evidenceHash: item.report.sha256, partitionIndex: item.partitionIndex, partitionPlanHash: digest(plan), surface: 'browser-webgpu' })) }], program: { pieceIndexArtifactId: 'pieces' } };
  config.capsule = await save('capsule.json', capsule);
  const model = { id: config.modelId, identity: config.manifest.sha256, partitionPlan: plan, capsule,
    executablePack: { requiredOperation: 'residentPartition' }, packOpenOptions: {} };
  config.catalog = await save('self/config/chat-models.json', [model]);
  await save('self/config/doppler-package.json', { version: '0.0.1', integrity: 'sha512-' + createHash('sha512').update(await readFile(archivePath)).digest('base64') });
  await save('self/config/browser-bundle-manifest.json', {});
  const files = await buildHostingFileSet({ selfDir: selfRoot });
  const entries = await Promise.all(files.filter(name => name !== 'config/browser-bundle-manifest.json')
    .map(async name => ({ path: name, bytes: new Uint8Array(await readFile(path.join(selfRoot, name))) })));
  config.application = await save('self/config/browser-bundle-manifest.json', await buildBrowserBundleManifest(entries));
  return { config, model, save, close: () => rm(root, { recursive: true, force: true }) };
}
test('synthetic bindings prove preflight mechanics only; no browser or qualification creation', async () => {
  const f = await fixture();
  try { assert.deepEqual((await prepareSignedControl(f.config)).model, f.model); } finally { await f.close(); }
});
for (const [name, corrupt] of [
  ['missing report', f => { f.config.qualifications = []; }],
  ['wrong archive bytes', f => writeFile(f.config.archive.path, 'changed')],
  ['wrong vendor despite intact pin', f => writeFile(path.join(f.config.selfRoot, 'vendor/doppler/0.0.1/src/index.js'), '// changed')],
  ['wrong app bytes', f => writeFile(path.join(f.config.selfRoot, 'config/chat-models.json'), '[]')],
  ['changed capture', f => writeFile(f.config.qualifications[0].capture.path, '{}')],
  ['changed independent reference', f => writeFile(f.config.reference.path, '{}')],
  ['changed provider', f => writeFile(f.config.qualifications[1].provider.path, '{}')],
  ['wrong partition binding', f => { f.config.qualifications[1].partitionIndex = 0; }],
  ['historical output overwrite', f => { f.config.output = '/tmp/active-result.json'; }],
  ['weakened tolerance', async f => { f.config.contract = await f.save('contract.json', { schema: 'doppler.resident-qualification-contract/v1', tolerance: 0.01 }); }],
]) test(`rejects ${name} before physical launch`, async () => {
  const f = await fixture();
  try { await corrupt(f); await assert.rejects(prepareSignedControl(f.config)); } finally { await f.close(); }
});
test('actual preparation must show signed selective acquisition, not merely Ready', async () => {
  const f = await fixture();
  try {
    const observed = { openingMode: 'signed-capsule', plan: f.model.partitionPlan,
      descriptor: { modelIdentity: f.model.identity }, acquisition: { verifiedBytes: 0, custody: { peerBytes: 16, transfers: 1 } },
      capsuleVerification: { artifactVerificationScope: 'resident-pieces', capsule: f.model.capsule,
        pieceVerification: { mode: 'signed-piece-index', observation: 'resident-opening', pieces: ['synthetic'], verifiedBytes: 16, manifestIdentity: f.model.identity, indexArtifactId: 'pieces', ranges: [{}] } } };
    assertSignedPreparation(observed, f.model);
    for (const patch of [{ openingMode: 'pinned-manifest' }, { acquisition: { verifiedBytes: 0 } }, { capsuleVerification: null }]) {
      assert.throws(() => assertSignedPreparation({ ...observed, ...patch }, f.model));
    }
  } finally { await f.close(); }
});

test('retained archive8 uses unmodified raw-hex producer binding', async () => {
  const binding = JSON.parse(await readFile(new URL('../../../doppler/artifacts/paired-intermediates-20261012/first-prefill-norm-boundary/archive-8-binding.json', import.meta.url)));
  assert.match(binding.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(binding.archiveSha256, '8ea1767fb61d9009dd257c4065a6acfdbaaf80fa733145898307ed35da0e7f20');
  assert.match(binding.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(binding.qualified, false); // Shape control never promotes this current candidate.
});
