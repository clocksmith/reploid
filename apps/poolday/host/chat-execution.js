import { requestExecutionPolicy, assertAvailableExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute, sameExecutionBinding, executionPrivacyReceipt } from '../../../shared/vendor/reploid/chat/index.js';
import { currentPartitionRoute } from './partition-release.js';
/** Adapt identified chat attempts to existing execution ports; own only the scheduler we create. */
import { createChatScheduler, remoteDisclosureKind } from '../../../shared/vendor/reploid/chat/index.js';
import { createWorkResidentProvider } from '../providers/work-resident-provider.js';
import { createWorkAdapterResolver } from '../providers/work-adapter.js';
import { createWorkNetworkProvider } from '../providers/work-network-provider.js';
import { readWorkGenerationCompletion } from '../providers/work-generation-completion.js';
import executionPolicy from '../config/chat-execution-policy.json' with { type: 'json' };
import { publicProviderHardware } from '../../../shared/vendor/reploid/mesh/provider-hardware.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** The same chat result envelope for local and whole-request peer execution. */
function chatResult({ threadId, attemptId }, result, placement) {
  const completion = readWorkGenerationCompletion(result);
  return { threadId, attemptId, modelId: result.model, modelIdentity: result.modelIdentity,
    adapterIdentities: result.adapterIdentities, content: result.content,
    execution: { ...placement, modelId: result.model, modelIdentity: result.modelIdentity,
      adapterIdentities: result.adapterIdentities, completion, stopReason: completion?.stopReason ?? null,
      ...(result.executionReceipt ? { executionReceipt: structuredClone(result.executionReceipt) } : {}),
      timing: result.timing ?? null, hardware: publicProviderHardware(result.hardware) } };
}

