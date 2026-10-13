// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as accepted from 'doppler-gpu/partitions';
import { createWorkPartitionPlan, workOrderedResidentOptions } from '../../self/host/work-partition-plan.js';

const manifest = { modelId: 'plan-fixture', architecture: { numLayers: 4, hiddenSize: 8, vocabSize: 16 },
  inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } };
const selected = { id: manifest.modelId, partitionSplitLayer: 2 };
describe('host plan selection against the unchanged installed Doppler pin', () => {
  it('preserves legacy plan construction and accepts the same explicit v1 plan', () => {
    const plan = createWorkPartitionPlan(accepted, manifest, selected);
    expect(plan.schema).toBe('doppler.layer-partition-contract/v1');
    expect(createWorkPartitionPlan(accepted, manifest, { ...selected, partitionPlan: plan })).toEqual(plan);
  });
  it('does not call absent provider capabilities for the legacy assembly path', () => {
    const runtime = { createLayerPartitionPlan: accepted.createLayerPartitionPlan };
    expect(createWorkPartitionPlan(runtime, manifest, selected).schema).toBe('doppler.layer-partition-contract/v1');
  });
  it('rejects paired metadata with the accepted scalar provider', () => {
    const plan = createWorkPartitionPlan(accepted, manifest, selected);
    const paired = { ...plan, schema: 'doppler.layer-partition-contract/v2', activationPrecision: 'two-f32',
      activationComponents: 2, activationElementStrideBytes: 8 };
    expect(() => createWorkPartitionPlan(accepted, manifest, { ...selected, partitionPlan: paired })).toThrow();
  });
  it('rejects ordered contribution with the actual accepted runtime before opening it', () => {
    const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: manifest.modelId,
      stageCount: 3, splitLayers: [1, 3] };
    expect(() => createWorkPartitionPlan(accepted, manifest,
      { id: manifest.modelId, partitionPlan: plan }, 1)).toThrow(/ordered plan/);
    expect(() => workOrderedResidentOptions(accepted, { index: 1 })).toThrow(/ordered resident/);
  });
  it('rejects altered model geometry and missing validation without fallback', () => {
    const plan = createWorkPartitionPlan(accepted, manifest, selected);
    expect(() => createWorkPartitionPlan(accepted, { ...manifest, architecture: { ...manifest.architecture, hiddenSize: 16 } }, { ...selected, partitionPlan: plan })).toThrow(/manifest/);
    expect(() => createWorkPartitionPlan({}, manifest, { ...selected, partitionPlan: plan })).toThrow(/validator/);
  });
});
