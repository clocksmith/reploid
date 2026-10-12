// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { bindPairedPartitionFixture, assertPartitionTraversal } from '../fixtures/paired-partition-binding.js';

const baseline = JSON.parse(gunzipSync(readFileSync('tests/fixtures/distributed-reference-manifest.json.gz')));
const identity = 'sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(change = () => {}) {
  const model = structuredClone(baseline);
  model.inference.execution = { kernels: { norm: { kernel: 'paired.wgsl', entry: 'main' } } };
  change(model);
  const graphBytes = Buffer.from(JSON.stringify(model.inference.execution));
  const modelBytes = Buffer.from(JSON.stringify(model)), archiveBytes = Buffer.from('immutable test archive');
  const bindingBytes = Buffer.from(JSON.stringify({ archiveSha256: hash(archiveBytes), manifestSha256: hash(modelBytes),
    graphSha256: hash(graphBytes), representation: 'Explicit session intermediatePrecision=two-f32 and linearRecurrentStatePrecision=two-f32' }));
  return { graphBytes, modelBytes, archiveBytes, bindingBytes, referenceIdentity: identity };
}
function plans() {
  const activation = { type: 'activation-tensor', dtype: 'f32', hiddenSize: 1024 };
  const scalar = { schema: 'doppler.layer-partition-contract/v1', splitLayer: 12, totalLayers: 24,
    activationDtype: 'f32', partitions: [
      { index: 0, layerRange: [0, 11], hasEmbedding: true, hasLmHead: false,
        inputContract: { type: 'token-ids' }, outputContract: activation },
      { index: 1, layerRange: [12, 23], hasEmbedding: false, hasLmHead: true,
        inputContract: activation, outputContract: { type: 'logits', dtype: 'f32' } }
    ] };
  const paired = structuredClone(scalar);
  Object.assign(paired, { schema: 'doppler.layer-partition-contract/v2', activationPrecision: 'two-f32',
    activationComponents: 2, activationElementStrideBytes: 8 });
  for (const part of paired.partitions) for (const key of ['inputContract', 'outputContract']) {
    if (part[key].type === 'activation-tensor') Object.assign(part[key], { precision: 'two-f32', components: 2, elementStrideBytes: 8 });
  }
  return { scalar, paired };
}
describe('Explicit paired physical fixture binding', () => {
  it('retains source facts without changing the candidate runtime graph', async () => {
    const input = fixture(), before = input.modelBytes.toString();
    const result = await bindPairedPartitionFixture(input);
    expect(result.executionGraphChanged).toBe(true);
    expect(result.session.intermediatePrecision).toBe('two-f32');
    expect(input.modelBytes.toString()).toBe(before);
  });
  it.each(['weights', 'tokenizer', 'layers', 'epsilon', 'cache', 'activation'])('rejects changed %s despite matching candidate hashes', async kind => {
    const input = fixture(model => {
      if (kind === 'weights') model.shards[0].hash = '0'.repeat(64);
      if (kind === 'tokenizer') model.tokenizer.file = 'different.json';
      if (kind === 'layers') model.architecture.numLayers++;
      if (kind === 'epsilon') model.inference.normalization.rmsNormEps = 1;
      if (kind === 'cache') model.inference.session.kvcache = { dtype: 'f32' };
      if (kind === 'activation') model.inference.session.compute.defaults.activationDtype = 'f16';
    });
    await expect(bindPairedPartitionFixture(input)).rejects.toThrow();
  });
  it.each(['archiveBytes', 'modelBytes', 'graphBytes', 'referenceIdentity'])('rejects an unbound %s', async key => {
    const input = fixture(); input[key] = key === 'referenceIdentity' ? 'sha256:wrong' : Buffer.from('{}');
    await expect(bindPairedPartitionFixture(input)).rejects.toThrow();
  });
  it('accepts only the explicit representation delta to the exact legacy traversal', () => {
    const { scalar, paired } = plans();
    expect(() => assertPartitionTraversal(scalar, paired)).not.toThrow();
  });
  it.each(['split', 'range', 'role', 'shape', 'stride', 'schema', 'order'])('rejects changed %s', kind => {
    const { scalar, paired } = plans();
    if (kind === 'split') paired.splitLayer++;
    if (kind === 'range') paired.partitions[0].layerRange[1]++;
    if (kind === 'role') paired.partitions[0].hasLmHead = true;
    if (kind === 'shape') paired.partitions[0].outputContract.hiddenSize++;
    if (kind === 'stride') paired.partitions[1].inputContract.elementStrideBytes = 4;
    if (kind === 'schema') paired.schema = scalar.schema;
    if (kind === 'order') paired.partitions.reverse();
    expect(() => assertPartitionTraversal(scalar, paired)).toThrow();
  });
});
