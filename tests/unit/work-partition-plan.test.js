// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as accepted from 'doppler-gpu/partitions';
import { createWorkPartitionPlan, workOrderedResidentOptions, snapshotWorkOrderedParticipation, bindWorkOrderedParticipation } from '../../self/host/work-partition-plan.js';

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

describe('explicit ordered host participation', () => {
  const model = { id: 'ordered', partitionPlan: { schema: 'doppler.layer-partition-contract/v3', stageCount: 3 } };
  const config = () => ({ stage: { modelId: 'ordered', index: 1, residentId: 'resident', executionId: 'execution' },
    maxStages: 7, maxStageOffersPerPeer: 4, maxRouteBytes: 8192, maxSelectionSteps: 2000, maxRoutes: 4 });
  it('snapshots configured allocation and binds only authenticated participant and transport', () => {
    const input = config(), frozen = snapshotWorkOrderedParticipation(input, null, [model]);
    input.stage.index = 2;
    const baseline = { executionChannel: { timeoutMs: 300000 }, limits: { maxActivationBytes: 32 * 1024 * 1024 } };
    const bound = bindWorkOrderedParticipation(frozen, 'actual', 'rtc-actual', baseline);
    expect(bound.ordered.stage).toEqual({ index: 1, participantId: 'actual', transportId: 'rtc-actual', residentId: 'resident', executionId: 'execution' });
    expect(bound.policy.executionChannel).toEqual(baseline.executionChannel);
    expect(bound.policy.limits.maxActivationBytes).toBe(baseline.limits.maxActivationBytes);
    expect(baseline.limits.maxStages).toBeUndefined();
  });
  it('rejects missing/unsupported stage geometry, identity mismatches and canonical coexistence', () => {
    for (const change of [c => delete c.maxStages, c => c.stage.index = 3, c => c.stage.modelId = 'other', c => c.stage.executionId = '']) {
      const input = config(); change(input); expect(() => snapshotWorkOrderedParticipation(input, null, [model])).toThrow();
    }
    expect(() => snapshotWorkOrderedParticipation(config(), {}, [model])).toThrow('ordinary');
    expect(() => snapshotWorkOrderedParticipation(config(), null, [{id:'ordered'}])).toThrow('declared');
    const c = config(); c.stage.transportId = 'spoof';
    expect(() => bindWorkOrderedParticipation(snapshotWorkOrderedParticipation(c, null, [model]), 'actual', 'rtc-actual', {})).toThrow('authenticated');
  });
  it('weightless requester binds no stage and legacy mode needs no new runtime or transport fields', () => {
    const c = { ...config(), stage: null };
    expect(bindWorkOrderedParticipation(snapshotWorkOrderedParticipation(c, null, []), 'requester', 'rtc', {}).ordered.stage).toBeNull();
    const policy = {};
    expect(bindWorkOrderedParticipation(null, null, null, policy)).toEqual({ ordered: null, policy });
  });
});
