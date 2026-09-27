/** Installed public factory and verified Capsule gate with a signed synthetic plan. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createDopplerRun } from 'doppler-gpu';
import { createResidentPartitionFactory, hashLayerPartitionPlan } from 'doppler-gpu/partitions';
import { createResidentPartition } from '../../packages/reploid/src/mesh/index.js';

const fixture = JSON.parse(await fs.readFile(new URL('../../artifacts/partition-resident/20260927/signed-opening-fixture.json',
  import.meta.url), 'utf8'));
const pin = JSON.parse(await fs.readFile(new URL('../../self/config/doppler-package.json', import.meta.url), 'utf8'));
const archive = await fs.readFile(new URL('../../deploy/artifacts/doppler-gpu-0.6.3-dev.split.1.tgz', import.meta.url));
assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), pin.integrity);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('doppler-gpu'))), '..');
const installed = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const [{ resolveResidentPartitionAllocation }, { computeCanonicalSha256 }] = await Promise.all([
  installed('inference/pipelines/text/resident-partition-contract.js'), installed('formats/canonical-hash.js')]);
const artifacts = new Map(fixture.artifacts.map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
const device = { getProfile: () => ({ surface: 'test-webgpu', maxBufferSize: 1024 }),
  getDevice: () => ({ createBuffer() {}, createCommandEncoder() {} }) };
const opened = [];
const run = createDopplerRun({ device, trustedSigners: fixture.trustedSigners,
  artifactStore: {
    async readArtifact(artifact) { return artifacts.get(artifact.artifactId); },
    async hashArtifact(artifact) {
      const bytes = artifacts.get(artifact.artifactId);
      return { hash: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength };
    },
  }, resolveResidentPartitionAllocation,
  async programFactory({ options, targetPlan }) {
    const allocation = options.residentPartition;
    opened.push({ index: allocation.index, planId: allocation.planId });
    const descriptor = { schema: 'doppler.resident-partition/v1', ready: true,
      modelId: allocation.model.id, modelIdentity: allocation.model.identity,
      planId: allocation.planId, index: allocation.index,
      layerRange: allocation.plan.partitions[allocation.index].layerRange,
      residentWeightBytes: 1024, generationDigest: computeCanonicalSha256(allocation.generation) };
    return { getInitialExecutionIdentity: () => targetPlan.initialExecutionIdentity,
      residentPartition: { getDescriptor: () => descriptor,
        tokenize: async () => { throw new Error('Synthetic opening fixture has no model math.'); },
        executeGroup0: async () => { throw new Error('Synthetic opening fixture has no model math.'); },
        closeAttempt: async () => {}, close: async () => {} },
      close: async () => {} };
  },
});
const factory = createResidentPartitionFactory({ openCapsule: run.openCapsule,
  capsuleOptions: {} });
const model = { ...fixture.model, capsule: fixture.capsule };
const planId = hashLayerPartitionPlan(fixture.plan);
const local = createResidentPartition({ runtime: factory, model, plan: fixture.plan, planId,
  index: 0, participantId: 'signed-a', limits: fixture.limits });
try {
  await local.prepare({ approved: true });
  assert.equal(local.getState().descriptor.planId, planId);
  assert.deepEqual(opened, [{ index: 0, planId }]);
  const unqualified = createResidentPartition({ runtime: factory, model, plan: fixture.plan, planId,
    index: 1, participantId: 'signed-b', limits: fixture.limits });
  try {
    await assert.rejects(unqualified.prepare({ approved: true }), /no signed resident partition qualification/);
    assert.deepEqual(opened, [{ index: 0, planId }], 'unqualified split must not create a program');
  } finally { await unqualified.close(); }
  console.log(JSON.stringify({ schema: 'reploid.installed-signed-partition-opening/v1', passed: true,
    packageRoot, archiveIntegrity: pin.integrity, planId, modelIdentity: model.identity, qualifiedIndex: 0,
    unqualifiedIndexRejected: 1, modelMath: false }));
} finally { await local.close(); }
