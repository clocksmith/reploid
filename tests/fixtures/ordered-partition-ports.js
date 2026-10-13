import { vi } from 'vitest';
import * as codecs from 'doppler-gpu/partitions';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';

// Injected numerical stages: proves orchestration, not GPU execution or capacity.
const digest = c => 'sha256:' + c.repeat(64);
export function fixture(count = 3, limit = 2) {
  const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'model', totalLayers: count * 2,
    hiddenSize: 8, vocabSize: 128, stageCount: count, splitLayers: Array.from({ length: count - 1 }, (_, i) => (i + 1) * 2),
    activationDtype: 'f32', activationPrecision: 'f32', activationComponents: 1, activationElementStrideBytes: 4,
    partitions: Array.from({ length: count }, (_, index) => ({ index, startLayer: index * 2, endLayer: index * 2 + 2 })) };
  const activation = { schema: codecs.ACTIVATION_TENSOR_SCHEMA, dtype: 'f32', hiddenSize: 8,
    precision: 'f32', components: 1, elementStrideBytes: 4 };
  const runtime = { ...codecs, ORDERED_LAYER_PARTITION_SCHEMA: plan.schema,
    validateOrderedLayerPartitionPlan: vi.fn(() => plan), hashLayerPartitionPlan: vi.fn(() => digest('b')), hashPartitionGeneration: vi.fn(() => digest('c')),
    getPartitionActivationContract: () => activation,
    validateActivationFrameForPlan: frame => codecs.deserializeActivationFrame(frame) };
  const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: digest('a'), planId: digest('b'),
    activation, stages: Array.from({ length: count }, (_, index) => ({ index, participantId: `node-${index}`,
      transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
  const calls = [];
  const stages = route.stages.map(({ index, participantId, ...ids }) => ({ id: participantId, ...ids,
    reserve: vi.fn(async ({ identity, partitionIndex }) => { calls.push(['reserve', partitionIndex, identity.attemptId]);
      return { identity, partitionIndex, status: 'reserved' }; }),
    closeAttempt: vi.fn(async ({ identity }) => { calls.push(['close', index, identity.attemptId]); }),
    executeStage: vi.fn(async args => {
      const { identity, partitionIndex, step, tokenPosition, inputTokenIds } = args;
      calls.push(['execute', index, identity.attemptId, step, [...inputTokenIds]]);
      const result = { identity, partitionIndex, step, tokenPosition, continuation: { step } };
      if (index === count - 1) return { ...result, tokenId: 10 + step, delta: String(step), done: step === 2, stopReason: 'eos' };
      return { ...result, activationTensor: { shape: [1, inputTokenIds.length, 8], dtype: 'f32',
        data: new Float32Array(inputTokenIds.length * 8).fill(index + step), seqOffset: tokenPosition, step } };
    }) }));
  const request = { tokenIds: [1, 2], maxTokens: 3, generation: { maxTokens: 3 },
    identity: { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'attempt',
      requesterId: 'requester', placementGeneration: 0, route },
    grants: { execution: stages.map(() => ({ id: 'execution' })), tokenContext: stages.map(() => ({ id: 'context' })),
      activation: stages.slice(1).map(() => ({ id: 'activation' })), output: { id: 'output' } } };
  const options = { runtime, plan, route, stages, authorize: vi.fn(async () => true),
    transport: { transferActivation: vi.fn(async frame => structuredClone(frame)) },
    limits: { maxTokens: 10, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 100,
      maxAttempts: 100, maxConcurrentAttempts: limit, maxStages: 32 } };
  return { ...options, request, calls, runner: createLayerPartitionRunner(options) };
}
export function another(f, id) { return { ...f.request, identity: { ...f.request.identity, attemptId: id, threadId: id } }; }

