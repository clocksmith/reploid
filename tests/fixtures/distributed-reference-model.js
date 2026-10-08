import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const referenceIdentity = 'sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9';

export function compareReferenceModel(model, baseline) {
  const project = value => {
    const copy = structuredClone(value);
    delete copy.artifactIdentity.conversionConfigDigest;
    delete copy.artifactIdentity.weightCapsuleId;
    delete copy.metadata.manifestRefresh.at;
    for (const kernel of Object.values(copy.inference.execution.kernels)) delete kernel.digest;
    return copy;
  };
  if (model.artifactIdentity.weightCapsuleId !== undefined) {
    assert.equal(model.artifactIdentity.weightCapsuleId, baseline.artifactIdentity.weightPackId);
  }
  assert.deepEqual(project(model), project(baseline),
    'Frozen comparison must retain exact weights, tokenizer, layers, precision, cache and declared shader entries');
  return Object.entries(model.inference.execution.kernels)
    .filter(([id, kernel]) => kernel.digest !== baseline.inference.execution.kernels[id].digest)
    .map(([id, kernel]) => ({ id, kernel: kernel.kernel, entry: kernel.entry,
      frozenDigest: baseline.inference.execution.kernels[id].digest, currentDigest: kernel.digest }));
}

export async function bindReferenceModel(model, frozenIdentity) {
  const bytes = gunzipSync(await readFile(new URL('./distributed-reference-manifest.json.gz', import.meta.url)));
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), referenceIdentity);
  assert.equal(frozenIdentity, referenceIdentity);
  return { frozenModelIdentity: referenceIdentity,
    weightsTokenizerAndExecutionContractUnchanged: true,
    changedKernelPins: compareReferenceModel(model, JSON.parse(bytes)) };
}
