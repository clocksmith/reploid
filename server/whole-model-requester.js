/** Native requester projection over the same whole-model mesh used by the browser.
 * Completion counts are provider reports, not independently validated billing evidence. */
import { randomUUID } from 'node:crypto';
import { projectChatCatalog } from '../apps/poolday/host/chat-view.js';
import { readWorkGenerationCompletion } from '../apps/poolday/providers/work-generation-completion.js';
import { canonicalPartitionJson, partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';
import { TEXT_GENERATION_CAPABILITY, generationRequest, tokenUsage } from '../packages/reploid/src/mesh/partitions/partition-generation-request.js';

const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const supportsModelCeiling = model => Number.isSafeInteger(model?.generation?.maxTokens) && model.generation.maxTokens > 0;
function projectResult(request, result, providerId, providerIdentity) {
  const { model, threadId, attemptId } = request;
  requireValue(providerId && result.model === model.id && result.modelIdentity === model.identity
    && same(result.adapterIdentities || [], partitionAdapterIdentities(model)), 'Whole-model result identity changed');
  const completion = readWorkGenerationCompletion(result);
  requireValue(completion, 'Whole-model completion metadata missing');
  return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
    adapterIdentities: partitionAdapterIdentities(model), content: result.content, ownerPolicyDigest: result.ownerPolicyDigest ?? null,
    usage: { schema: 'raw-model-tokens/v1', inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount },
    execution: { placement: 'peer-whole-request', providerId, completion, providerIdentity: providerIdentity ?? null,
      receipt: result.executionReceipt ?? null, stopReason: completion.stopReason, hardware: result.hardware ?? null, timing: result.timing ?? null } };
}

export function createWholeModelRequester({ mesh, models }) {
  models = structuredClone(models);
  const pending = new Map();
  const getModels = () => projectChatCatalog({ models, peers: mesh.getSwarmSnapshot().peers || [], partitionModels: [] })
    .filter(model => !model.partition && model.availability === 'ready')
    // The mesh's current protocol enforces only the model's prepared generation ceiling.
    .map(model => structuredClone({ ...model, textGeneration: supportsModelCeiling(model) ? TEXT_GENERATION_CAPABILITY : undefined }));
  return Object.freeze({
    getModels,
    async authorize(dispatch) {
      const item = pending.get(dispatch.requestContext?.id);
      if (dispatch.action !== 'mesh.dispatch' || !item) return false;
      const { request, requested, controls } = item, { model, threadId, attemptId } = request;
      controls.signal.throwIfAborted();
      requireValue(dispatch.modelId === model.id && dispatch.modelIdentity === model.identity
        && same(dispatch.adapterIdentities, partitionAdapterIdentities(model)) && same(dispatch.messages, request.messages),
      'Whole-model disclosure differs from the admitted request');
      requireValue(typeof dispatch.peerId === 'string' && dispatch.peerId, 'Whole-model recipient missing');
      const recipient = typeof dispatch.recipientIdentity === 'string' && dispatch.recipientIdentity ? dispatch.recipientIdentity : dispatch.peerId;
      const approved = await controls.requestApproval(structuredClone({ threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: partitionAdapterIdentities(model), providerId: dispatch.peerId, recipients: [recipient],
        requestId: dispatch.requestId, recipientIdentity: dispatch.recipientIdentity,
        input: { messages: request.messages, ...(requested ? { generationRequest: requested } : {}) } }));
      controls.signal.throwIfAborted();
      if (approved === true) { item.providerId = dispatch.peerId; item.providerIdentity = dispatch.recipientIdentity; }
      return approved === true;
    },
    async generate(request, controls) {
      requireValue(!request.model.partition, 'Whole-model requester cannot execute a partition route');
      if (request.generationRequest !== undefined && !supportsModelCeiling(request.model)) {
        throw Error('Whole-model caller token limits are not supported by this mesh protocol');
      }
      const requested = generationRequest(request.generationRequest);
      requireValue(!requested || requested.maxOutputTokens >= request.model.generation.maxTokens,
        'Whole-model caller token limits below the prepared model ceiling are not supported by this mesh protocol');
      requireValue(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit whole-model disclosure and cancellation required');
      request = structuredClone(request);
      const { model, threadId, attemptId } = request;
      requireValue(getModels().some(candidate => candidate.id === model.id && candidate.identity === model.identity
        && same(partitionAdapterIdentities(candidate), partitionAdapterIdentities(model))), 'No ready whole-model provider for the exact variant');
      const id = randomUUID(), item = { request, requested, controls, providerId: null }; pending.set(id, item);
      let sequence = 0;
      try {
        const result = await mesh.generate(request.messages, text => {
          controls.signal.throwIfAborted();
          requireValue(item.providerId, 'Whole-model output preceded disclosure');
          controls.onDelta?.({ threadId, attemptId, sequence: sequence++, text });
        }, { signal: controls.signal, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: partitionAdapterIdentities(model), requestContext: { id, recoverable: true } });
        controls.signal.throwIfAborted();
        const projected = projectResult(request, result, item.providerId, item.providerIdentity);
        if (requested) tokenUsage(projected.usage.inputTokens, projected.usage.outputTokens, requested);
        return projected;
      } finally { pending.delete(id); }
    },
    async recover(request, reference, controls) {
      requireValue(controls?.signal && reference?.providerIdentity, 'Bound recovery and cancellation required');
      const { signal } = controls;
      signal.throwIfAborted();
      request = structuredClone(request);
      reference = structuredClone(reference);
      // Keep the acceptance binding private from caller edits and transport callbacks.
      const outcome = await mesh.recoverGeneration({ ...reference, modelId: request.model.id, modelIdentity: request.model.identity,
        adapterIdentities: partitionAdapterIdentities(request.model) }, structuredClone(request.messages), signal);
      signal.throwIfAborted();
      return outcome.status === 'completed' ? { status: 'completed', result: projectResult(request, outcome.response,
        reference.providerId, reference.providerIdentity) } : outcome;
    }
  });
}
