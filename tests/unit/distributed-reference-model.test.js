// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compareReferenceModel, bindReferenceModel } from '../fixtures/distributed-reference-model.js';

const baseline = JSON.parse(gunzipSync(readFileSync('tests/fixtures/distributed-reference-manifest.json.gz')));
const identity = 'sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9';

describe('Frozen comparison model binding', () => {
  it('permits a declared shader revision while preserving the numerical reference', async () => {
    const model = structuredClone(baseline);
    model.inference.execution.kernels.rmsnorm.digest = 'sha256:' + 'a'.repeat(64);
    model.artifactIdentity.conversionConfigDigest = 'sha256:' + 'b'.repeat(64);
    const binding = await bindReferenceModel(model, identity);
    expect(binding.changedKernelPins).toHaveLength(1);
    expect(binding.changedKernelPins[0].entry).toBe('main');
  });

  it.each(['weights', 'tokenizer', 'layers', 'precision', 'entry', 'epsilon'])(
    'rejects changed %s', kind => {
      const model = structuredClone(baseline);
      if (kind === 'weights') model.shards[0].hash = '0'.repeat(64);
      if (kind === 'tokenizer') model.tokenizer.file = 'other.json';
      if (kind === 'layers') model.architecture.numLayers++;
      if (kind === 'precision') model.inference.session.compute.defaults.activationDtype = 'f16';
      if (kind === 'entry') model.inference.execution.kernels.rmsnorm.entry = 'main_subgroup';
      if (kind === 'epsilon') model.inference.normalization.rmsNormEps = 1;
      expect(() => compareReferenceModel(model, baseline)).toThrow();
    }
  );

  it('rejects a different frozen model identity', async () => {
    await expect(bindReferenceModel(baseline, 'sha256:' + '0'.repeat(64))).rejects.toThrow();
  });
});
