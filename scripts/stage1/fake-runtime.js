/**
 * A model runtime with no model in it, for proving the harness on one machine. It opens no GPU and reads no weights.
 * The frozen reference tokens are replayed by the final stage, so token equality here shows that the harness carries
 * and judges tokens. It says nothing about whether a real split computes them.
 */
import * as doppler from 'dopplerx/partitions';

/** Divides the answer across its visible tokens, whatever their number, so the deltas concatenate to it exactly. */
export function fakeTokenTexts(outputText, tokenCount) {
  const characters = Array.from(outputText);
  return Array.from({ length: tokenCount }, (_, index) => characters
    .slice(Math.floor(index * characters.length / tokenCount), Math.floor((index + 1) * characters.length / tokenCount)).join(''));
}

const ACTIVATION_SEED = 7;
const activationValue = step => ACTIVATION_SEED + step;

/**
 * `reference` holds the fixture's prompt and output IDs. Holding an answer for a cancel is the gate's job
 * (stage-participant.js), which is the same on real hosts.
 */
export function createFakeStageRuntime({ model, manifest, reference }) {
  const outputIds = [...reference.visibleOutputIds, reference.stopId];
  const deltas = [...fakeTokenTexts(reference.outputText, reference.visibleOutputIds.length), ''];
  const openFactory = () => ({
    async openResidentPartition({ model: selected, plan, planId, index }) {
      const generation = selected.generation, generationDigest = await doppler.hashPartitionGeneration(generation);
      const layerRange = plan.partitions[index].layerRange, final = index === plan.stageCount - 1;
      return {
        getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
        getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, stageCount: plan.stageCount, modelId: model.id,
          modelIdentity: model.identity, generationDigest, planId, index, layerRange, residentWeightBytes: 1024 }),
        tokenize: async () => ({ modelIdentity: model.identity, tokenIds: [...reference.inputIds], generation }),
        async executeStage({ identity, partitionIndex, step, tokenPosition, inputTokenIds, activation }) {
          const base = { identity, partitionIndex, step, tokenPosition, continuation: { step } };
          if (!final) {
            const hiddenSize = plan.hiddenSize;
            return { ...base, activationTensor: { shape: [1, inputTokenIds.length, hiddenSize], dtype: 'f32',
              data: new Float32Array(inputTokenIds.length * hiddenSize).fill(activationValue(step)), seqOffset: tokenPosition, step } };
          }
          // The reference token is released only for the activation stage 0 sent over the real channel.
          const values = activation?.data ?? activation?.tensorData;
          const received = values && new Float32Array(values.buffer ?? values, values.byteOffset ?? 0, (values.byteLength ?? 0) / 4);
          if (!received?.length || received[0] !== activationValue(step) || received.at(-1) !== activationValue(step)) {
            throw Error('Fake final stage received an unexpected activation');
          }
          const done = step === outputIds.length - 1;
          return { ...base, tokenId: outputIds[step], delta: deltas[step], done, ...(done ? { stopReason: 'eos-token' } : {}) };
        },
        closeAttempt: async () => {},
        close: async () => {}
      };
    }
  });
  return { ...doppler, configureDeviceMemoryBudget: async () => {},
    inspectDeviceMemory: () => ({ liveBytes: 1024, maxBytes: 1024, peakBytes: 1024, allocations: 1, rejected: 0 }),
    createVerifiedPieceStorage: async () => ({ manifest,
      storage: { rangeLease: { read: async () => new ArrayBuffer(0), concurrency: 1 }, preflight: async () => {},
        loadTokenizerJson: async () => ({}), loadShardRange: async () => new ArrayBuffer(0), close: async () => {} },
      getReceipt: () => ({ verifiedBytes: 0 }), getGatherReceipt: () => ({ verifiedBytes: 0 }) }),
    createManifestResidentPartitionFactory: openFactory };
}
