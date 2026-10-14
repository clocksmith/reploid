import { generationRequest, requireGenerationCapability } from './partition-generation-request.js';
import { createPartitionDiscovery } from './partition-discovery.js';
import { selectPartitionRoute, selectPartitionExecution, eligiblePartitionStages } from './partition-placement.js';
import { createRouteObservations, rankPartitionRoutes, preferRoute } from './partition-route-ranking.js';
import { ORDERED_PARTITION_CHANNEL } from './partition-route-network.js';
import { createPartitionPeer } from './partition-peer.js';
import { createPartitionEntry } from './partition-entry.js';
import { createEntryPublicationScope, entryPublicationPort } from './partition-entry-publication.js';
import { ORDERED_PUBLICATION_CONTEXT_SCHEMA } from './partition-ordered-publication.js';
import { summarizePartitionExecution } from './partition-summary.js';
import { createPartitionChat } from './partition-chat.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from './partition-grants.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalPartitionRoute, validatePartitionRoute, PARTITION_ROUTE_SCHEMA } from './partition-contract.js';
import { planStageAssignment, STAGE_ASSIGNMENT_SCHEMA } from './partition-stage-assignment.js';
import { createDeviceAdmission } from './partition-device-admission.js';

const equal = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
/** Explicit prepared-stage mode of automatic participation. Geometry and local
 * allocation identity come from the host; discovery cannot assign either. Launch 3
 * mechanisms run only under an explicit `ordered.orchestration` member: with
 * `autoStage`, the operator's auto choice lets this contributor's own policy pick
 * its stage from observed offers and move only while idle; with `routeRanking`,
 * a coordinator ranks complete routes by measured phases for new attempts only;
 * with `admission`, every resident this owner prepares charges one device budget,
 * optionally behind a fair bounded queue. */
