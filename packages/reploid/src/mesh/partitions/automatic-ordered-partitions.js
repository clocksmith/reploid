import { createPartitionDiscovery } from './partition-discovery.js';
import { selectPartitionRoute, selectPartitionExecution } from './partition-placement.js';
import { createPartitionPeer } from './partition-peer.js';
import { createPartitionEntry } from './partition-entry.js';
import { summarizePartitionExecution } from './partition-summary.js';
import { createPartitionChat } from './partition-chat.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from './partition-grants.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalPartitionRoute, validatePartitionRoute } from './partition-contract.js';

const equal = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
/** Explicit prepared-stage mode of automatic participation. Geometry and local
 * allocation identity come from the host; discovery cannot assign either. */
export function createAutomaticOrderedPartitions({ identity, meshId, models, policy, peers, createNetwork,
  loadProgram, ordered, onChange = () => {} }) {
  const config = structuredClone(policy), catalog = structuredClone(models), options = structuredClone(ordered);
  const stage = options.stage ?? null;
  assert(identity?.peerId && typeof peers === 'function' && typeof createNetwork === 'function' && typeof loadProgram === 'function'
    && ['pollMs', 'maxPeers', 'connectTimeoutMs', 'grantMs', 'maxStageOffersPerPeer'].every(key => Number.isSafeInteger(config[key]) && config[key] > 0)
    && ['maxRouteBytes', 'maxSelectionSteps', 'maxRoutes'].every(key => Number.isSafeInteger(options[key]) && options[key] > 0),
  'Explicit ordered participation policy required');
  assert(stage === null || Number.isSafeInteger(stage.index) && stage.index >= 0 && stage.participantId === identity.peerId
    && ['transportId', 'residentId', 'executionId'].every(key => typeof stage[key] === 'string' && stage[key].length > 0),
  'Actual local stage identity required');
  const closedOwners = new WeakSet();
  const lifetime = new AbortController(), listeners = new Set(), admissions = new Map(), routes = new Map(), debt = new Set();
  const authority = createPartitionGrantAuthority({ identity, meshId, maxGrants: config.limits.maxAttempts,
    maxTtlMs: config.grantMs, maxClockSkewMs: config.grantClockSkewMs });
  let offer = null, program = null, execution = null, controller = null, loading = null, ticking = null;
  let phase = 'idle', error = null, progress = null, decision = null, currentKey = null, closed = false, stopping = null, closing = null;
  let discovery, entries;
  const current = () => routes.get(currentKey);
  const getModels = () => [...discovery.getModels(), ...(offer && phase === 'ready' ? current()?.chat.getModels() || [] : [])]
    .filter(model => model.partition?.schema === 'reploid.partition-selection/v2' && !model.canonical);
  const getState = () => ({ phase, error, progress: structuredClone(progress), offering: !!offer, modelId: offer?.id ?? null,
    placement: current()?.route.stages.map(row => row.participantId) ?? null, placementDecision: structuredClone(decision),
    capabilities: discovery.getSnapshot(), descriptor: program?.resident.getState().descriptor ?? null,
    reservations: program?.resident.getState().reservations ?? null, acquisition: program?.getReceipt?.() ?? null,
    models: getModels(), attempts: [...routes.values()].flatMap(row => row.chat.getState().attempts), unsettledOwners: debt.size });
  const notify = () => { onChange(getState()); for (const listener of listeners) listener(getModels()); };
  const residentCapacity = () => program ? (({ active, availableSlots, closed }) => ({ active, availableSlots, closed }))(
    program.resident.getState().reservations) : { active: 0, availableSlots: 0, closed: true };
  function describe() {
    const state = program?.resident.getState(), descriptor = state?.descriptor;
    const inventory = descriptor ? [{ id: program.model.id, name: program.model.name, identity: program.model.identity, index: stage.index, planId: program.planId,
      residentId: stage.residentId, executionId: stage.executionId,
      activation: program.runtime.getPartitionActivationContract(program.plan), availability: offer && phase === 'ready' && state.ready ? 'ready' : 'unavailable' }] : [];
    // A stage offer is never a complete entry. Only the currently prepared chat
    // adds the full route selection; other active routes keep their own owners.
    const entry = current()?.chat.getModels()[0];
    if (inventory.length && entry && offer && phase === 'ready') inventory[0] = { ...inventory[0], ...entry };
    return { schema: 'reploid.partition-capability/v2', participantId: identity.peerId,
      phase, models: inventory, capacity: residentCapacity() };
  }
  const service = {
    getModels: () => offer && !closed && phase === 'ready' ? [...routes.values()].flatMap(row => row.chat.getModels()) : [],
    async refresh({ signal } = {}) { await tick(); await current()?.chat.refresh({ signal }); },
    generate(request, controls) {
      const key = canonicalPartitionJson(request.model.partition.route), owner = routes.get(key);
      assert(owner && offer && !closed && !stopping, 'Ordered input owner unavailable');
      return owner.chat.generate(request, controls);
    }
  };
  entries = createNetwork({ label: 'reploid-partitions-input', maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => createPartitionEntry({ channel, localParticipantId: identity.peerId,
      remoteParticipantId, service, ordered: true, limits: config.inputChannel, inputLimits: config.inputLimits,
      authorize: async input => {
        if (input.requesterId === identity.peerId) return equal(admissions.get(input.attemptId) ?? null, input);
        if (!offer || stopping || stage?.index !== 0 || input.requesterId !== remoteParticipantId || input.coordinatorId !== identity.peerId) return false;
        const owner = routes.get(canonicalPartitionJson(input.route));
        return !!owner && input.modelIdentity === program?.model.identity && input.planId === program?.planId;
      } }) });
  discovery = createPartitionDiscovery({ identity, catalog, policy: config, peers, createNetwork, describe, onChange: notify });
  async function closeOwner(owner) {
    if (closedOwners.has(owner)) { debt.delete(owner); return; }
    debt.add(owner); await owner.close(); debt.delete(owner); closedOwners.add(owner);
  }
  async function retire() {
    // Chat settles its private attempts before channels and shared weights retire.
    const chats = [...routes.values()].map(row => row.chat);
    const settled = await Promise.allSettled(chats.map(closeOwner));
    if (settled.some(row => row.status === 'rejected')) throw new AggregateError(settled.filter(row => row.status === 'rejected').map(row => row.reason), 'Ordered chat settlement failed');
    routes.clear(); currentKey = null;
    if (execution) { await closeOwner(execution); execution = null; }
    if (program) { await closeOwner(program.resident); program = null; }
    for (const owner of [...debt]) await closeOwner(owner);
  }
  async function prepare() {
    const selected = offer, preparationOwners = new Set();
    let candidate = null;
    phase = 'loading'; notify();
    loading = Promise.resolve().then(() => loadProgram(selected, stage.index, {
      signal: AbortSignal.any([lifetime.signal, controller.signal]), participantId: identity.peerId, ordered: { stage: structuredClone(stage) },
      registerCleanup(owner) { assert(typeof owner?.close === 'function', 'Preparation cleanup owner required'); preparationOwners.add(owner); return () => preparationOwners.delete(owner); },
      onProgress(value) { progress = value; notify(); }
    }));
    try {
      candidate = await loading;
      assert(candidate?.resident && typeof candidate.resident.getState === 'function'
        && typeof candidate.resident.close === 'function', 'Returned ordered resident owner required');
      const observed = candidate.resident.getState();
      assert(candidate.resident.id === stage.participantId && candidate.resident.index === stage.index && candidate.model.id === selected.id && candidate.model.identity === selected.identity
        && observed.ready && observed.descriptor.schema === 'doppler.resident-partition/v2'
        && observed.descriptor.planId === candidate.planId && candidate.plan.stageCount === observed.descriptor.stageCount
        && ['transportId', 'residentId', 'executionId'].every(key => candidate.resident[key] === stage[key]), 'Loaded ordered stage identity mismatch');
      program = candidate;
      preparationOwners.clear(); // Validated handoff transfers loading ownership to the resident.
      if (closed || offer !== selected || stopping) return;
      execution = createNetwork({ label: 'reploid-partitions-ordered', maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
        ordered: { maxRouteBytes: options.maxRouteBytes, async validateRoute(route, context) {
          if (!offer || stopping || closed || !program) return false;
          try {
            const checked = await validatePartitionRoute(program.runtime, program.plan, route), local = checked.stages[stage.index];
            if (!equal(local, stage) || checked.modelIdentity !== program.model.identity) return false;
            return context.incoming ? stage.index > 0 && checked.stages[0].participantId === context.remoteParticipantId
              && checked.stages[0].transportId === context.remoteTransportId
              : stage.index === 0 && checked.stages.some(row => row.index > 0 && row.participantId === context.remoteParticipantId && row.transportId === context.remoteTransportId);
          } catch { return false; }
        } },
        createEndpoint: ({ channel, remoteParticipantId, remoteTransportId, route }) => {
          const index = stage.index || route.stages.find(row => row.participantId === remoteParticipantId && row.transportId === remoteTransportId)?.index;
          return createPartitionPeer({ channel, localParticipantId: identity.peerId, remoteParticipantId, runtime: program.runtime,
            plan: program.plan, planId: program.planId, modelIdentity: program.model.identity, authority,
            contributor: stage.index > 0 ? program.resident : null, limits: config.executionChannel, receiverLimits: config.receiver,
            ordered: { route, partitionIndex: index } });
        } });
      phase = 'ready'; progress = null;
    } catch (cause) {
      for (const owner of preparationOwners) debt.add(owner);
      if (typeof candidate?.resident?.close === 'function') debt.add(candidate.resident);
      phase = 'failed'; error = cause.message;
    } finally { loading = null; notify(); }
  }
  async function reconcile() {
    if (!offer || !program || stage.index !== 0 || stopping || closed || phase !== 'ready') return;
    const existing = current();
    if (existing && existing.ports.every(port => port.getState().ready)) {
      // Discovery/signaling loss does not terminate a still-authorized healthy channel.
      decision = { route: existing.route, reason: 'retain-prepared-route' }; return;
    }
    for (const [key, owner] of routes) {
      const state = owner.chat.getState();
      if (owner.ports.every(port => port.getState().ready) || state.active || state.pendingInputs) continue;
      await closeOwner(owner.chat);
      for (const row of owner.route.stages.slice(1)) await execution.retire(row.transportId, { route: owner.route });
      routes.delete(key); if (currentKey === key) currentKey = null;
    }
    if (routes.size >= options.maxRoutes) return;
    const now = Date.now(), local = { participantId: identity.peerId, transportId: stage.transportId, available: true,
      observedAt: now, expiresAt: now + config.inputLimits.descriptorTtlMs, description: describe() };
    const remote = discovery.getSnapshot().filter(peer => peer.participantId !== identity.peerId).map(peer => ({ ...peer,
      description: peer.description && { ...peer.description, models: (peer.description.models || []).filter(model => model.index !== 0) } }));
    decision = await selectPartitionRoute({ runtime: program.runtime, plan: program.plan, model: program.model,
      capabilities: [local, ...remote].slice(0, config.maxPeers), now,
      limits: { maxPeers: config.maxPeers, maxStages: config.limits.maxStages, maxOffersPerPeer: config.maxStageOffersPerPeer, maxSelectionSteps: options.maxSelectionSteps } });
    if (!decision.route) return;
    const route = decision.route, key = canonicalPartitionJson(route);
    if (routes.has(key)) { currentKey = key; return; }
    const ports = [];
    try {
      for (const row of route.stages.slice(1)) ports.push(await execution.connect(row.transportId, { route }));
      assert(offer && !stopping && !closed, 'Contribution stopped while opening route');
      const chat = createPartitionChat({ runtime: program.runtime, model: program.model, authority, plan: program.plan,
        planId: program.planId, limits: config.limits, grantTtlMs: config.grantMs,
        ordered: { route, stages: [program.resident, ...ports] }, authorizeRequester: async () => !!offer && !closed && !stopping });
      routes.set(key, { route, ports, chat });
      await chat.refresh({ signal: controller.signal }); currentKey = key; notify();
    } catch (cause) {
      // Network owns even a rejected or unacknowledged opening until explicit settlement.
      if (!routes.has(key)) {
        const cleanup = await Promise.allSettled(route.stages.slice(1).map(row => execution.retire(row.transportId, { route })));
        const failures = cleanup.filter(row => row.status === 'rejected').map(row => row.reason);
        if (failures.length) { debt.add(execution); throw new AggregateError([cause, ...failures], 'Ordered route opening and settlement failed'); }
      }
      throw cause;
    }
  }
  async function tick() {
    if (closed) return;
    if (ticking) return ticking;
    ticking = (async () => { await discovery.refresh(); await reconcile(); notify(); })();
    try { await ticking; } catch (cause) { error = cause.message; notify(); }
    finally { ticking = null; }
  }
  const localEntry = {
    id: identity.peerId,
    async refresh({ signal } = {}) {
      await service.refresh({ signal });
      return { ready: !!offer && !stopping && phase === 'ready', descriptor: { models: service.getModels() } };
    },
    async generate(input, { signal, onDelta }) {
      assert(equal(admissions.get(input.attemptId), input), 'Local ordered input is not approved');
      const model = service.getModels().find(row => equal(row.partition?.route, input.route) && row.availability === 'ready');
      assert(model, 'Approved local ordered route unavailable');
      const result = await service.generate({ meshId, participantId: identity.peerId, threadId: input.threadId,
        attemptId: input.attemptId, placementGeneration: input.placementGeneration, disclosureExpiresAt: input.disclosureExpiresAt, model, messages: structuredClone(input.messages),
        permissions: { sharingScope: 'approved-partition-path' } }, { signal,
        requestApproval: async () => equal(admissions.get(input.attemptId), input), onDelta: event => onDelta?.(event.text) });
      return { content: result.content, execution: summarizePartitionExecution(result.execution) };
    }
  };
  async function refreshed(entry, transportId, model, signal) {
    let state;
    try { state = await entry.refresh({ signal }); }
    catch (cause) { if (!signal?.aborted && entry !== localEntry) discovery.invalidateModel(transportId, model); throw cause; }
    const selected = state.descriptor?.models.find(row => row.id === model.id && row.identity === model.identity
      && row.availability === 'ready' && row.partition?.schema === 'reploid.partition-selection/v2');
    if (!state.ready || !selected) discovery.invalidateModel(transportId, model);
    return { state, model: selected };
  }
  const timer = setInterval(tick, config.pollMs);
  return Object.freeze({ getState, getModels,
    subscribe(listener) { listeners.add(listener); listener(getModels()); return () => listeners.delete(listener); },
    async contribute(modelId, approved) {
      assert(approved === true && stage && !closed, 'Approve an explicitly assigned stage before contributing');
      assert(!offer && !stopping && !debt.size && !program, 'Previous ordered contribution must settle before replacement');
      offer = catalog.find(model => model.id === modelId); assert(offer, 'No pinned ordered model');
      controller = new AbortController(); phase = 'waiting'; error = null;
      await prepare(); if (offer && !stopping && phase === 'ready') await tick();
    },
    stop() {
      if (stopping) return stopping;
      offer = null; phase = 'stopping'; controller?.abort(new Error('Ordered contribution stopped')); notify();
      const wait = [loading, ticking];
      stopping = Promise.resolve().then(async () => {
        await Promise.allSettled(wait);
        try { await retire(); phase = 'idle'; error = null; progress = null; }
        catch (cause) { phase = 'failed'; error = cause.message; throw cause; }
        finally { notify(); }
      }).finally(() => { stopping = null; });
      return stopping;
    },
    async generate(request, controls) {
      request = structuredClone(request);
      assert(!closed && request.canonical === undefined && controls.publication === undefined, 'Ordered automatic entry requires ordinary execution');
      const signal = controls.signal ? AbortSignal.any([lifetime.signal, controls.signal]) : lifetime.signal;
      signal.throwIfAborted();
      const observed = discovery.getSnapshot();
      if (offer && stage?.index === 0 && current()) observed.unshift({ participantId: identity.peerId, transportId: stage.transportId,
        available: true, description: describe() });
      const selected = selectPartitionExecution({ model: request.model, capabilities: observed, ordered: true });
      assert(selected.transportId, 'No prepared ordered entry available');
      const entry = selected.transportId === stage?.transportId ? localEntry : await entries.connect(selected.transportId);
      const initial = await refreshed(entry, selected.transportId, request.model, signal), model = structuredClone(initial.model);
      assert(initial.state.ready && model, 'Prepared ordered entry unavailable');
      const route = canonicalPartitionRoute(model.partition.route), identityBinding = { schema: 'reploid.partition-attempt/v2', route,
        requesterId: identity.peerId, threadId: request.threadId, attemptId: request.attemptId, placementGeneration: request.placementGeneration ?? 0 };
      const disclosure = orderedPartitionDisclosure(identityBinding), expiresAt = Date.now() + config.grantMs;
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
        operation: 'generate-partition', peerId: route.stages[0].participantId, recipientIdentity: route.stages[0].participantId,
        ...structuredClone(model.partition), modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], disclosure, expiresAt,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      signal.throwIfAborted(); assert(approved === true && Date.now() < expiresAt, 'Ordered disclosure declined or expired');
      const checked = await refreshed(entry, selected.transportId, model, signal);
      assert(checked.state.ready && checked.model && equal(checked.model.partition, model.partition), 'Approved ordered route changed; review a new attempt');
      signal.throwIfAborted(); assert(Date.now() < expiresAt, 'Ordered disclosure expired');
      const input = { schema: 'reploid.partition-input/v3', operation: 'generate', meshId, requesterId: identity.peerId,
        coordinatorId: route.stages[0].participantId, route, modelId: model.id, modelIdentity: model.identity, planId: route.planId,
        threadId: request.threadId, attemptId: request.attemptId, placementGeneration: identityBinding.placementGeneration, disclosureExpiresAt: expiresAt, messages: request.messages };
      assert(!admissions.has(input.attemptId), 'Ordered requester attempt already admitted'); admissions.set(input.attemptId, structuredClone(input));
      let sequence = 0;
      try {
        controls.onState?.({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity: identityBinding } });
        const result = await entry.generate(input, { signal, onDelta: text => controls.onDelta?.({ threadId: request.threadId,
          attemptId: request.attemptId, sequence: sequence++, text }) });
        return { ...result, threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: [], execution: { ...result.execution, selection: selected } };
      } finally { admissions.delete(input.attemptId); }
    },
    close() {
      if (closing) return closing;
      closed = true; clearInterval(timer); lifetime.abort(new Error('Ordered mesh closed'));
      closing = (async () => {
        const stopped = await Promise.allSettled([this.stop()]);
        const independent = await Promise.allSettled([closeOwner(entries), closeOwner(discovery)]);
        const failures = [...stopped, ...independent].filter(row => row.status === 'rejected').map(row => row.reason);
        if (failures.length) throw new AggregateError(failures, 'Ordered automatic cleanup remains unsettled');
        authority.close(); listeners.clear(); admissions.clear();
      })().catch(cause => { closing = null; throw cause; });
      return closing;
    }
  });
}