export function createChatExecution({ service, swarm, partitions, scheduler, models, getModels, profile, earning = null, fleet = null, resolveLocalSource, isCached = () => false, onChange = () => {}, policy = executionPolicy }) {
  const limits = structuredClone(policy);
  assert(limits && Object.keys(limits).length === 2
    && Number.isSafeInteger(limits.defaultOutputTokens) && limits.defaultOutputTokens > 0
    && Number.isSafeInteger(limits.maxOutputTokens) && limits.maxOutputTokens >= limits.defaultOutputTokens,
  'Invalid chat execution token policy');
  Object.freeze(limits);
  let local = null;
  // The same routing execute() applies: partitions always leave this device; local scope or a ready local copy stays.
  const runsHere = (model, sharingScope, location = 'auto') => !model.partition && location !== 'network'
    && (location === 'local' || sharingScope === 'local' || isCached(model) || (local?.ready && local.modelIdentity === model.identity));
  const resolveAdapter = createWorkAdapterResolver({ models });

  const sessionScheduler = scheduler || createChatScheduler({
    open: async reqModel => {
      const resident = createWorkResidentProvider({ service, model: reqModel,
        resolveAdapter, resolveSource: resolveLocalSource, generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
        onChange(state) { local = state; onChange(); } });
      await resident.prepare();
      return {
        run: (req, { signal: runSignal, onDelta }) => resident.generate(req.messages, onDelta,
          { signal: runSignal, adapters: req.model.adapters || [], maxOutputTokens: req.maxOutputTokens,
            contextOwner: req.participantId || 'local', contextId: req.threadId, privacy: req.privacy, privacyBinding: req.privacyBinding }),
        reset: async () => assert(resident.getState().ready, 'Resident session requires replacement'),
        // The resident applies and removes adapters inside the same device lease as generation.
        setAdapters: async () => {},
        close: resident.close
      };
    },
    observe: () => {}
  });

  // Reuse the existing network provider. No simulated production responses.
  const execute = async (request, controls) => {
    request = structuredClone(request);
    request.privacy = assertAvailableExecutionPolicy(requestExecutionPolicy(request));
    controls.signal?.throwIfAborted();
    const { threadId, attemptId, model } = request;
    const originalApproval = controls.requestApproval;
    let privacyBinding = null;
    const validatePreview = async preview => {
      assert(preview.privacyBinding, 'A current execution binding is required before remote disclosure');
      const binding = await bindExecutionRoute(request, preview.privacyBinding.route);
      assert(sameExecutionBinding(binding, preview.privacyBinding), 'Execution binding differs from the approved request');
      controls.signal?.throwIfAborted();
      assert(!privacyBinding || privacyBinding.routeId === binding.routeId, 'Execution route changed; retry requires a new attempt');
      privacyBinding = binding;
      return originalApproval(preview);
    };
    controls = { ...controls, requestApproval: validatePreview };
    assert(['auto', 'local', 'network'].includes(request.permissions?.executionLocation ?? 'auto'), 'Invalid execution location');
    assert(!(request.permissions?.executionLocation === 'network' && request.privacy.placement === 'local-only'),
      'Network execution requires an explicit network execution policy');
    assert(!(model.partition && (request.permissions?.executionLocation === 'local' || request.permissions?.sharingScope === 'local')), 'This model requires network execution');
    assert(model.provider === 'doppler', 'Chat requires a Doppler participant');
    if (model.fleet) { assert(fleet, 'Private computers are not connected'); return fleet.execute(request, controls); }
    const catalogModel = getModels().find(m => m.id === model.id && m.identity === model.identity);
    assert(catalogModel, 'Selected model is not in the verified catalog');
    const allowedAdapters = catalogModel.availableAdapters || [];
    for (const adapter of model.adapters || []) {
      const verified = allowedAdapters.some(a => a.identity === adapter.identity && a.baseModelIdentity === model.identity);
      assert(verified, 'This execution path cannot apply the selected adapter');
    }
    let sequence = 0;
    const state = (status, execution) => controls.onState({ threadId, attemptId, status, execution });

    // Requester-owned history publishes through prepared canonical two-stage or ordinary ordered routes.
    if (controls.publication) assert(model.partition && (model.canonical || model.partition.schema === 'reploid.partition-selection/v2'),
      'Canonical history requires a prepared canonical or ordered partition route');

    if (model.partition) {
      assert(request.privacy.placement !== 'local-only', 'Local-only privacy excludes partition execution');
      assert(currentPartitionRoute(model, getModels()), 'Selected distributed route is unavailable or not qualified for public use');
      assert(partitions?.generate, 'Partition execution service is unavailable');
      // A configured earning client runs each partition attempt under an accepted quote and reports its route records.
      const generate = (req, ctl) => {
        assert(currentPartitionRoute(req.model, getModels()), 'Selected distributed route is unavailable or not qualified for public use');
        return partitions.generate(req, ctl);
      };
      return earning ? earning.run(request, controls, generate) : generate(request, controls);
    }

    if (request.privacy.placement === 'local-only' || runsHere(model, request.permissions?.sharingScope, request.permissions?.executionLocation)) {
      const binding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { local: true }));
      const requestedTokens = request.maxOutputTokens ?? profile.generation?.maxTokens ?? limits.defaultOutputTokens;
      assert(Number.isSafeInteger(requestedTokens) && requestedTokens > 0, 'Invalid chat output token count');
      const maxOutputTokens = Math.min(requestedTokens, limits.maxOutputTokens);
      state('queued', { provider: 'doppler', placement: 'local-webgpu' });
      const result = await sessionScheduler.schedule({
        ...request,
        privacyBinding: binding,
        maxOutputTokens
      }, {
        signal: controls.signal,
        onDelta: text => controls.onDelta({ threadId, attemptId, sequence: sequence++, text }),
        onState: status => state(status, { provider: 'doppler', placement: 'local-webgpu' })
      });
      return chatResult(request, result, { provider: 'doppler', placement: 'local-webgpu', privacy: executionPrivacyReceipt(binding) });
    }

    assert(swarm?.generate, 'No connected participant can execute this model');
    let approvedProviderId = null;
    const provider = createWorkNetworkProvider({
      model, privacy: request.privacy, service, scope: 'chat:' + attemptId, signal: controls.signal,
      swarm,
      generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
      controls: {
        async approve(preview) {
          const approved = await controls.requestApproval({ ...preview, peerId: preview.providerId, threadId, attemptId });
          if (approved === true) approvedProviderId = preview.providerId;
          return approved;
        },
        async record(record) {
          if (record.stage === 'approved') {
            assert(approvedProviderId, 'Peer execution metadata preceded disclosure approval');
            state('executing', { provider: 'peer', placement: 'peer-whole-request', peerId: approvedProviderId });
          }
        }
      },
      onProgress(progress) {
        // The network provider emits text; Doppler's loader emits progress records.
        const loading = progress !== null && typeof progress === 'object';
        const local = loading || (typeof progress === 'string' && /executing on this device/i.test(progress));
        state(local ? 'loading' : 'queued', local ? { provider: 'doppler', placement: 'local-webgpu' } : null);
      }
    });
    state('queued', null);
    const result = await provider.generate(request.messages, text => {
      controls.onDelta({ threadId, attemptId, sequence: sequence++, text });
    }, { signal: controls.signal, contextId: threadId });
    const execution = result.peerId
      ? { provider: 'peer', placement: 'peer-whole-request', peerId: result.peerId }
      : { provider: 'doppler', placement: 'local-webgpu' };
    assert(privacyBinding, 'Remote execution has no validated privacy binding');
    return chatResult(request, result, { ...execution, privacy: executionPrivacyReceipt(privacyBinding) });
  };

  let closing = null;
  return Object.freeze({
    execute,
    /** The disclosure a request for this model would make, or null when it runs on this device. */
    remoteDisclosure: (model, sharingScope, location) => model.fleet ? 'public' : runsHere(model, sharingScope, location) ? null : remoteDisclosureKind(model),
    prepareLocal: model => sessionScheduler.prepare(model),
    async unloadLocal() { assert(!scheduler, 'A borrowed scheduler cannot be unloaded here'); await sessionScheduler.unload(); local = null; onChange(); },
    getLocalState: () => local ? structuredClone(local) : null,
    getState: () => structuredClone(sessionScheduler.getState()),
    close() {
      // Injected schedulers are borrowed and may serve other conversation owners.
      closing ??= Promise.resolve().then(() => scheduler ? undefined : sessionScheduler.close()).catch(error => {
        closing = null;
        throw error;
      });
      return closing;
    }
  });
}
