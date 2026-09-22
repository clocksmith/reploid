import { describe, it, expect, vi } from 'vitest';
import {
  createLayerPartitionPlan,
  serializeActivationFrame,
  deserializeActivationFrame,
  comparePartitionExecution
} from 'doppler-gpu';
import {
  createLayerPartitionRunner,
  verifySplitParity
} from '../../packages/reploid/src/mesh/partitions/partition-runner.js';

describe('Layer Partition Runner & WebRTC Activation Transfer', () => {
  const modelId = 'qwen-3-5-0-8b-q4k-ehaf16';
  const hiddenSize = 32;
  const vocabSize = 128;
  const numLayers = 16;
  const splitLayer = 8;

  const plan = createLayerPartitionPlan({
    modelId,
    numLayers,
    hiddenSize,
    vocabSize,
    splitLayer
  });

  const validGrant = {
    schema: 'reploid.mesh.disclosure-grant/v1',
    id: 'grant-partition-test',
    requesterId: 'tab-a',
    targetParticipantId: 'tab-b',
    scope: 'intermediate-activation',
    expiresAt: Date.now() + 60000
  };

  it('coordinates Device A, WebRTC transport, and Device B for two-device split execution', async () => {
    const tokenIds = [101, 2054, 2003, 102];
    const seqLen = tokenIds.length;
    const deltas = [];

    // Device A: Embeddings + layers 0..7
    const deviceA = {
      executeGroup0: vi.fn(async ({ tokenIds: tokens }) => {
        const total = 1 * tokens.length * hiddenSize;
        const data = new Float32Array(total);
        for (let i = 0; i < total; i++) data[i] = (i + 1) * 0.01;
        return {
          activationTensor: {
            shape: [1, tokens.length, hiddenSize],
            dtype: 'f32',
            data,
            seqOffset: 0,
            step: 0
          }
        };
      })
    };

    // WebRTC Transport: transfers serialized frame
    const transport = {
      transferActivation: vi.fn(async frame => {
        expect(frame.schema).toBe('doppler.activation-tensor/v1');
        expect(frame.byteLength).toBe(1 * seqLen * hiddenSize * 4);
        return frame;
      })
    };

    // Device B: Layers 8..15 + Norm + LM Head
    const deviceB = {
      executeGroup1: vi.fn(async ({ activation, onDelta }) => {
        expect(activation.shape).toEqual([1, seqLen, hiddenSize]);
        onDelta('Split token 1');
        onDelta('Split token 2');
        const logits = new Float32Array(vocabSize);
        for (let i = 0; i < vocabSize; i++) logits[i] = Math.sin(i);
        return {
          content: 'Split token 1Split token 2',
          tokenIds: [50, 51],
          logits
        };
      })
    };

    const runner = createLayerPartitionRunner({
      plan,
      deviceA,
      deviceB,
      transport
    });

    const result = await runner.execute({
      tokenIds,
      disclosureGrant: validGrant,
      onDelta: delta => deltas.push(delta)
    });

    expect(deviceA.executeGroup0).toHaveBeenCalledTimes(1);
    expect(transport.transferActivation).toHaveBeenCalledTimes(1);
    expect(deviceB.executeGroup1).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['Split token 1', 'Split token 2']);
    expect(result.content).toBe('Split token 1Split token 2');
    expect(result.execution.placement).toBe('two-device-layer-partition');
    expect(result.execution.splitLayer).toBe(8);
    expect(result.execution.activationBytes).toBe(1 * seqLen * hiddenSize * 4);
  });

  it('rejects partition execution when disclosure grant is absent or declined', async () => {
    const runner = createLayerPartitionRunner({
      plan,
      deviceA: { executeGroup0: vi.fn() },
      deviceB: { executeGroup1: vi.fn() },
      transport: { transferActivation: vi.fn() },
      authorize: vi.fn(async () => false)
    });

    await expect(runner.execute({
      tokenIds: [1, 2, 3],
      disclosureGrant: null
    })).rejects.toThrow('Intermediate activation transfer requires an explicit disclosure grant');

    await expect(runner.execute({
      tokenIds: [1, 2, 3],
      disclosureGrant: validGrant
    })).rejects.toThrow('Activation disclosure grant declined');
  });

  it('verifies split-versus-unsplit numerical parity within declared tolerance', async () => {
    const tokenIds = [10, 20, 30];
    const logitsRef = new Float32Array(vocabSize);
    const logitsSplit = new Float32Array(vocabSize);

    for (let i = 0; i < vocabSize; i++) {
      logitsRef[i] = Math.cos(i * 0.1);
      // Small numerical deviation within tolerance <= 1e-4
      logitsSplit[i] = Math.cos(i * 0.1) + 0.00002 * (i % 2 === 0 ? 1 : -1);
    }

    const splitRunner = {
      execute: vi.fn(async () => ({
        content: 'Response',
        logits: logitsSplit,
        execution: { placement: 'two-device-layer-partition' }
      }))
    };

    const referenceRunner = {
      execute: vi.fn(async () => ({
        content: 'Response',
        logits: logitsRef,
        execution: { placement: 'local-webgpu' }
      }))
    };

    const parity = await verifySplitParity({
      splitRunner,
      referenceRunner,
      tokenIds,
      disclosureGrant: validGrant,
      tolerance: 1e-4
    });

    expect(parity.matches).toBe(true);
    expect(parity.maxDiff).toBeLessThanOrEqual(1e-4);
    expect(parity.cosineSimilarity).toBeGreaterThanOrEqual(0.9999);
  });
});
