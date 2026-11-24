import { assertAvailableExecutionPolicy, requestExecutionPolicy } from '../packages/reploid/src/chat/execution-policy.js';
/** Native requester projection over the same whole-model mesh used by the browser.
 * Completion counts are provider reports, not independently validated billing evidence.
 * `controls.onUsage`, when given, receives the provider's input token count before any text if the
 * provider reports one; the completion must then report the same count. */
import { randomUUID } from 'node:crypto';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { resolvePartitionGeneration } from '../apps/poolday/config/partition-generation.js';
import { projectChatCatalog } from '../apps/poolday/host/chat-view.js';
import { readWorkGenerationCompletion } from '../shared/infrastructure/generation-completion.js';
import { canonicalPartitionJson, partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';
import { TEXT_GENERATION_CAPABILITY, generationRequest, tokenUsage } from '../packages/reploid/src/mesh/partitions/partition-generation-request.js';
import { assertSettingsSupported, normalizeGenerationSettings, unionGenerationSettingsCapabilities } from '../packages/reploid/src/mesh/generation-settings.js';

const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const supportsModelCeiling = model => Number.isSafeInteger(model?.generation?.maxTokens) && model.generation.maxTokens > 0;
// Native whole-model preparation uses the Poolday generation policy when an exact catalog
// entry omits generation. An arbitrary model without its own declaration has no known bound.
function settingsOutputCeiling(model) {
  if (Object.hasOwn(model, 'generation')) return supportsModelCeiling(model) ? model.generation.maxTokens : null;
  const entry = catalog.find(row => row.id === model.id && row.identity === model.identity && !Object.hasOwn(row, 'generation'));
  return entry ? resolvePartitionGeneration(entry).maxTokens : null;
}
function projectResult(request, result, providerId, providerIdentity) {
  const { model, threadId, attemptId } = request;
  requireValue(providerId && result.model === model.id && result.modelIdentity === model.identity
    && same(result.adapterIdentities || [], partitionAdapterIdentities(model)), 'Whole-model result identity changed');
  const completion = readWorkGenerationCompletion(result);
  requireValue(completion, 'Whole-model completion metadata missing');
  const limit = request.settings?.maxOutputTokens ?? null;
  requireValue(limit === null || completion.generatedTokenCount <= limit, 'Whole-model provider exceeded the caller output limit');
  return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
    adapterIdentities: partitionAdapterIdentities(model), content: result.content, ownerPolicyDigest: result.ownerPolicyDigest ?? null,
    usage: { schema: 'raw-model-tokens/v1', inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount },
    execution: { placement: 'peer-whole-request', providerId, completion, providerIdentity: providerIdentity ?? null,
      receipt: result.executionReceipt ?? null, stopReason: completion.stopReason, hardware: result.hardware ?? null, timing: result.timing ?? null } };
}

