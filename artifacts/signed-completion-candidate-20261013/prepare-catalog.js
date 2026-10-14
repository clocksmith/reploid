// Isolated catalog preparation only; does not alter the public catalog or pin.
//
// Adapted copy of artifacts/signed-blake3-source-20261012/prepare-catalog.js for an
// ordered three-stage route. Every difference from the original:
//  1. Argument 3 is a comma-separated list of resident reports, one per stage
//     (original: one report). Each report gets the original checks: passed,
//     residentPartition, manifest identity, runtime-recomputed plan hash, and a
//     signed qualification row matching evidence hash, plan hash, index and surface
//     (exactly one such row is required; the original accepted at least one).
//  2. All reports must share one initial execution identity and one plan, and their
//     partition indexes must be exactly 0..stageCount-1 (original: one index).
//  3. The plan must be doppler.layer-partition-contract/v3 and its splitLayers must
//     equal the new argument 7 (original: implicit two-stage plan with splitLayer).
//  4. `partitionSplitLayer` is omitted (original: report.partitionPlan.splitLayer).
//     A v3 plan has no scalar split and the application rejects a catalog row whose
//     partitionSplitLayer differs from plan.splitLayer (self/host/work-partition-plan.js:8).
//  5. The reference file hash must equal the signed ordered contract's referenceHash
//     and the signed release oracle digest (original: reference file was not bound).
//  6. The output is created exclusively and never overwritten (original: overwrote).
//  7. The printed receipt adds plan hash, split layers, per-stage evidence, metadata
//     file count and the catalog SHA-256.
// Unchanged: imports, target-plan selection, executable pack, pack open options
// (minimumSequence 1, maxAcquisitionChunkBytes 16777216), metadata verification with a
// local null checkpoint (no stored checkpoint is read or advanced), model row fields.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { resolvePartitionArtifactSource } from '../../self/host/work-partition-artifact-source.js';

const [capsuleRoot, runtimeRoot, reportList, referencePath, baseUrl, outputPath, splitList] = process.argv.slice(2);
assert([capsuleRoot, runtimeRoot, reportList, referencePath, baseUrl, outputPath, splitList].every(Boolean),
  'Provide Capsule directory, runtime directory, comma-separated resident reports, reference, HTTP closure URL, output path and split layers');
assert(['http:', 'https:'].includes(new URL(baseUrl).protocol));
const reportPaths = reportList.split(','), splitLayers = splitList.split(',').map(Number);
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const fileHash = async file => 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
const load = name => import(pathToFileURL(resolve(runtimeRoot, 'src/config', name)).href);
const { getCapsuleIdentity, verifyCapsuleMetadata } = await load('capsule.js');
const { hashTargetPlan } = await load('target-plan.js');
const { resolveGenerationOptions } = await load('generation-contract.js');
const capsule = await read(resolve(capsuleRoot, 'capsule-v3.json'));
const releaseEvents = await read(resolve(capsuleRoot, 'release-events.json'));
const trustedSigners = await read(resolve(capsuleRoot, 'trusted-signers.json'));
const reports = await Promise.all(reportPaths.map(read)), reference = await read(referencePath);
const referenceHash = await fileHash(referencePath);
const report = reports[0], plan = report.partitionPlan;
assert.equal(plan.schema, 'doppler.layer-partition-contract/v3');
assert.deepEqual(plan.splitLayers, splitLayers);
assert.equal(plan.stageCount, reports.length);
assert.equal(plan.splitLayer, undefined);
assert.deepEqual(reports.map(row => row.partitionIndex).sort((a, b) => a - b), reports.map((_, index) => index));
const reportIdentity = await hashDopplerEvidence(report.initialExecutionIdentity);
const matching = [];
for (const target of capsule.targetPlans) {
  if (await hashDopplerEvidence(target.initialExecutionIdentity) === reportIdentity) matching.push(target);
}
assert.equal(matching.length, 1);
const { hashLayerPartitionPlan } = await import(pathToFileURL(resolve(runtimeRoot, 'src/partitions.js')).href);
const stages = [];
for (const [position, row] of reports.entries()) {
  assert.equal(row.status, 'passed');
  assert.equal(row.operation, 'residentPartition');
  assert.equal(row.manifestIdentity, capsule.artifacts.find(artifact => artifact.artifactId === capsule.program.manifestArtifactId).hash);
  assert.equal(await hashDopplerEvidence(row.initialExecutionIdentity), reportIdentity);
  assert.deepEqual(row.partitionPlan, plan);
  assert.equal(hashLayerPartitionPlan(row.partitionPlan), row.partitionPlanHash);
  const reportHash = await fileHash(reportPaths[position]);
  const signed = matching[0].qualification.filter(entry => entry.status === 'passed' && entry.operation === 'residentPartition'
    && entry.evidenceHash === reportHash && entry.partitionPlanHash === row.partitionPlanHash
    && entry.partitionIndex === row.partitionIndex && entry.surface === row.surface);
  assert.equal(signed.length, 1, 'Report is outside signed qualification');
  assert.equal(signed[0].orderedContract.referenceHash, referenceHash, 'Reference differs from the signed ordered contract');
  stages.push({ index: row.partitionIndex, surface: row.surface, layerRange: plan.partitions[row.partitionIndex].layerRange, evidenceHash: reportHash });
}
assert.equal(releaseEvents.at(-1).release.application.oracle.digest, referenceHash, 'Reference differs from the signed release oracle');
const targetDigest = hashTargetPlan(matching[0]);
const manifestArtifact = capsule.artifacts.find(row => row.artifactId === capsule.program.manifestArtifactId);
assert.equal(await fileHash(resolve(capsuleRoot, manifestArtifact.path)), manifestArtifact.hash);
const manifest = await read(resolve(capsuleRoot, manifestArtifact.path));
const directory = manifestArtifact.path.slice(0, manifestArtifact.path.lastIndexOf('/') + 1);
const files = capsule.artifacts.filter(row => row.role !== 'weight-shard').map(row => ({
  path: row.path.startsWith(directory) ? row.path.slice(directory.length) : row.path,
  role: row.role === 'manifest' ? 'model-manifest' : row.role === 'piece-index' ? 'model-piece-index' : row.role,
  hashAlgorithm: 'sha256', hash: row.hash.slice(7), sizeBytes: row.sizeBytes,
  url: new URL(row.path, baseUrl).href,
}));
const executablePack = { ...getCapsuleIdentity(capsule), requiredOperation: 'residentPartition',
  acceptedTargetPlanDigests: [targetDigest], artifacts: capsule.artifacts };
