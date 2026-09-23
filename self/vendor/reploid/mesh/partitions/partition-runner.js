/**
 * @fileoverview Reploid two-device layer partition runner.
 *
 * Places Doppler layer partitions across two cooperating devices:
 * - Device A executes Group 0 (embeddings + layers 0..k-1).
 * - Poolday WebRTC transfers serialized intermediate activation tensors under explicit disclosure grants.
 * - Device B executes Group 1 (layers k..N-1 + norm + lmHead), streaming output deltas.
 */

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createLayerPartitionRunner({
  runtime,
  plan,
  deviceA,
  deviceB,
  transport,
  authorize = async () => true
}) {
  // The host supplies Doppler; importing the mesh never loads an inference engine.
  assert(runtime && typeof runtime.LAYER_PARTITION_SCHEMA === 'string'
    && typeof runtime.ACTIVATION_TENSOR_SCHEMA === 'string'
    && typeof runtime.serializeActivationFrame === 'function'
    && typeof runtime.deserializeActivationFrame === 'function', 'Doppler partition runtime required');
  const { LAYER_PARTITION_SCHEMA, ACTIVATION_TENSOR_SCHEMA,
    serializeActivationFrame, deserializeActivationFrame } = runtime;
  assert(plan && plan.schema === LAYER_PARTITION_SCHEMA, 'Valid Doppler layer partition plan required');
  assert(typeof deviceA?.executeGroup0 === 'function', 'Device A must expose executeGroup0');
  assert(typeof deviceB?.executeGroup1 === 'function', 'Device B must expose executeGroup1');
  assert(typeof transport?.transferActivation === 'function', 'WebRTC transport must expose transferActivation');

  return Object.freeze({
    plan,
    async execute({
      tokenIds,
      continuationA = null,
      continuationB = null,
      disclosureGrant = null,
      signal = null,
      onDelta = () => {}
    }) {
      signal?.throwIfAborted();
      assert(Array.isArray(tokenIds) && tokenIds.length > 0, 'tokenIds must be a non-empty array');
      assert(disclosureGrant && disclosureGrant.schema === 'reploid.mesh.disclosure-grant/v1',
        'Intermediate activation transfer requires an explicit disclosure grant');

      const authorized = await authorize({
        action: 'mesh.transfer_intermediate_activation',
        disclosureGrant,
        modelId: plan.modelId,
        splitLayer: plan.splitLayer
      });
      assert(authorized === true, 'Activation disclosure grant declined');
      signal?.throwIfAborted();

      // Step 1: Device A executes Group 0 (Embeddings + Layers 0..k-1)
      const group0Result = await deviceA.executeGroup0({
        tokenIds,
        continuation: continuationA,
        signal
      });
      signal?.throwIfAborted();

      assert(group0Result?.activationTensor, 'Device A failed to produce activation tensor');
      const { shape, dtype, data, seqOffset, step } = group0Result.activationTensor;

      // Step 2: Serialize intermediate activation frame
      const frame = serializeActivationFrame({
        shape,
        dtype: dtype || plan.activationDtype,
        data,
        seqOffset: seqOffset ?? 0,
        step: step ?? 0,
        metadata: {
          modelId: plan.modelId,
          splitLayer: plan.splitLayer,
          grantId: disclosureGrant.id
        }
      });

      // Step 3: WebRTC transport transfers intermediate activation frame
      const receivedFrame = await transport.transferActivation(frame, { signal });
      signal?.throwIfAborted();
      assert(receivedFrame && receivedFrame.schema === ACTIVATION_TENSOR_SCHEMA,
        'Invalid activation frame received over transport');

      // Step 4: Device B deserializes and executes Group 1 (Layers k..N-1 + Norm + Head)
      const deserialized = deserializeActivationFrame(receivedFrame);
      const group1Result = await deviceB.executeGroup1({
        activation: deserialized,
        continuation: continuationB,
        signal,
        onDelta
      });
      signal?.throwIfAborted();

      return {
        content: group1Result.content,
        logits: group1Result.logits || null,
        tokenIds: group1Result.tokenIds || [],
        execution: {
          schema: 'reploid.mesh.partition-execution/v1',
          placement: 'two-device-layer-partition',
          modelId: plan.modelId,
          splitLayer: plan.splitLayer,
          activationBytes: frame.byteLength,
          group0: 'deviceA',
          group1: 'deviceB'
        }
      };
    }
  });
}

/**
 * Validates split partition execution against an unsplit single-device reference execution.
 */
export async function verifySplitParity({
  runtime,
  splitRunner,
  referenceRunner,
  tokenIds,
  disclosureGrant,
  tolerance = 1e-4
}) {
  assert(typeof runtime?.comparePartitionExecution === 'function', 'Doppler comparison runtime required');
  const [splitResult, refResult] = await Promise.all([
    splitRunner.execute({ tokenIds, disclosureGrant }),
    referenceRunner.execute({ tokenIds })
  ]);

  assert(splitResult.logits && refResult.logits, 'Both runners must provide output logits for numerical comparison');

  const comparison = runtime.comparePartitionExecution({
    splitOutput: splitResult.logits,
    referenceOutput: refResult.logits,
    tolerance
  });

  return {
    matches: comparison.matches,
    maxDiff: comparison.maxDiff,
    cosineSimilarity: comparison.cosineSimilarity,
    tolerance,
    splitResult,
    refResult,
    comparison
  };
}
