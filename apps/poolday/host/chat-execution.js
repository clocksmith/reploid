import { requestExecutionPolicy, assertAvailableExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute, sameExecutionBinding, executionError } from '../../../shared/vendor/reploid/chat/index.js';
import { currentPartitionRoute } from './partition-release.js';
/** Adapt identified chat attempts to existing execution ports; own only the scheduler we create. */
import { createChatScheduler, remoteDisclosureKind } from '../../../shared/vendor/reploid/chat/index.js';
import { createWorkResidentProvider } from '../providers/work-resident-provider.js';
import { createWorkAdapterResolver } from '../providers/work-adapter.js';
import { generateOnPeer } from '../providers/peer-inference.js';
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

export function createChatExecution({ localExecution = true, service, swarm, partitions, scheduler, models, getModels, profile, earning = null, fleet = null, resolveLocalSource, isCached = () => false, onChange = () => {}, policy = executionPolicy }) {
  const limits = structuredClone(policy);
  assert(limits && Object.keys(limits).length === 2
    && Number.isSafeInteger(limits.defaultOutputTokens) && limits.defaultOutputTokens > 0
    && Number.isSafeInteger(limits.maxOutputTokens) && limits.maxOutputTokens >= limits.defaultOutputTokens,
  'Invalid chat execution token policy');
  Object.freeze(limits);
  let local = null;
  // The same routing execute() applies: partitions always leave this device; local scope or a ready local copy stays.
  const runsHere = (model, sharingScope, location = 'auto') => localExecution && !model.partition && location !== 'network'
    && (location === 'local' || sharingScope === 'local' || isCached(model) || (local?.ready && local.modelIdentity === model.identity));
  const resolveAdapter = createWorkAdapterResolver({ models });
  // Threads keep a model selection without its load options (chat/workspace.js); loading reads them from the catalog.
  const withLoadOptions = model => {
    const known = [...(getModels?.() || []), ...(models || [])].find(item => item.id === model.id && item.identity === model.identity && item.loadOptions);
    return known && !model.loadOptions ? { ...model, loadOptions: structuredClone(known.loadOptions) } : model;
  };

  const sessionScheduler = scheduler || createChatScheduler({
    open: async reqModel => {
      const resident = createWorkResidentProvider({ service, model: withLoadOptions(reqModel),
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
    assert(localExecution || (request.privacy.placement !== 'local-only' && request.permissions?.executionLocation !== 'local'
      && request.permissions?.sharingScope !== 'local'), 'This deployment answers on network computers only. Nothing was run on this device.');
    assert(model.provider === 'doppler', 'Chat requires a Doppler participant');
    // Only this device's scheduler applies a per-request limit here. Elsewhere it would be dropped without notice.
    const staysHere = !model.fleet && !model.partition && (request.privacy.placement === 'local-only'
      || runsHere(model, request.permissions?.sharingScope, request.permissions?.executionLocation));
    assert(request.maxOutputTokens === undefined || staysHere, 'This route cannot apply an output limit. Nothing was sent.');
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
      return chatResult(request, result, { provider: 'doppler', placement: 'local-webgpu' });
    }

    assert(swarm?.generate, 'No connected participant can execute this model');
    let approvedProviderId = null;
    state('queued', null);
    // This port runs inside the conversation's reploid/inference run, so it calls the internal peer binding directly.
    const result = await generateOnPeer({
      swarm, model, privacy: request.privacy, messages: request.messages, signal: controls.signal, contextId: threadId,
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
      },
      onPartial: text => controls.onDelta({ threadId, attemptId, sequence: sequence++, text }),
      onProgress: () => state('queued', null)
    });
    const execution = result.peerId
      ? { provider: 'peer', placement: 'peer-whole-request', peerId: result.peerId }
      : { provider: 'doppler', placement: 'local-webgpu' };
    assert(privacyBinding, 'Remote execution has no validated privacy binding');
    return chatResult(request, result, execution);
  };

  /**
   * The route `execute` would take for this request, described without sending anything: the inference API's
   * resolveRoute port. It follows the same branches as `execute`, which still enforces each of them.
   */
  const resolveRoute = async (request, { model: pin, policy }) => {
    const unavailable = message => executionError('EXECUTION_ROUTE_UNAVAILABLE', `${message} Nothing was sent.`);
    const { model } = request;
    if (model?.id !== pin.id || model.identity !== pin.identity
      || JSON.stringify((model.adapters || []).map(adapter => adapter.identity)) !== JSON.stringify(pin.adapterIdentities)) {
      throw unavailable('The prepared model differs from the conversation model.');
    }
    const location = request.permissions?.executionLocation ?? 'auto', scope = request.permissions?.sharingScope;
    if (model.fleet) {
      if (!fleet?.describeRoute) throw unavailable('Private computers are not connected.');
      return fleet.describeRoute({ ...request, privacy: policy });
    }
    if (model.partition) {
      if (policy.placement === 'local-only' || location === 'local' || scope === 'local') throw unavailable('This model requires network execution.');
      const partition = model.partition;
      const stages = partition.route?.stages?.map(stage => stage.participantId) ?? [partition.participantA, partition.participantB];
      return { shape: 'split', backend: 'doppler-partition-plaintext/v1', participants: [...new Set(stages)], selection: 'all',
        planIdentity: partition.planId ?? null };
    }
    if (policy.placement === 'local-only' || runsHere(model, scope, location)) {
      if (!localExecution) throw unavailable('This deployment answers on network computers only.');
      return { shape: 'local', backend: 'doppler-plaintext/v1' };
    }
    if (policy.recipients.kind === 'named') return { shape: 'remote', backend: 'doppler-plaintext/v1', participants: [...policy.recipients.ids], selection: 'one-of' };
    return { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible' };
  };

  let closing = null;
  return Object.freeze({
    execute,
    resolveRoute,
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
