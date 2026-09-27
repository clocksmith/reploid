/** Injected arithmetic executor for API/lifecycle tests. Never a model inference claim. */
export function createPartitionRuntimeFixture({ beforeStep = async () => {} } = {}) {
  const log = { opens: [], steps: [], tokenizations: [], settlements: [], closes: [] };
  return { log, async openResidentPartition(allocation) {
    const { model, plan, planId, index } = allocation;
    log.opens.push(index);
    const retired = new Set();
    const positions = new Map();
    let closed = false;
    const descriptor = { schema: 'doppler.resident-partition/v1', ready: true,
      modelId: model.id, modelIdentity: model.identity, planId, index,
      layerRange: [...plan.partitions[index].layerRange], residentWeightBytes: 1024 };
    async function step(request) {
      if (closed || retired.has(request.identity.attemptId)) throw new Error('Fixture attempt retired');
      const expected = positions.get(request.identity.attemptId) || { step: 0, position: 0 };
      if (expected.step !== request.step || expected.position !== request.tokenPosition) throw new Error('Fixture mixed generation state');
      log.steps.push({ index, threadId: request.identity.threadId, attemptId: request.identity.attemptId,
        step: request.step, tokenPosition: request.tokenPosition, maxTokens: request.maxTokens,
        tokenIds: request.tokenIds || null });
      await beforeStep(request, index);
      positions.set(request.identity.attemptId, { step: request.step + 1, position: request.tokenPosition + request.inputTokenCount });
    }
    return {
      getDescriptor: () => ({ ...descriptor, ready: !closed }),
      async tokenize({ messages }) {
        log.tokenizations.push(structuredClone(messages));
        const value = Number.parseInt(messages.at(-1).content, 10);
        if (!Number.isFinite(value)) throw new Error('Fixture expects a numeric test prompt');
        return { modelIdentity: model.identity, tokenIds: [value],
          generation: { maxTokens: model.generation?.maxTokens ?? allocation.limits.maxTokens,
            maxSeqLen: model.generation?.maxSeqLen ?? 128, temperature: 0, topK: 0, topP: 1,
            repetitionPenalty: 1, repetitionPenaltyWindow: 0, presencePenalty: 0, useChatTemplate: false } };
      },
      async executeGroup0(request) {
        await step(request);
        return { activationTensor: { shape: [1, request.tokenIds.length, plan.hiddenSize], dtype: 'f32',
          data: new Float32Array(request.tokenIds.length * plan.hiddenSize).fill(request.tokenIds[0]),
          seqOffset: request.tokenPosition, step: request.step }, continuation: { position: request.tokenPosition + request.inputTokenCount } };
      },
      async executeGroup1(request) {
        await step(request);
        const tokenId = request.activation.tensorData[0] + 1;
        return { identity: request.identity, step: request.step, tokenPosition: request.tokenPosition,
          tokenId, delta: String(tokenId) + ' ', done: request.step === 2 || request.step + 1 === request.maxTokens,
          stopReason: request.step === 2 ? 'fixture-eos' : 'max-tokens', logits: [tokenId, -tokenId],
          continuation: { position: request.tokenPosition + request.inputTokenCount } };
      },
      async closeAttempt({ identity }) {
        if (!retired.has(identity.attemptId)) log.settlements.push({ index, attemptId: identity.attemptId });
        retired.add(identity.attemptId); positions.delete(identity.attemptId);
      },
      async close() { if (!closed) log.closes.push(index); closed = true; positions.clear(); }
    };
  } };
}