assert.deepEqual(validateExecutablePack(executablePack), { ok: true, reasons: [] });
const packOpenOptions = { trustedSigners, releaseTrustedSigners: trustedSigners, releaseEvents,
  releasePolicy: { minimumSequence: 1 }, acceptedTargetPlanDigests: [targetDigest],
  requiredOperations: ['residentPartition'], maxAcquisitionChunkBytes: 16777216 };
const now = new Date().toISOString();
await verifyCapsuleMetadata(capsule, { ...packOpenOptions,
  releasePolicy: { ...packOpenOptions.releasePolicy, now, checkpoint: { sequence: 0, digest: null } } });
const model = { id: capsule.modelId, name: 'Qwen 3.5 0.8B', identity: manifestArtifact.hash,
  provider: 'doppler', contextLength: reference.generation.maxSeqLen, quantization: 'q4k', size: 'Q4K',
  recommended: true, adapters: [], generation: resolveGenerationOptions(reference.generation),
  partitionPlan: plan,
  application: releaseEvents.at(-1).release.application, capsule, executablePack, packOpenOptions,
  source: { baseUrl: new URL(directory, baseUrl).href, files } };
for (const artifact of capsule.artifacts) resolvePartitionArtifactSource(model, manifest, files, artifact);
const output = JSON.stringify([model], null, 2) + '\n';
await writeFile(outputPath, output, { flag: 'wx' });
console.log(JSON.stringify({ modelIdentity: model.identity, capsule: executablePack.capsuleId,
  targetDigest, generationDigest: await hashDopplerEvidence(model.generation), artifacts: capsule.artifacts.length,
  partitionPlanHash: report.partitionPlanHash, splitLayers: plan.splitLayers,
  stages: stages.sort((a, b) => a.index - b.index), metadataFiles: files.length,
  releaseSequence: releaseEvents.at(-1).sequence, releaseExpiresAtUtc: releaseEvents.at(-1).expiresAtUtc,
  maxAcquisitionChunkBytes: packOpenOptions.maxAcquisitionChunkBytes, verifiedAtUtc: now,
  catalogSha256: createHash('sha256').update(output).digest('hex'), catalogBytes: Buffer.byteLength(output),
  outputPath: resolve(outputPath), publicCatalogChanged: false, physicalOpening: false }));
