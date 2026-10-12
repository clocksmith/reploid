/** Physical controller preflight only. Runtime signature/admission remains authoritative. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { verifyHostingSource } from '../../scripts/package-hosting.js';
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
async function retained(binding) {
  assert(binding?.path && /^sha256:[a-f0-9]{64}$/.test(binding.sha256), 'Exact retained path and SHA256 required');
  const bytes = await readFile(binding.path);
  assert.equal(hash(bytes), binding.sha256, `Retained bytes differ: ${binding.path}`);
  return bytes;
}
export async function prepareSignedControl(config) {
  assert.equal(config.mode, 'signed-capsule');
  for (const key of ['selfRoot', 'url', 'requesterCdp', 'inputPeer', 'profile', 'output', 'modelId', 'sourceCommit']) {
    assert.equal(typeof config[key], 'string', `Explicit ${key} required`);
    assert(config[key].length, `Explicit ${key} required`);
  }
  assert(!config.output.endsWith('/active-result.json'), 'Use a new result path; preserve historical receipt');
  assert.equal(config.surface, 'browser-webgpu');
  assert.equal(config.partitionIndex, 1, 'This existing controller exercises output contributor replacement');
  const archive = await retained(config.archive);
  await retained(config.application);
  const verified = await verifyHostingSource(config.selfRoot);
  assert.equal(hash(verified.descriptor), config.application.sha256, 'Complete verified delivery differs');
  const archiveBinding = JSON.parse(await retained(config.archiveBinding));
  assert.equal(archiveBinding.archiveSha256, config.archive.sha256.slice(7));
  assert.equal(archiveBinding.manifestSha256, config.manifest.sha256.slice(7));
  const catalog = JSON.parse(await retained(config.catalog));
  assert.deepEqual(JSON.parse(await readFile(path.join(config.selfRoot, 'config/chat-models.json'))), catalog);
  const model = catalog.find(row => row.id === config.modelId);
  assert(model?.capsule && model.executablePack && model.packOpenOptions && model.partitionPlan, 'Explicit signed catalog entry required');
  const capsule = JSON.parse(await retained(config.capsule));
  assert.deepEqual(model.capsule, capsule, 'Controller requires the exact embedded signed Capsule');
  assert.equal(capsule.modelId, model.id);
  assert.equal(model.executablePack.requiredOperation, 'residentPartition');
  assert.equal(model.identity, config.manifest.sha256);
  await retained(config.manifest);
  const pin = JSON.parse(await readFile(path.join(config.selfRoot, 'config/doppler-package.json')));
  assert.equal(pin.integrity, 'sha512-' + createHash('sha512').update(archive).digest('base64'), 'Candidate delivery pin differs from candidate archive');
  const contract = JSON.parse(await retained(config.contract));
  assert.equal(contract.schema, 'doppler.resident-qualification-contract/v1');
  assert.equal(contract.tolerance, 0.001);
  assert.equal(contract.comparedSteps, 55);
  assert.equal(contract.referenceHash, config.reference.sha256);
  assert.equal(contract.evaluatorHash, config.evaluator.sha256);
  await retained(config.reference); await retained(config.evaluator);
  assert(Array.isArray(config.qualifications) && config.qualifications.length >= 2, 'Both actual placements required');
  const placements = new Set();
  for (const item of config.qualifications) {
    const report = JSON.parse(await retained(item.report));
    await retained(item.capture); await retained(item.provider);
    assert.equal(report.schema, 'doppler.resident-partition-qualification/v1');
    assert.equal(report.partitionIndex, item.partitionIndex);
    assert.equal(report.operation, 'residentPartition'); assert.equal(report.status, 'passed');
    assert.equal(report.modelId, model.id); assert.equal(report.manifestIdentity, model.identity);
    assert.deepEqual(report.partitionPlan, model.partitionPlan);
    assert.equal(report.partitionPlanHash, digest(model.partitionPlan));
    assert.deepEqual(report.initialExecutionIdentity, item.initialExecutionIdentity);
    assert(capsule.targetPlans?.some(target => digest(target.initialExecutionIdentity) === digest(report.initialExecutionIdentity)
      && target.qualification?.some(row => row.operation === 'residentPartition' && row.status === 'passed'
        && row.evidenceHash === item.report.sha256 && row.partitionIndex === report.partitionIndex
        && row.partitionPlanHash === report.partitionPlanHash && row.surface === report.surface)),
    'Signed target does not bind this exact resident report and initial execution identity');
    assert.equal(report.executionGraphHash, item.initialExecutionIdentity.executionGraphHash);
    assert.equal(report.comparison.captureHash, item.capture.sha256);
    assert.equal(report.comparison.referenceHash, config.reference.sha256);
    assert.equal(report.comparison.evaluatorHash, config.evaluator.sha256);
    assert.equal(report.comparison.contractHash, digest(contract));
    assert.equal(report.comparison.tolerance, 0.001); assert.equal(report.comparison.complete, true);
    assert.equal(report.comparison.steps.length, 55);
    report.comparison.steps.forEach((step, index) => {
      assert.equal(step.index, index); assert(Number.isFinite(step.maxAbsoluteError) && step.maxAbsoluteError >= 0 && step.maxAbsoluteError <= 0.001);
    });
    assert(['browser-webgpu', 'node-webgpu'].includes(report.surface));
    assert([0, 1].includes(report.partitionIndex));
    const provider = JSON.parse(await readFile(item.provider.path));
    for (const key of ['adapter', 'libraryIdentity']) {
      const field = item.providerFields?.[key];
      assert(Array.isArray(field?.path) && field.path.length && field.expected !== undefined, 'Frozen provider field binding required');
      const observed = field.path.reduce((value, key) => value?.[key], provider);
      assert(observed !== undefined && observed !== null, 'Observed provider field absent');
      assert.deepEqual(observed, field.expected, 'Observed provider identity differs');
    }
    assert(capsule.artifacts.some(artifact => artifact.role === 'qualification-evidence' && artifact.hash === item.report.sha256), 'Report absent from signed artifact closure');
    placements.add(report.surface + ':' + report.partitionIndex);
  }
  assert(placements.has(config.surface + ':' + config.partitionIndex), 'Selected physical placement lacks retained qualification');
  assert(config.qualifications.some(item => item.partitionIndex === 0), 'Explicit input placement binding required');
  return { model, binding: { archive: config.archive, archiveBinding: config.archiveBinding, application: config.application, catalog: config.catalog,
    reference: config.reference, evaluator: config.evaluator, qualifications: config.qualifications,
    scope: 'Retained byte/claim consistency only; runtime must verify signatures and admission. No independent numerical recomputation.' } };
}
export function assertSignedPreparation(observed, model) {
  assert.equal(observed.openingMode, 'signed-capsule');
  assert.deepEqual(observed.plan, model.partitionPlan);
  const verification = observed.capsuleVerification;
  assert.equal(verification?.artifactVerificationScope, 'resident-pieces');
  assert.equal(verification.pieceVerification?.mode, 'signed-piece-index');
  assert.equal(verification.pieceVerification.manifestIdentity, model.identity);
  assert.deepEqual(verification.capsule, model.capsule);
  assert.equal(verification.pieceVerification.indexArtifactId, model.capsule.program.pieceIndexArtifactId);
  assert(Array.isArray(verification.pieceVerification.ranges) && verification.pieceVerification.ranges.length > 0, 'Actual assigned ranges required');
  assert(observed.acquisition?.verifiedBytes > 0, 'Fresh verified selective acquisition required');
  assert.equal(observed.descriptor.modelIdentity, model.identity);
}