export function createWholeModelRequester({ mesh, models }) {
  models = structuredClone(models);
  const pending = new Map();
  // A model supports a setting when at least one ready provider of that exact variant advertises it:
  // the mesh chooses only among providers whose own capability covers the settings of a request.
  const settingsCapability = (model, peers) => {
    const capability = unionGenerationSettingsCapabilities(peers.filter(peer => model.providerIds.includes(peer.peerId))
      .map(peer => peer.generationSettings));
    if (!capability) return {};
    return { generationSettings: { ...capability, maxOutputTokens: capability.maxOutputTokens && settingsOutputCeiling(model) !== null } };
  };
  const getModels = () => {
    const { peers = [], connections } = mesh.getSwarmSnapshot();
    return projectChatCatalog({ models, peers, connections })
      .map(model => ({ ...model, ...settingsCapability(model, peers),
        verifiedProviderIdentities: Object.fromEntries(peers
          .filter(peer => model.providerIds.includes(peer.peerId) && peer.identityVerified && peer.participantId)
          .map(peer => [peer.peerId, peer.participantId])) }))
      .filter(model => !model.partition && ['ready', 'busy'].includes(model.availability) && model.providerIds?.length)
      // The mesh's current protocol enforces only the model's prepared generation ceiling.
      .map(model => structuredClone({ ...model, textGeneration: supportsModelCeiling(model) ? TEXT_GENERATION_CAPABILITY : undefined }));
  };
  return Object.freeze({
    getModels,
    async authorize(dispatch) {
      const item = pending.get(dispatch.requestContext?.id);
      if (dispatch.action !== 'mesh.dispatch' || !item) return false;
      const { request, requested, controls } = item, { model, threadId, attemptId } = request;
      controls.signal.throwIfAborted();
      requireValue(dispatch.modelId === model.id && dispatch.modelIdentity === model.identity
        && same(dispatch.adapterIdentities, partitionAdapterIdentities(model)) && same(dispatch.messages, request.messages)
        && same(dispatch.settings ?? null, request.settings ?? null),
      'Whole-model disclosure differs from the admitted request');
      requireValue(typeof dispatch.peerId === 'string' && dispatch.peerId, 'Whole-model recipient missing');
      const recipient = dispatch.recipientIdentity;
      requireValue(typeof recipient === 'string' && recipient && dispatch.admission?.schema === 'reploid.generation-admission/v2'
        && same(dispatch.privacyBinding?.policy, request.privacy)
        && dispatch.privacyBinding.route?.hops?.length === 1
        && dispatch.privacyBinding.route.hops[0].recipient === recipient
        && dispatch.privacyBinding.route.hops[0].placement === 'remote', 'Verified, policy-bound whole-model disclosure required');
      const approved = await controls.requestApproval(structuredClone({ threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: partitionAdapterIdentities(model), providerId: dispatch.peerId, recipients: [recipient],
        privacyBinding: dispatch.privacyBinding, offerId: dispatch.offerId, requestId: dispatch.requestId, recipientIdentity: dispatch.recipientIdentity,
        ...(dispatch.admission ? { admission: dispatch.admission } : {}),
        input: { messages: request.messages, ...(requested ? { generationRequest: requested } : {}),
          ...(request.settings ? { settings: request.settings } : {}) } }));
      controls.signal.throwIfAborted();
      if (approved === true) { item.providerId = dispatch.peerId; item.providerIdentity = dispatch.recipientIdentity; }
      // The route this attempt was sent on, and why, for the caller's own record. Reported after approval only.
      if (approved === true) controls.onRoute?.(structuredClone({ threadId, attemptId, requestId: dispatch.requestId, providerId: dispatch.peerId,
        providerIdentity: dispatch.recipientIdentity ?? null, placement: dispatch.placement ?? null }));
      return approved === true;
    },
    async generate(request, controls) {
      requireValue(!request.model.partition, 'Whole-model requester cannot execute a partition route');
      requireValue(typeof controls?.requestApproval === 'function' && controls.signal, 'Explicit whole-model disclosure and cancellation required');
      const settings = normalizeGenerationSettings(request.settings);
      request = structuredClone(request);
      request.privacy = assertAvailableExecutionPolicy(requestExecutionPolicy(request));
      requireValue(request.privacy.placement === 'network-allowed' && request.privacy.recipients.kind !== 'none', 'Whole-model remote recipients required');
      const { model, threadId, attemptId } = request;
      const route = getModels().find(candidate => candidate.id === model.id && candidate.identity === model.identity
        && same(partitionAdapterIdentities(candidate), partitionAdapterIdentities(model)));
      requireValue(route, 'No ready whole-model provider for the exact variant');
      if (request.generationRequest !== undefined && !supportsModelCeiling(route)) {
        throw Error('Whole-model caller token limits are not supported by this mesh protocol');
      }
      const requested = generationRequest(request.generationRequest);
      // A lower limit needs a provider that applies it, which is what the same limit in the settings asks for.
      requireValue(!requested || requested.maxOutputTokens >= route.generation.maxTokens
        || settings?.maxOutputTokens === requested.maxOutputTokens,
      'Whole-model caller token limits below the prepared model ceiling are not supported by this mesh protocol');
      if (settings) {
        // Refused here, from the providers' current advertisements, before any provider is asked.
        assertSettingsSupported(route.generationSettings, settings);
        // Unlike a generationRequest ceiling, a settings limit may lower output: the provider applies it.
        const ceiling = settingsOutputCeiling(route);
        if (settings.maxOutputTokens !== null && (ceiling === null || settings.maxOutputTokens > ceiling)) {
          throw Object.assign(Error('Caller output limit exceeds the prepared model ceiling'), { status: 400, param: 'maxOutputTokens' });
        }
        request.settings = structuredClone(settings);
      }
      const id = randomUUID(), item = { request, requested, controls, providerId: null }; pending.set(id, item);
      let sequence = 0, observedInputTokens = null;
      try {
        const result = await mesh.generate(request.messages, text => {
          controls.signal.throwIfAborted();
          requireValue(item.providerId, 'Whole-model output preceded disclosure');
          controls.onDelta?.({ threadId, attemptId, sequence: sequence++, text });
        }, { signal: controls.signal, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: partitionAdapterIdentities(model), privacy: request.privacy,
          ...(settings ? { settings: request.settings } : {}),
          // Asked of the mesh only for a caller that publishes the provider's input count before its text.
          ...(typeof controls.onUsage === 'function' ? { onUsage: ({ inputTokens }) => {
            controls.signal.throwIfAborted();
            requireValue(item.providerId, 'Whole-model usage preceded disclosure');
            requireValue(observedInputTokens === null && sequence === 0 && Number.isSafeInteger(inputTokens) && inputTokens > 0,
              'Whole-model usage observation is invalid or out of order');
            observedInputTokens = inputTokens;
            return controls.onUsage({ threadId, attemptId, schema: 'raw-model-tokens/v1', inputTokens, outputTokens: 0 });
          } } : {}),
          requestContext: {
            id,
            recoverable: true,
            ...(typeof threadId === 'string' && threadId.length > 0 && threadId.length <= 256 ? { contextId: threadId } : {})
          } });
        controls.signal.throwIfAborted();
        const projected = projectResult(request, result, item.providerId, item.providerIdentity);
        // The mesh refuses this before countersigning; the caller was told the early count, so it is checked here too.
        requireValue(observedInputTokens === null || projected.usage.inputTokens === observedInputTokens,
          'Whole-model input token count differs from the provider\'s early observation');
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
        adapterIdentities: partitionAdapterIdentities(request.model) }, structuredClone(request.messages), signal,
      request.settings ? { settings: request.settings } : undefined);
      signal.throwIfAborted();
      return outcome.status === 'completed' ? { status: 'completed', result: projectResult(request, outcome.response,
        reference.providerId, reference.providerIdentity) } : outcome;
    }
  });
}