export function createAutomaticOrderedPartitions({ identity, meshId, models, policy, peers, createNetwork,
  loadProgram, ordered, onChange = () => {} }) {
  const config = structuredClone(policy), catalog = structuredClone(models), options = structuredClone(ordered);
  let stage = options.stage ?? null;
  const orchestration = options.orchestration ?? null, auto = orchestration?.autoStage ?? null;
  const ranking = orchestration?.routeRanking ?? null, admission = orchestration?.admission ?? null;
  assert(identity?.peerId && typeof peers === 'function' && typeof createNetwork === 'function' && typeof loadProgram === 'function'
    && ['pollMs', 'maxPeers', 'connectTimeoutMs', 'grantMs', 'maxStageOffersPerPeer'].every(key => Number.isSafeInteger(config[key]) && config[key] > 0)
    && ['maxRouteBytes', 'maxSelectionSteps', 'maxRoutes'].every(key => Number.isSafeInteger(options[key]) && options[key] > 0),
  'Explicit ordered participation policy required');
  assert(stage === null || Number.isSafeInteger(stage.index) && stage.index >= 0 && stage.participantId === identity.peerId
    && ['transportId', 'residentId', 'executionId'].every(key => typeof stage[key] === 'string' && stage[key].length > 0),
  'Actual local stage identity required');
  assert(orchestration === null || orchestration && typeof orchestration === 'object' && !Array.isArray(orchestration)
    && Object.keys(orchestration).every(key => ['autoStage', 'routeRanking', 'admission'].includes(key)), 'Unknown ordered orchestration policy');
  assert(auto === null || stage === null && typeof auto.transportId === 'string' && auto.transportId.length > 0
    && Number.isSafeInteger(auto.dwellMs) && auto.dwellMs >= 0, 'Automatic stage assignment requires an authenticated transport and explicit dwell');
  assert(ranking === null || typeof ranking.margin === 'number' && ranking.margin >= 0 && ranking.margin < 1
    && Number.isSafeInteger(ranking.workload?.promptTokens) && ranking.workload.promptTokens > 0
    && Number.isSafeInteger(ranking.workload.expectedTokens) && ranking.workload.expectedTokens > 0,
  'Measured route preference requires an explicit margin and workload');
  // Bounded, smoothed per (plan, participant, stage) costs from attempts this coordinator completed.
  const observations = ranking ? createRouteObservations({ maxEntries: ranking.maxObservations, smoothing: ranking.smoothing }) : null;
  assert(admission === null || Number.isSafeInteger(admission.attemptBytes) && admission.attemptBytes > 0,
    'Shared device admission requires an explicit attempt allocation');
  // One owner prepares at most one resident at a time on this host's device; moves reuse this budget.
  const device = admission ? createDeviceAdmission(admission) : null;
  const closedOwners = new WeakSet();
  const lifetime = new AbortController(), listeners = new Set(), admissions = new Map(), routes = new Map(), debt = new Set();
  const authority = createPartitionGrantAuthority({ identity, meshId, maxGrants: config.limits.maxAttempts,
    maxTtlMs: config.grantMs, maxClockSkewMs: config.grantClockSkewMs });
  let offer = null, program = null, execution = null, controller = null, loading = null, ticking = null;
  let phase = 'idle', error = null, progress = null, decision = null, currentKey = null, closed = false, stopping = null, closing = null;
  let moving = null, readyAt = 0, assignment = null;
  let discovery, entries;
  // Receipts whose cleanup stayed unknown outlive their retired route, bounded
  // by the attempt budget; retiring a route never turns them into settlement.
  const unknownAttempts = [];
  const current = () => routes.get(currentKey);
  const getModels = () => [...discovery.getModels(), ...(offer && phase === 'ready' ? current()?.chat.getModels() || [] : [])]
    .filter(model => model.partition?.schema === 'reploid.partition-selection/v2' && !model.canonical);
  const getState = () => ({ phase, error, progress: structuredClone(progress), offering: !!offer, modelId: offer?.id ?? null,
    placement: current()?.route.stages.map(row => row.participantId) ?? null, placementDecision: structuredClone(decision),
    capabilities: discovery.getSnapshot(), descriptor: program?.resident.getState().descriptor ?? null,
    reservations: program?.resident.getState().reservations ?? null, acquisition: program?.getReceipt?.() ?? null,
    models: getModels(), attempts: [...routes.values()].flatMap(row => row.chat.getState().attempts), unsettledOwners: debt.size,
    unknownAttempts: structuredClone(unknownAttempts), ...(auto ? { assignment: structuredClone(assignment) } : {}),
    ...(ranking ? { routeObservations: observations.snapshot() } : {}) });
  const notify = () => { onChange(getState()); for (const listener of listeners) listener(getModels()); };
  // A bounded device queue is advertised with capacity; it is present only when configured.
  const residentCapacity = () => program ? (({ active, availableSlots, closed, device: shared }) => ({ active, availableSlots, closed,
    ...(shared?.maxQueued === undefined ? {} : { queued: shared.queued, maxQueued: shared.maxQueued }) }))(
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
      phase, models: inventory, capacity: residentCapacity(),
      ...(auto && offer ? { assignment: { schema: STAGE_ASSIGNMENT_SCHEMA, modelId: offer.id, modelIdentity: offer.identity,
        index: stage?.index ?? null } } : {}) };
  }
  // With ranking, the preferred route is listed first so entry refreshes resolve new attempts to it.
  const routeOwners = () => ranking && current() ? [current(), ...[...routes.values()].filter(row => row !== current())] : [...routes.values()];
  const observe = (route, result) => {
    try {
      observations.record({ planId: route.planId, route, phases: summarizePartitionExecution(result.execution).stepSummary?.phases, at: Date.now() });
    } catch { /* A malformed execution summary is not a measurement. */ }
  };
  const service = {
    getModels: () => offer && !closed && phase === 'ready' ? routeOwners().flatMap(row => row.chat.getModels()) : [],
    async refresh({ signal } = {}) { await tick(); await current()?.chat.refresh({ signal }); },
    generate(request, controls) {
      const key = canonicalPartitionJson(request.model.partition.route), owner = routes.get(key);
      assert(owner && offer && !closed && !stopping && !moving, 'Ordered input owner unavailable');
      const running = owner.chat.generate(request, controls);
      // Only completed attempts become observations; failures and cancellations are not costs.
      return observations ? running.then(result => { observe(owner.route, result); return result; }) : running;
    }
  };
  entries = createNetwork({ label: 'reploid-partitions-input', maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => createPartitionEntry({ channel, localParticipantId: identity.peerId,
      remoteParticipantId, service, ordered: true, limits: config.inputChannel, inputLimits: config.inputLimits,
      authorize: async input => {
        if (input.requesterId === identity.peerId) return equal(admissions.get(input.attemptId) ?? null, input);
        if (!offer || stopping || moving || stage?.index !== 0 || input.requesterId !== remoteParticipantId || input.coordinatorId !== identity.peerId) return false;
        const owner = routes.get(canonicalPartitionJson(input.route));
        return !!owner && input.modelIdentity === program?.model.identity && input.planId === program?.planId;
      } }) });
  discovery = createPartitionDiscovery({ identity, catalog, policy: config, peers, createNetwork, describe, onChange: notify });
  async function closeOwner(owner) {
    if (closedOwners.has(owner)) { debt.delete(owner); return; }
    debt.add(owner); await owner.close(); debt.delete(owner); closedOwners.add(owner);
  }
  async function closeChat(chat) {
    await closeOwner(chat);
    for (const receipt of chat.getState().attempts.filter(row => row.phase === 'cleanup-failed')) {
      if (unknownAttempts.some(row => row.identity.attemptId === receipt.identity.attemptId)) continue;
      unknownAttempts.push(receipt); if (unknownAttempts.length > config.limits.maxAttempts) unknownAttempts.shift();
    }
  }
  async function retire() {
    // Chat settles its private attempts before channels and shared weights retire.
    const chats = [...routes.values()].map(row => row.chat);
    const settled = await Promise.allSettled(chats.map(closeChat));
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
      ...(device ? { device, attemptBytes: admission.attemptBytes } : {}),
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
      execution = createNetwork({ label: ORDERED_PARTITION_CHANNEL, maxPeers: config.maxPeers, timeoutMs: config.connectTimeoutMs,
        ordered: { maxRouteBytes: options.maxRouteBytes, async validateRoute(route, context) {
          if (!offer || stopping || moving || closed || !program) return false;
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
      phase = 'ready'; progress = null; readyAt = Date.now();
    } catch (cause) {
      for (const owner of preparationOwners) debt.add(owner);
      if (typeof candidate?.resident?.close === 'function') debt.add(candidate.resident);
      phase = 'failed'; error = cause.message;
    } finally { loading = null; notify(); }
  }
  const healthy = owner => owner.ports.every(port => port.getState().ready);
  /** Opt-in: rank complete admissible routes by measured cost; peer id only breaks ties. */
  async function rankedRoute(selection, existing) {
    const eligible = await eligiblePartitionStages(selection);
    if (eligible.candidates.some(rows => !rows.length)) return selectPartitionRoute(selection);
    const capacity = new Map(selection.capabilities.map(peer => [peer.participantId, peer.description?.capacity ?? null]));
    let ranked;
    try {
      ranked = rankPartitionRoutes({ planId: eligible.planId, observations,
        candidates: eligible.candidates.map(rows => rows.map(row => ({ ...row, capacity: structuredClone(capacity.get(row.participantId)) }))),
        workload: { ...ranking.workload, allocationBytes: 0 },
        // Every enumerated route stays listed so the current one is always found if admissible.
        limits: { maxParticipants: config.maxPeers, maxRoutes: options.maxSelectionSteps, maxSelectionSteps: options.maxSelectionSteps } });
    } catch {
      return existing ? { route: existing.route, reason: 'retain-prepared-route', ranking: 'work-limit' }
        : { ...await selectPartitionRoute(selection), ranking: 'work-limit' };
    }
    const chat = existing?.chat.getState();
    const chosen = preferRoute({ current: existing && healthy(existing) ? existing.route : null, ranked,
      active: !!(chat?.active || chat?.pendingInputs), margin: ranking.margin });
    if (!chosen) return { route: null, reason: 'no-admissible-route' };
    if (existing && chosen === existing.route) return { route: existing.route, reason: 'retain-ranked-route' };
    const route = await validatePartitionRoute(program.runtime, program.plan, { schema: PARTITION_ROUTE_SCHEMA,
      modelId: eligible.model.id, modelIdentity: eligible.model.identity, planId: eligible.planId, activation: eligible.activation,
      stages: chosen.stages.map(({ index, participantId, transportId, residentId, executionId }) => ({ index, participantId, transportId, residentId, executionId })) });
    return { route, reason: 'ranked-route', measured: chosen.measured, cost: chosen.cost };
  }
  async function reconcile() {
    if (!offer || !program || stage.index !== 0 || stopping || closed || phase !== 'ready') return;
    const existing = current();
    if (!ranking && existing && healthy(existing)) {
      // Discovery/signaling loss does not terminate a still-authorized healthy channel.
      decision = { route: existing.route, reason: 'retain-prepared-route' }; return;
    }
    for (const [key, owner] of routes) {
      const state = owner.chat.getState();
      // With ranking, a healthy route that is no longer preferred retires once its own attempts finish.
      if (healthy(owner) && (!ranking || key === currentKey) || state.active || state.pendingInputs) continue;
      await closeChat(owner.chat);
      for (const row of owner.route.stages.slice(1)) await execution.retire(row.transportId, { route: owner.route });
      routes.delete(key); if (currentKey === key) currentKey = null;
    }
    if (!ranking && routes.size >= options.maxRoutes) return;
    const now = Date.now(), local = { participantId: identity.peerId, transportId: stage.transportId, available: true,
      observedAt: now, expiresAt: now + config.inputLimits.descriptorTtlMs, description: describe() };
    const remote = discovery.getSnapshot().filter(peer => peer.participantId !== identity.peerId).map(peer => ({ ...peer,
      description: peer.description && { ...peer.description, models: (peer.description.models || []).filter(model => model.index !== 0) } }));
    const selection = { runtime: program.runtime, plan: program.plan, model: program.model,
      capabilities: [local, ...remote].slice(0, config.maxPeers), now,
      limits: { maxPeers: config.maxPeers, maxStages: config.limits.maxStages, maxOffersPerPeer: config.maxStageOffersPerPeer, maxSelectionSteps: options.maxSelectionSteps } };
    const kept = existing && healthy(existing) ? existing : null;
    decision = ranking ? await rankedRoute(selection, kept) : await selectPartitionRoute(selection);
    if (!decision.route) { if (kept) decision = { ...decision, route: kept.route }; return; }
    const route = decision.route, key = canonicalPartitionJson(route);
    if (routes.has(key)) { currentKey = key; return; }
    if (ranking && routes.size >= options.maxRoutes) { decision = { ...decision, route: kept?.route ?? null, reason: 'route-limit' }; return; }
    const ports = [];
    try {
      for (const row of route.stages.slice(1)) ports.push(await execution.connect(row.transportId, { route }));
      assert(offer && !stopping && !closed, 'Contribution stopped while opening route');
      const chat = createPartitionChat({ runtime: program.runtime, model: program.model, authority, plan: program.plan,
        planId: program.planId, limits: config.limits, grantTtlMs: config.grantMs,
        ordered: { route, stages: [program.resident, ...ports] }, authorizeRequester: async () => !!offer && !closed && !stopping && !moving });
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
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  // Fresh allocation labels per preparation; participant and transport come from the host binding.
  const autoIdentity = index => ({ index, participantId: identity.peerId, transportId: auto.transportId,
    residentId: 'auto-' + hex(), executionId: 'auto-' + hex() });
  const plan = current => planStageAssignment({ participantId: identity.peerId, model: offer, stageCount: offer.partitionPlan.stageCount,
    capabilities: discovery.getSnapshot(), now: Date.now(), current, maxOffersPerPeer: config.maxStageOffersPerPeer });
  // Idle: no admitted, queued, pending or unsettled attempt on this resident or any of its routes.
  function idle() {
    const state = program.resident.getState();
    return !(state.activeAttempts > 0) && !(state.reservations?.active > 0) && !debt.size
      && [...routes.values()].every(row => { const chat = row.chat.getState();
        return !chat.active && !chat.unsettled && !chat.pendingInputs && !chat.unsettledInputs; });
  }
  async function reassess() {
    if (!auto || !offer || !program || phase !== 'ready' || stopping || closed || moving
      || Date.now() - readyAt < auto.dwellMs || !idle()) return;
    const next = plan(stage.index);
    assignment = { ...next, decidedAt: Date.now() };
    if (!next.move) return;
    // Synchronously refuse new admissions before any await; nothing is active to move.
    moving = (async () => program.resident.drain?.())().catch(() => {});
    phase = 'stopping'; notify();
    try {
      await retire();
      if (!offer || stopping || closed) return;
      stage = autoIdentity(next.index); await prepare();
    } catch (cause) { phase = 'failed'; error = cause.message; }
    finally { moving = null; notify(); }
  }
  async function tick() {
    if (closed) return;
    if (ticking) return ticking;
    ticking = (async () => { await discovery.refresh(); await reassess(); await reconcile(); notify(); })();
    try { await ticking; } catch (cause) { error = cause.message; notify(); }
    finally { ticking = null; }
  }
  const localEntry = {
    id: identity.peerId,
    async refresh({ signal } = {}) {
      await service.refresh({ signal });
      return { ready: !!offer && !stopping && !moving && phase === 'ready', descriptor: { models: service.getModels() } };
    },
    async generate(input, { signal, onDelta, onUsage, onActivity, publication, onPublished }) {
      assert(equal(admissions.get(input.attemptId), input), 'Local ordered input is not approved');
      assert((publication !== undefined) === (input.publication !== undefined), 'Local ordered publication requires its requester context');
      const model = service.getModels().find(row => equal(row.partition?.route, input.route) && row.availability === 'ready');
      assert(model, 'Approved local ordered route unavailable');
      // The same requester-owned scope as a remote entry, without a channel.
      const scope = publication === undefined ? null : createEntryPublicationScope({ request: input, owner: publication, onPublished,
        authorize: () => equal(admissions.get(input.attemptId), input),
        maxControlBytes: config.inputChannel?.maxControlBytes, maxOutputCharacters: config.inputLimits.maxOutputCharacters });
      let failure = null, result;
      try {
        result = await service.generate({ meshId, participantId: identity.peerId, threadId: input.threadId,
          attemptId: input.attemptId, placementGeneration: input.placementGeneration, disclosureExpiresAt: input.disclosureExpiresAt, model, messages: structuredClone(input.messages), ...(input.generationRequest ? {generationRequest: input.generationRequest} : {}),
          ...(scope ? { publication: structuredClone(input.publication) } : {}), permissions: { sharingScope: 'approved-partition-path' } }, { signal,
          ...(scope ? { publication: entryPublicationPort((method, body) => scope.call(method, body)) } : {}),
          requestApproval: async () => equal(admissions.get(input.attemptId), input), onActivity: value => onActivity?.(value), onUsage: value => onUsage?.({schema:value.schema,inputTokens:value.inputTokens,outputTokens:value.outputTokens}), onDelta: event => onDelta?.(event.text) });
        if (scope) {
          const projection = scope.getProjection();
          assert(projection.count > 0 && projection.terminal && result.content === projection.content, 'Local result differs from durable publication');
        }
      } catch (error) { failure = error; }
      try { await scope?.close({ cancel: failure !== null }); }
      catch (error) { failure = failure ? new AggregateError([failure, error], 'Local ordered execution and publication cancellation failed') : error; }
      if (failure) throw failure;
      return { content: result.content, ...(result.usage ? {usage: result.usage} : {}), execution: summarizePartitionExecution(result.execution) };
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
      assert(approved === true && (stage || auto) && !closed, 'Approve an explicitly assigned stage before contributing');
      assert(!offer && !stopping && !debt.size && !program, 'Previous ordered contribution must settle before replacement');
      offer = catalog.find(model => model.id === modelId); assert(offer, 'No pinned ordered model');
      if (auto) {
        const count = offer.partitionPlan?.stageCount;
        if (!Number.isSafeInteger(count) || count < 2 || count > config.limits.maxStages) {
          offer = null; throw new Error('Automatic stage assignment requires a declared ordered plan');
        }
      }
      controller = new AbortController(); phase = 'waiting'; error = null;
      if (auto) {
        // The contributor's own choice from what discovery observed; never a remote assignment.
        notify(); await discovery.refresh();
        if (!offer || stopping || closed) return;
        const next = plan(null);
        assignment = { ...next, decidedAt: Date.now() }; stage = autoIdentity(next.index);
      }
      await prepare(); if (offer && !stopping && phase === 'ready') await tick();
    },
    stop() {
      if (stopping) return stopping;
      offer = null; phase = 'stopping'; controller?.abort(new Error('Ordered contribution stopped')); notify();
      const wait = [loading, ticking];
      stopping = Promise.resolve().then(async () => {
        await Promise.allSettled(wait);
        try { await retire(); phase = 'idle'; error = null; progress = null; if (auto) { stage = null; assignment = null; } }
        catch (cause) { phase = 'failed'; error = cause.message; throw cause; }
        finally { notify(); }
      }).finally(() => { stopping = null; });
      return stopping;
    },
    async generate(request, controls) {
      request = structuredClone(request);
      const requested = generationRequest(request.generationRequest);
      assert(!requested || requested.maxOutputTokens <= config.limits.maxTokens, 'Caller token limit exceeds route budget');
      request = structuredClone(request);
      const published = controls.publication !== undefined;
      assert(!closed && request.canonical === undefined && (!published || typeof controls.onPublished === 'function'
        && /^[a-f0-9]{32}$/.test(controls.publisherEpoch)), 'Ordered automatic entry requires ordinary execution and, when publishing, the requester-owned writer');
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
      requireGenerationCapability(model, requested);
      const route = canonicalPartitionRoute(model.partition.route), identityBinding = { schema: 'reploid.partition-attempt/v2', route,
        requesterId: identity.peerId, threadId: request.threadId, attemptId: request.attemptId, placementGeneration: request.placementGeneration ?? 0 };
      const disclosure = orderedPartitionDisclosure(identityBinding), expiresAt = Date.now() + config.grantMs;
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
        operation: 'generate-partition', peerId: route.stages[0].participantId, recipientIdentity: route.stages[0].participantId,
        ...structuredClone(model.partition), modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], disclosure, expiresAt,
        input: { messages: structuredClone(request.messages), ...(requested ? {generationRequest: requested} : {}), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      signal.throwIfAborted(); assert(approved === true && Date.now() < expiresAt, 'Ordered disclosure declined or expired');
      const checked = await refreshed(entry, selected.transportId, model, signal);
      assert(checked.state.ready && checked.model && equal(checked.model.partition, model.partition), 'Approved ordered route changed; review a new attempt');
      signal.throwIfAborted(); assert(Date.now() < expiresAt, 'Ordered disclosure expired');
      const input = { schema: 'reploid.partition-input/v3', operation: 'generate', meshId, requesterId: identity.peerId,
        coordinatorId: route.stages[0].participantId, route, modelId: model.id, modelIdentity: model.identity, planId: route.planId,
        ...(controls.onActivity ? {activity:'reploid.partition-activity/v1'} : {}),
        threadId: request.threadId, attemptId: request.attemptId, placementGeneration: identityBinding.placementGeneration, disclosureExpiresAt: expiresAt, messages: request.messages, ...(requested ? {generationRequest: requested} : {}),
        ...(published ? { publication: { schema: ORDERED_PUBLICATION_CONTEXT_SCHEMA, publisherEpoch: controls.publisherEpoch, deadlineAt: expiresAt } } : {}) };
      assert(!admissions.has(input.attemptId), 'Ordered requester attempt already admitted'); admissions.set(input.attemptId, structuredClone(input));
      let sequence = 0;
      try {
        controls.onState?.({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity: identityBinding } });
        const result = await entry.generate(input, { signal, ...(published ? { publication: controls.publication, onPublished: controls.onPublished } : {}),
          ...(controls.onActivity ? {onActivity: activity => controls.onActivity({threadId:request.threadId,attemptId:request.attemptId,...activity})} : {}), onUsage: usage => controls.onUsage?.({threadId: request.threadId, attemptId: request.attemptId, ...usage}), onDelta: text => controls.onDelta?.({ threadId: request.threadId,
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
