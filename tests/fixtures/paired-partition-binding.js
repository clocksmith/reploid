/** Explicit test-only binding for an approved paired execution candidate.
 * Source-fact comparison never changes the manifest passed to the runtime. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { compareReferenceModel } from './distributed-reference-model.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const frozenIdentity = 'sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9';
export async function bindPairedPartitionFixture({ bindingBytes, graphBytes, modelBytes, archiveBytes, referenceIdentity }) {
  assert.equal(referenceIdentity, frozenIdentity, 'Paired fixture must retain the frozen model authority');
  const binding = JSON.parse(bindingBytes), graph = JSON.parse(graphBytes), model = JSON.parse(modelBytes);
  assert.equal(binding.archiveSha256, digest(archiveBytes), 'Candidate archive differs');
  assert.equal(binding.manifestSha256, digest(modelBytes), 'Candidate manifest differs');
  assert.equal(binding.graphSha256, digest(graphBytes), 'Declared paired graph differs');
  assert.equal(binding.representation, 'Explicit session intermediatePrecision=two-f32 and linearRecurrentStatePrecision=two-f32');
  assert.deepEqual(model.inference.execution, graph, 'Runtime manifest must execute the exact bound graph');
  const baselineBytes = gunzipSync(await readFile(new URL('./distributed-reference-manifest.json.gz', import.meta.url)));
  assert.equal('sha256:' + digest(baselineBytes), frozenIdentity);
  const baseline = JSON.parse(baselineBytes), sourceFacts = structuredClone(model);
  sourceFacts.inference.execution = structuredClone(baseline.inference.execution);
  compareReferenceModel(sourceFacts, baseline);
  return Object.freeze({ bindingSha256: digest(bindingBytes), archiveSha256: binding.archiveSha256,
    manifestIdentity: 'sha256:' + binding.manifestSha256, graphSha256: binding.graphSha256,
    frozenModelIdentity: frozenIdentity, weightsTokenizerAndSourceFactsUnchanged: true,
    executionGraphChanged: true, scope: 'Test-only paired execution binding; not qualification or adoption',
    activation: Object.freeze({ activationPrecision: 'two-f32', activationComponents: 2, activationElementStrideBytes: 8 }),
    session: Object.freeze({ intermediatePrecision: 'two-f32', linearRecurrentStatePrecision: 'two-f32' }) });
}

export function assertPartitionTraversal(referencePlan, pairedPlan) {
  assert.equal(referencePlan.schema, 'doppler.layer-partition-contract/v1');
  const projected = structuredClone(pairedPlan);
  assert.equal(projected.schema, 'doppler.layer-partition-contract/v2');
  assert.equal(projected.activationPrecision, 'two-f32');
  assert.equal(projected.activationComponents, 2);
  assert.equal(projected.activationElementStrideBytes, 8);
  projected.schema = referencePlan.schema;
  delete projected.activationPrecision; delete projected.activationComponents; delete projected.activationElementStrideBytes;
  // The v2 tensor contract also declares its physical representation explicitly.
  for (const partition of projected.partitions) {
    for (const name of ['inputContract', 'outputContract']) {
      const contract = { ...partition[name] };
      partition[name] = contract;
      if (contract.type !== 'activation-tensor') continue;
      assert.equal(contract.precision, 'two-f32');
      assert.equal(contract.components, 2);
      assert.equal(contract.elementStrideBytes, 8);
      for (const key of ['precision', 'components', 'elementStrideBytes']) delete contract[key];
    }
  }
  assert.deepEqual(projected, referencePlan, 'Paired representation must preserve exact partition geometry and roles');
}

export async function loadPairedPartitionFixture({ modelDirectory, archivePath, referenceIdentity }) {
  const bindingFile = process.env.REPLOID_PAIRED_EXECUTION_BINDING;
  const graphFile = process.env.REPLOID_PAIRED_EXECUTION_GRAPH;
  if (!bindingFile && !graphFile) return null;
  assert(bindingFile && graphFile, 'Paired fixture requires both binding and graph');
  const [bindingBytes, graphBytes, modelBytes, archiveBytes] = await Promise.all([
    readFile(bindingFile), readFile(graphFile), readFile(resolve(modelDirectory, 'manifest.json')), readFile(archivePath)
  ]);
  return bindPairedPartitionFixture({ bindingBytes, graphBytes, modelBytes, archiveBytes, referenceIdentity });
}
