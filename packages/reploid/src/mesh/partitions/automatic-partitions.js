import { partitionAdapterIdentities, samePartitionAdapters, selectPartitionContribution } from './partition-contract.js';
import { publicPreparationProgress, createPreparationProgressObserver } from '../preparation-progress.js';
import { generationRequest, requireGenerationCapability } from './partition-generation-request.js';
import { createAutomaticOrderedPartitions } from './automatic-ordered-partitions.js';
import { createPartitionDiscovery } from './partition-discovery.js';
import { selectPartitionPlacement, selectPartitionExecution } from './partition-placement.js';
import { createPartitionPeer } from './partition-peer.js';
import { createPartitionEntry } from './partition-entry.js';
import { createPartitionChat } from './partition-chat.js';
import { createPartitionGrantAuthority } from './partition-grants.js';
import { canonicalPartitionJson, assertPartition as assert } from './partition-contract.js';

/** Automatic placement over authenticated discovery. Only the supplied host
 * loader may open Doppler, and only after local contribution approval. */
export function createAutomaticPartitions({ identity, meshId, models, policy, peers, createNetwork,
  loadProgram, canonical = null, ordered = null, onChange = () => {} }) {
  if (ordered !== null) {
    assert(canonical === null, 'Ordered automatic participation is distinct from canonical publication');
    return createAutomaticOrderedPartitions({ identity, meshId, models, policy, peers, createNetwork, loadProgram, ordered, onChange });
  }
  const config = structuredClone(policy), catalog = structuredClone(models);
  for (const model of catalog) assert(model.partitionContributionIndexes === undefined
    || Array.isArray(model.partitionContributionIndexes) && model.partitionContributionIndexes.length > 0
      && model.partitionContributionIndexes.every(index => index === 0 || index === 1), 'Invalid eligible partition indexes');
  assert(identity?.peerId && typeof peers === 'function' && typeof createNetwork === 'function'
    && typeof loadProgram === 'function' && Number.isSafeInteger(config.pollMs) && config.pollMs > 0,
  'Automatic partitions require identity, discovery, loader and explicit policy');
  if (canonical !== null) {
    assert(canonical && /^[a-f0-9]{32}$/.test(canonical.coordinatorEpoch)
      && /^[a-f0-9]{32}$/.test(canonical.participantEpoch)
      && ['metadataDigest', 'canonicalGenerationIdentity', 'validateResidentAttemptIdentity', 'tokenDigest']
        .every(name => typeof canonical.runtime?.[name] === 'function'), 'Explicit canonical runtime and epochs required');
    canonical = { runtime: canonical.runtime, coordinatorEpoch: canonical.coordinatorEpoch, participantEpoch: canonical.participantEpoch };
  }
  const listeners = new Set(), admissions = new Map();
  const lifetime = new AbortController();
  let offer = null, program = null, execution = null, chat = null, executionPeer = null, preparing = null;
  let contributionController = null;
  let phase = 'idle', error = null, progress = null, placement = null, closed = false, ticking = null;
  let placementDecision = null, closing = null, stopping = null;
  const unsettledOwners = new Set(), settledCloseOwners = new Set();
  const authority = createPartitionGrantAuthority({ identity, meshId,
    maxGrants: config.limits.maxAttempts, maxTtlMs: config.grantMs, maxClockSkewMs: config.grantClockSkewMs, canonicalRuntime: canonical?.runtime });
  const getModels = () => discovery.getModels().filter(model => !!model.canonical === !!canonical
    && model.partition?.schema !== 'reploid.partition-selection/v2');
  const getState = () => ({ phase, error, progress: structuredClone(progress), offering: !!offer, modelId: offer?.id || null,
    placement: structuredClone(placement), placementDecision: structuredClone(placementDecision),
    capabilities: discovery.getSnapshot(), descriptor: program?.resident.getState().descriptor || null,
    acquisition: program?.getReceipt?.() || null, models: getModels(),
    reservations: program?.resident.getState().reservations || null, attempts: chat?.getState().attempts || [],
    unsettledOwners: unsettledOwners.size });
  const notify = () => { onChange(getState()); for (const listener of listeners) listener(getModels()); };
  const service = {
    getModels: () => chat?.getModels() || [],
    async refresh(options) { await tick(); return chat?.refresh(options); },
    generate: (request, controls) => {
      assert(chat && offer && !closed, 'Partition input owner unavailable');
      return chat.generate(request, controls);
    }
  };
  const entries = createNetwork({ label: 'reploid-partitions-input',
    maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => createPartitionEntry({ channel,
      localParticipantId: identity.peerId, remoteParticipantId, service, canonical: !!canonical,
      limits: config.inputChannel, inputLimits: config.inputLimits,
      async authorize(input, { action }) {
        if (input.requesterId === identity.peerId) {
          const admitted = admissions.get(input.attemptId);
          return !!admitted && canonicalPartitionJson(admitted) === canonicalPartitionJson(input);
        }
        return !!offer && program?.resident.index === 0 && !!chat
          && input.requesterId === remoteParticipantId && input.participantA === identity.peerId
          && input.participantB === placement?.[1] && input.modelIdentity === offer.identity
          && input.planId === program.planId;
      }
    }) });
  const discovery = createPartitionDiscovery({ identity, catalog, policy: config, peers, createNetwork,
    onChange: notify,
    describe: () => ({ participantId: identity.peerId, offer: offer && { id: offer.id, identity: offer.identity, adapters: offer.adapters || [] },
      eligibleIndexes: offer?.partitionContributionIndexes ?? [0, 1],
      phase, preparation: phase === 'loading' ? publicPreparationProgress(progress) : null, placement, index: program?.resident.index ?? placement?.indexOf(identity.peerId) ?? null,
      planId: program?.planId ?? null, models: chat?.getModels() || [],
      // Discovery advertises capacity only; attempt identities remain with their owners.
      capacity: program ? (({ active, availableSlots, closed }) => ({ active, availableSlots, closed }))(
        program.resident.getState().reservations) : null }) });
  async function retire() {
    for (const owner of [chat, execution, program?.resident]) if (owner) unsettledOwners.add(owner);
    const owners = [...unsettledOwners];
    chat = null; executionPeer = null; execution = null; program = null; placement = null;
    const results = await Promise.allSettled(owners.map(owner => Promise.resolve().then(() => owner?.close())));
    results.forEach((result, index) => { if (result.status === 'fulfilled') unsettledOwners.delete(owners[index]); });
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) {
      phase = 'failed';
      throw new AggregateError(failures, 'Partition contribution settlement failed');
    }
  }
  async function reconcile() {
    if (!offer || preparing || stopping || closed || phase === 'failed' || unsettledOwners.size) return;
    placementDecision = selectPartitionPlacement({ participantId: identity.peerId, offer,
      localIndex: program?.resident.index ?? null, previous: placement, capabilities: discovery.getSnapshot() });
    // Discovery expires independently of the execution channel. Existing signed
    // attempts own this route until settlement; a missing advertisement or a new
    // replica must not cancel them or change their authorized recipients.
    const reserved = program?.resident.getState().reservations.active > 0;
    const activeInput = chat && (chat.getState().active > 0 || reserved)
      && !executionPeer.getState().receipt.closed;
    // Output stages have no chat runner. Their channel/receiver owns settlement;
    // discovery cannot retire their shared resident while any state is charged.
    if (activeInput || program?.resident.index === 1 && reserved) {
      placementDecision = { ...placementDecision, participants: [...placement], reason: 'retain-active-execution' };
      return;
    }
    const selected = placementDecision.participants;
    if (selected.length !== 2) {
      await chat?.close(); chat = null; executionPeer = null;
      phase = 'waiting'; progress = { message: 'Waiting for another contributor' }; notify(); return;
    }
    if (placement && canonicalPartitionJson(placement) !== canonicalPartitionJson(selected)) {
      await chat?.close(); chat = null; executionPeer = null;
      if (program && program.resident.index !== selected.indexOf(identity.peerId)) await retire();
    }
    placement = selected;
    if (!program) {
      placement = selected; phase = 'loading'; error = null; notify();
      const selectedOffer = offer, observeProgress = createPreparationProgressObserver();
      let observingPreparation = true;
      const preparationOwners = new Set();
      preparing = Promise.resolve().then(() => loadProgram(selectedOffer, selected.indexOf(identity.peerId), {
        signal: AbortSignal.any([lifetime.signal, contributionController.signal]), participantId: identity.peerId,
        ...(canonical ? { canonical: { identity, participantEpoch: canonical.participantEpoch } } : {}),
        registerCleanup(owner) {
          assert(typeof owner?.close === 'function', 'Preparation cleanup owner must expose close');
          preparationOwners.add(owner);
          // The host releases this registration only after successful cleanup.
          // A failed opening is not itself evidence of failed resource disposal.
          return () => preparationOwners.delete(owner);
        },
        onProgress: value => { if (observingPreparation) { error = null; progress = observeProgress(value); notify(); } }
      }));
      try {
        program = await preparing;
        // A returned resident now owns successful preparation. Pending loading
        // remains stoppable; only rejected cleanup becomes unsettled ownership.
        // Stop/close own retirement after this tick settles. A late loader may
        // not retire a newer contribution or race another cleanup caller.
        if (closed || offer !== selectedOffer) return;
        execution = createNetwork({ label: 'reploid-partitions', maxPeers: config.maxPeers,
          timeoutMs: config.connectTimeoutMs,
          createEndpoint: ({ channel, remoteParticipantId }) => createPartitionPeer({ channel,
            localParticipantId: identity.peerId, remoteParticipantId, runtime: program.runtime,
            modelIdentity: program.model.identity, plan: program.plan, planId: program.planId, authority,
            canonical: !!canonical, contributor: program.resident.index === 1 ? program.resident : null, limits: config.executionChannel,
            receiverLimits: config.receiver, descriptorTtlMs: config.inputLimits.descriptorTtlMs }) });
        phase = 'ready'; progress = null; notify();
      } catch (cause) {
        for (const owner of preparationOwners) unsettledOwners.add(owner);
        phase = 'failed'; error = cause.message; notify(); throw cause;
      }
      finally { observingPreparation = false; preparing = null; }
    }
    if (program && phase === 'waiting') { phase = 'ready'; progress = null; notify(); }
    // A restarted contributor may return between discovery polls. Its identity
    // and placement stay the same, but the old execution channel is retired.
    if (chat && executionPeer.getState().receipt.closed) {
      await chat.close(); chat = null; executionPeer = null;
    }
    if (program?.resident.index === 0 && !chat) {
      const next = discovery.getSnapshot().find(peer => peer.available && peer.participantId === placement[1]
        && peer.description?.phase === 'ready' && peer.description.index === 1
        && peer.description.planId === program.planId);
      if (!next) return;
      const remote = await execution.connect(next.transportId);
      executionPeer = remote;
      chat = createPartitionChat({ runtime: program.runtime, local: program.resident, remote,
        authority, model: program.model, plan: program.plan, planId: program.planId,
        limits: config.limits, grantTtlMs: config.grantMs,
        ...(canonical ? { canonical: { coordinatorEpoch: canonical.coordinatorEpoch } } : {}),
        authorizeRequester: async () => !!offer && !closed });
      await chat.refresh({ signal: lifetime.signal }); notify();
    }
  }
  async function tick() {
    if (closed) return;
    if (ticking) return ticking;
    ticking = (async () => {
      await discovery.refresh();
      notify(); await reconcile();
    })();
    try { await ticking; } catch (cause) { if (!closed) { error = cause.message; notify(); } }
    finally { ticking = null; }
  }
  async function refreshEntry(entry, transportId, model, signal) {
    let current;
    try { current = await entry.refresh({ signal }); }
    catch (cause) { if (!signal?.aborted) discovery.invalidateModel(transportId, model); throw cause; }
    if (!current.ready || !current.descriptor.models.some(candidate => candidate.id === model.id
      && candidate.identity === model.identity && samePartitionAdapters(candidate, model) && candidate.availability === 'ready')) {
      discovery.invalidateModel(transportId, model);
    }
    return current;
  }
  const timer = setInterval(tick, config.pollMs);
  return Object.freeze({ getState, getModels,
    subscribe(listener) { listeners.add(listener); listener(getModels()); return () => listeners.delete(listener); },
    async contribute(modelId, approved, adapters) {
      assert(approved === true && !closed, 'Approve partition computation before contributing');
      assert(!stopping && !unsettledOwners.size, 'Previous contribution must settle before replacement');
      assert(!offer, 'Stop existing partition contribution first');
      const selected = catalog.find(model => model.id === modelId);
      assert(selected, 'No pinned partition model for this contribution');
      offer = selectPartitionContribution(selected, adapters);
      contributionController = new AbortController();
      phase = 'waiting'; error = null; progress = { message: 'Waiting for another contributor' }; notify(); await tick();
    },
    stop() {
      if (stopping) return stopping;
      const pendingTick = ticking;
      const operation = Promise.resolve().then(async () => {
        await pendingTick?.catch(() => {});
        try { await retire(); phase = 'idle'; error = null; progress = null; }
        catch (cause) { phase = 'failed'; error = cause.message; throw cause; }
        finally { notify(); }
      }).finally(() => { if (stopping === operation) stopping = null; });
      stopping = operation; offer = null; phase = 'stopping';
      contributionController?.abort(new Error('Partition contribution stopped')); notify();
      return operation;
    },
    async generate(request, controls) {
      request = structuredClone(request);
      const requested = generationRequest(request.generationRequest);
      assert(!requested || requested.maxOutputTokens <= config.limits.maxTokens, 'Caller token limit exceeds route budget');
      assert(!!controls.publication === !!canonical && (!canonical || typeof controls.onPublished === 'function'
        && /^[a-f0-9]{32}$/.test(controls.publisherEpoch)), 'Canonical requester requires durable publication and explicit mesh capability');
      const decision = selectPartitionExecution({ model: request.model, capabilities: discovery.getSnapshot() });
      assert(decision.transportId, 'No prepared cooperative partition path is available');
      const entry = await entries.connect(decision.transportId);
      const refreshed = await refreshEntry(entry, decision.transportId, request.model, controls.signal);
      const model = refreshed.descriptor.models.find(model => model.id === request.model.id
        && model.identity === request.model.identity && samePartitionAdapters(model, request.model) && model.availability === 'ready');
      assert(refreshed.ready && model, 'No prepared cooperative partition path is available');
      assert(!!model.canonical === !!canonical, 'Prepared route has a different publication capability');
      requireGenerationCapability(model, requested, !!canonical);
      const messages = structuredClone(request.messages);
      let expiresAt = Date.now() + config.grantMs;
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId,
        attemptId: request.attemptId, operation: 'generate-partition',
        peerId: model.partition.participantA, recipientIdentity: model.partition.participantA,
        ...model.partition, modelId: model.id, modelIdentity: model.identity,
        disclosure: 'partition-activations-and-tokens', adapterIdentities: partitionAdapterIdentities(model), expiresAt, executionTimeoutMs: config.grantMs,
        input: { messages: structuredClone(messages), ...(requested ? {generationRequest: requested} : {}), recipients: [model.partition.participantA, model.partition.participantB] } });
      assert(approved === true, 'Partition input disclosure declined'); controls.signal.throwIfAborted();
      expiresAt = Math.min(controls.authorizationExpiresAt?.() ?? expiresAt, Date.now() + config.grantMs);
      assert(Date.now() < expiresAt, 'Partition input disclosure expired');
      // Human review can outlive an availability descriptor. Refresh liveness,
      // but never transfer reviewed input to a newly selected recipient or plan.
      const current = await refreshEntry(entry, decision.transportId, model, controls.signal);
      const same = current.descriptor.models.find(candidate => candidate.id === model.id
        && candidate.identity === model.identity && samePartitionAdapters(candidate, model) && candidate.availability === 'ready'
        && canonicalPartitionJson(candidate.partition) === canonicalPartitionJson(model.partition)
        && canonicalPartitionJson(candidate.canonical ?? null) === canonicalPartitionJson(model.canonical ?? null));
      assert(current.ready && same, 'Approved partition placement changed; review a new attempt');
      assert(Date.now() < expiresAt, 'Partition input disclosure expired'); controls.signal.throwIfAborted();
      const input = { schema: canonical ? 'reploid.partition-input/v2' : 'reploid.partition-input/v1', operation: 'generate', meshId,
        requesterId: identity.peerId, ...model.partition, modelId: model.id, modelIdentity: model.identity,
        threadId: request.threadId, attemptId: request.attemptId, placementGeneration: 0,
        messages, ...(requested ? {generationRequest: requested} : {}), ...(canonical ? { canonical: { schema: 'reploid.partition-publication-context/v1',
          ...structuredClone(model.canonical), publisherEpoch: controls.publisherEpoch, deadlineAt: expiresAt } } : {}) };
      admissions.set(request.attemptId, input);
      let sequence = 0;
      controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing',
        execution: { placement: 'two-device-layer-partition', ...model.partition } });
      try {
        const result = await entry.generate(input, { signal: controls.signal,
          onUsage: usage => controls.onUsage?.({threadId: request.threadId, attemptId: request.attemptId, ...usage}),
          ...(canonical ? { publication: controls.publication, onPublished: controls.onPublished } : {}),
          onDelta: text => controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: sequence++, text }) });
        return { ...result, threadId: request.threadId, attemptId: request.attemptId,
          modelId: model.id, modelIdentity: model.identity, adapterIdentities: partitionAdapterIdentities(model),
          execution: { ...result.execution, selection: decision } };
      } finally { admissions.delete(request.attemptId); }
    },
    close() {
      if (closing) return closing;
      closed = true; clearInterval(timer); lifetime.abort(new Error('Partition mesh closed'));
      closing = (async () => {
        const results = await Promise.allSettled([...[entries, discovery].map(owner => Promise.resolve().then(async () => {
          if (!settledCloseOwners.has(owner)) { await owner.close(); settledCloseOwners.add(owner); }
        })), ticking, stopping]);
        results.push(...await Promise.allSettled([retire()]));
        authority.close(); listeners.clear(); admissions.clear();
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Partition mesh settlement failed');
      })().catch(error => { closing = null; throw error; });
      return closing;
    }
  });
}
