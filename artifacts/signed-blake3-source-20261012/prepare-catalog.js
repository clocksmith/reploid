// Isolated catalog preparation only; does not alter the public catalog or pin.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { resolvePartitionArtifactSource } from '../../self/host/work-partition-artifact-source.js';

const [capsuleRoot, runtimeRoot, reportPath, referencePath, baseUrl, outputPath] = process.argv.slice(2);
assert([capsuleRoot, runtimeRoot, reportPath, referencePath, baseUrl, outputPath].every(Boolean),
  'Provide Capsule directory, runtime directory, resident report, reference, HTTP closure URL and output path');
assert(['http:', 'https:'].includes(new URL(baseUrl).protocol));
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const load = name => import(pathToFileURL(resolve(runtimeRoot, 'src/config', name)).href);
const { getCapsuleIdentity, verifyCapsuleMetadata } = await load('capsule.js');
const { hashTargetPlan } = await load('target-plan.js');
const { resolveGenerationOptions } = await load('generation-contract.js');
const capsule = await read(resolve(capsuleRoot, 'capsule-v3.json'));
const releaseEvents = await read(resolve(capsuleRoot, 'release-events.json'));
const trustedSigners = await read(resolve(capsuleRoot, 'trusted-signers.json'));
const report = await read(reportPath), reference = await read(referencePath);
assert.equal(report.status, 'passed');
assert.equal(report.operation, 'residentPartition');
assert.equal(report.manifestIdentity, capsule.artifacts.find(row => row.artifactId === capsule.program.manifestArtifactId).hash);
const reportIdentity = await hashDopplerEvidence(report.initialExecutionIdentity);
const matching = [];
for (const target of capsule.targetPlans) {
  if (await hashDopplerEvidence(target.initialExecutionIdentity) === reportIdentity) matching.push(target);
}
assert.equal(matching.length, 1);
const targetDigest = hashTargetPlan(matching[0]);
const manifestArtifact = capsule.artifacts.find(row => row.artifactId === capsule.program.manifestArtifactId);
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
  partitionPlan: report.partitionPlan, partitionSplitLayer: report.partitionPlan.splitLayer,
  application: releaseEvents.at(-1).release.application, capsule, executablePack, packOpenOptions,
  source: { baseUrl: new URL(directory, baseUrl).href, files } };
for (const artifact of capsule.artifacts) resolvePartitionArtifactSource(model, manifest, files, artifact);
await writeFile(outputPath, JSON.stringify([model], null, 2) + '\n');
console.log(JSON.stringify({ modelIdentity: model.identity, capsule: executablePack.capsuleId,
  targetDigest, generationDigest: await hashDopplerEvidence(model.generation), artifacts: capsule.artifacts.length,
  outputPath: resolve(outputPath), publicCatalogChanged: false, physicalOpening: false }));
