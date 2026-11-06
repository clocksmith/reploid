/** Native requester projection over the same whole-model mesh used by the browser.
 * Completion counts are provider reports, not independently validated billing evidence. */
import { randomUUID } from 'node:crypto';
import { projectChatCatalog } from '../apps/poolday/host/chat-view.js';
import { readWorkGenerationCompletion } from '../apps/poolday/providers/work-generation-completion.js';
import { canonicalPartitionJson, partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';

const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);

export function createWholeModelRequester({ mesh, models }) {
  models = structuredClone(models);
  const pending = new Map();
  const getModels = () => projectChatCatalog({ models, peers: mesh.getSwarmSnapshot().peers || [], partitionModels: [] })
    .filter(model => !model.partition && model.availability === 'ready')
    // The mesh's current protocol has no caller-selected output ceiling.
    .map(model => structuredClone({ ...model, textGeneration: undefined }));
  return Object.freeze({
    getModels,
    async authorize(dispatch) {
      const item = pending.get(dispatch.requestContext?.id);
      if (dispatch.action !== 'mesh.dispatch' || !item) return false;
      const { request, controls } = item, { model, threadId, attemptId } = request;
      controls.signal.throwIfAborted();
      requireValue(dispatch.modelId === model.id && dispatch.modelIdentity === model.identity
        && same(dispatch.adapterIdentities, partitionAdapterIdentities(model)) && same(dispatch.messages, request.messages),
      'Whole-model disclosure differs from the admitted request');
      requireValue(typeof dispatch.peerId === 'string' && dispatch.peerId, 'Whole-model recipient missing');
      const approved = await controls.requestApproval(structuredClone({ threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: partitionAdapterIdentities(model), providerId: dispatch.peerId, recipients: [dispatch.peerId],
        recipientIdentity: dispatch.recipientIdentity, input: { messages: request.messages } }));
      controls.signal.throwIfAborted();
      if (approved === true) item.providerId = dispatch.peerId;
      return approved === true;
    },
    async generate(request, controls) {
      requireValue(!request.model.partition && !request.generationRequest, 'Whole-model caller token limits are not supported by this mesh protocol');
      requireValue(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit whole-model disclosure and cancellation required');
      request = structuredClone(request);
      const { model, threadId, attemptId } = request;
      requireValue(getModels().some(candidate => candidate.id === model.id && candidate.identity === model.identity
        && same(partitionAdapterIdentities(candidate), partitionAdapterIdentities(model))), 'No ready whole-model provider for the exact variant');
      const id = randomUUID(), item = { request, controls, providerId: null }; pending.set(id, item);
      let sequence = 0;
      try {
        const result = await mesh.generate(request.messages, text => {
          controls.signal.throwIfAborted();
          requireValue(item.providerId, 'Whole-model output preceded disclosure');
          controls.onDelta?.({ threadId, attemptId, sequence: sequence++, text });
        }, { signal: controls.signal, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: partitionAdapterIdentities(model), requestContext: { id } });
        controls.signal.throwIfAborted();
        requireValue(item.providerId && result.model === model.id && result.modelIdentity === model.identity
          && same(result.adapterIdentities || [], partitionAdapterIdentities(model)), 'Whole-model result identity changed');
        const completion = readWorkGenerationCompletion(result);
        requireValue(completion, 'Whole-model completion metadata missing');
        return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: partitionAdapterIdentities(model), content: result.content,
          usage: { schema: 'raw-model-tokens/v1', inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount },
          execution: { placement: 'peer-whole-request', providerId: item.providerId, completion,
            stopReason: completion.stopReason, hardware: result.hardware ?? null, timing: result.timing ?? null } };
      } finally { pending.delete(id); }
    }
  });
}
