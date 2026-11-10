import { samePartitionAdapters } from './partition-contract.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalPartitionRoute, partitionActivationContract, validatePartitionRoute, PARTITION_ROUTE_SCHEMA, validateOrderedPartitionCapability, isOrderedPartitionEntryModel } from './partition-contract.js';
export { validateOrderedPartitionCapability, isOrderedPartitionEntryModel } from './partition-contract.js';

/** Pure selection over observed capabilities. No transport or resource ownership. */
export function selectPartitionPlacement({ participantId, offer, localIndex, previous, capabilities }) {
  const eligibility = capabilities.map(peer => ({ participantId: peer.participantId, transportId: peer.transportId,
    observedAt: peer.observedAt, expiresAt: peer.expiresAt,
    reason: !peer.available ? peer.reason : peer.description.phase === 'failed' ? 'contributor-failed'
      : peer.description.offer?.id !== offer.id || peer.description.offer?.identity !== offer.identity || !samePartitionAdapters(peer.description.offer, offer)
        ? 'model-mismatch' : 'approved-model-contribution',
    index: peer.description?.index ?? null, indexes: peer.description?.eligibleIndexes ?? [0, 1] }));
  const candidates = [{ id: participantId, index: localIndex, indexes: offer.partitionContributionIndexes ?? [0, 1] },
    ...eligibility.filter(peer => peer.reason === 'approved-model-contribution')
      .map(peer => ({ id: peer.participantId, index: peer.index, indexes: peer.indexes }))].sort((a, b) => a.id.localeCompare(b.id));
  const ids = candidates.map(peer => peer.id);
  const inputs = candidates.filter(peer => peer.indexes.includes(0));
  const outputs = candidates.filter(peer => peer.indexes.includes(1));
  if (localIndex === null && !candidates.some(peer => peer.index === 0)) {
    const awaitingInput = capabilities.some(peer => peer.available && peer.description?.index === 1
      && peer.description.offer?.id === offer.id && peer.description.offer?.identity === offer.identity
      && Array.isArray(peer.description.placement) && peer.description.placement.length === 2
      && peer.description.placement[0] !== participantId && !ids.includes(peer.description.placement[0]));
    if (awaitingInput) return { participants: [], eligibility, reason: 'await-advertised-input-owner' };
  }
  const retainedA = previous && ids.includes(previous[0])
    && inputs.find(peer => peer.id === previous[0])?.index === 0 ? previous[0] : null;
  const a = retainedA || inputs.find(peer => peer.index === 0)?.id
    || inputs.find(peer => peer.index === null)?.id || inputs[0]?.id;
  if (!a) return { participants: [], eligibility, reason: 'missing-eligible-input-contributor' };
  const b = participantId !== a ? outputs.find(peer => peer.id === participantId)?.id
    : previous?.[0] === a && outputs.some(peer => peer.id === previous[1] && peer.index === 1) ? previous[1]
      : outputs.find(peer => peer.id !== a && peer.index === 1)?.id || outputs.find(peer => peer.id !== a)?.id;
  return { participants: b ? [a, b] : [], eligibility,
    reason: !b ? 'missing-complementary-contributor' : retainedA ? 'retain-input-owner' : 'select-input-owner' };
}

/** New attempts consume availability hints; signed reservations remain authoritative.
 * Capacity changes never move an already placed conversation. An ordered coordinator whose
 * slots are full stays eligible while its advertised admission queue has room (the attempt
 * waits there); one with a free slot is preferred. */
export function selectPartitionExecution({ model, capabilities, ordered = false }) {
  const waits = new Set();
  const eligibility = capabilities.map(peer => {
    const prepared = peer.description?.models?.find(candidate => candidate.id === model.id
      && candidate.identity === model.identity && samePartitionAdapters(candidate, model) && candidate.availability === 'ready'
      && (ordered ? isOrderedPartitionEntryModel(candidate, peer)
        : peer.description?.schema !== 'reploid.partition-capability/v2'
          && candidate.partition?.schema !== 'reploid.partition-selection/v2'));
    const capacity = peer.description?.capacity, queue = ordered ? capacity?.attemptQueue : undefined;
    const queueRoom = Number.isSafeInteger(queue?.queued) && Number.isSafeInteger(queue?.maxQueued) && queue.queued < queue.maxQueued;
    const reason = !peer.available ? peer.reason : !prepared ? 'no-prepared-path'
      : capacity?.closed ? 'input-owner-at-capacity'
        : capacity?.availableSlots === 0 && !queueRoom ? (queue ? 'input-owner-queue-full' : 'input-owner-at-capacity') : 'reservation-required';
    if (reason === 'reservation-required' && capacity?.availableSlots === 0) waits.add(peer.transportId);
    return { participantId: peer.participantId, transportId: peer.transportId, reason,
      eligible: reason === 'reservation-required', capacity: structuredClone(capacity || null) };
  });
  const selected = eligibility.find(peer => peer.eligible && !waits.has(peer.transportId)) ?? eligibility.find(peer => peer.eligible);
  return { transportId: selected?.transportId ?? null, eligibility };
}

/** Eligible stage offers per index for one model plan, sorted by participant identity.
 * Shared by first-valid matching and opt-in measured ranking; grants nothing. */
export async function eligiblePartitionStages({ runtime, plan, model, capabilities, limits, now }) {
  assert(limits && ['maxStages', 'maxPeers', 'maxOffersPerPeer', 'maxSelectionSteps']
    .every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0), 'Explicit route selection limits required');
  assert(Number.isSafeInteger(now) && now >= 0 && Array.isArray(capabilities)
    && capabilities.length <= limits.maxPeers && Number.isSafeInteger(plan?.stageCount)
    && plan.stageCount >= 2 && plan.stageCount <= limits.maxStages, 'Route selection input exceeds limit');
  const planSnapshot = structuredClone(plan), modelSnapshot = structuredClone(model), peers = structuredClone(capabilities);
  const policy = { ...limits };
  const activation = partitionActivationContract(runtime, planSnapshot);
  const planId = await runtime.hashLayerPartitionPlan(planSnapshot);
  assert(modelSnapshot?.id === planSnapshot.modelId && /^sha256:[a-f0-9]{64}$/.test(modelSnapshot.identity), 'Route model mismatch');
  const candidates = Array.from({ length: planSnapshot.stageCount }, () => []), eligibility = [];
  const participants = new Set(), transports = new Set();
  for (const peer of peers) {
    assert(['participantId', 'transportId'].every(key => typeof peer[key] === 'string' && peer[key].length > 0 && peer[key].length <= 256)
      && !participants.has(peer.participantId) && !transports.has(peer.transportId), 'Duplicate or invalid route peer');
    participants.add(peer.participantId); transports.add(peer.transportId);
    let reason = null;
    if (peer.available !== true || !Number.isSafeInteger(peer.observedAt) || peer.observedAt > now || peer.observedAt < 0
      || !Number.isSafeInteger(peer.expiresAt) || peer.expiresAt <= now) reason = 'unavailable-or-expired';
    else {
      try { validateOrderedPartitionCapability(peer.description, peer.participantId, policy.maxOffersPerPeer); }
      catch { reason = 'invalid-capability'; }
    }
    if (!reason && (peer.description.phase !== 'ready' || peer.description.capacity.closed
      || peer.description.capacity.availableSlots === 0)) reason = 'contributor-unavailable';
    if (reason) { eligibility.push({ participantId: peer.participantId, index: null, eligible: false, reason }); continue; }
    for (const offer of peer.description.models) {
      const eligible = offer.id === modelSnapshot.id && offer.identity === modelSnapshot.identity
        && offer.planId === planId && offer.index < candidates.length && offer.availability === 'ready'
        && offer.activation && canonicalPartitionJson(offer.activation) === canonicalPartitionJson(activation);
      eligibility.push({ participantId: peer.participantId, index: offer.index, eligible: !!eligible,
        reason: eligible ? 'reservation-required' : 'model-plan-stage-mismatch' });
      if (eligible) candidates[offer.index].push({ index: offer.index, participantId: peer.participantId,
        transportId: peer.transportId, residentId: offer.residentId, executionId: offer.executionId });
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  candidates.forEach(rows => rows.sort((a, b) => compare(a.participantId, b.participantId)
    || compare(a.residentId, b.residentId) || compare(a.executionId, b.executionId)));
  return { plan: planSnapshot, model: modelSnapshot, planId, activation, candidates, eligibility };
}

/** Deterministic bipartite matching for new attempts only. No cost optimum or physical-device independence is inferred. */
export async function selectPartitionRoute(selection) {
  const { plan: planSnapshot, model: modelSnapshot, planId, activation, candidates, eligibility } = await eligiblePartitionStages(selection);
  const policy = { ...selection.limits };
  let selectionSteps = 0;
  const finish = (route, reason) => Object.freeze({ route, reason, selectionSteps,
    eligibility: Object.freeze(eligibility.map(Object.freeze)) });
  if (candidates.some(rows => rows.length === 0)) return finish(null, 'missing-eligible-stage');
  const assigned = new Map(), stages = Array(candidates.length).fill(null);
  // Iterative augmenting paths avoid stack depth depending on model size.
  for (let start = 0; start < stages.length; start++) {
    const queue = [start], visited = new Set(), predecessor = new Map();
    let found = null;
    for (let cursor = 0; cursor < queue.length && !found; cursor++) {
      const index = queue[cursor];
      for (const candidate of candidates[index]) {
        if (++selectionSteps > policy.maxSelectionSteps) return finish(null, 'selection-work-limit');
        if (visited.has(candidate.participantId)) continue;
        visited.add(candidate.participantId);
        const previous = assigned.get(candidate.participantId);
        if (previous === undefined) { found = { index, candidate }; break; }
        if (!predecessor.has(previous) && previous !== start) {
          predecessor.set(previous, { index, candidate }); queue.push(previous);
        }
      }
    }
    if (!found) return finish(null, 'insufficient-distinct-participants');
    while (found) {
      stages[found.index] = found.candidate; assigned.set(found.candidate.participantId, found.index);
      found = predecessor.get(found.index);
    }
  }
  const route = await validatePartitionRoute(selection.runtime, planSnapshot, { schema: PARTITION_ROUTE_SCHEMA,
    modelId: modelSnapshot.id, modelIdentity: modelSnapshot.identity, planId, stages, activation });
  return finish(route, 'reservation-required');
}
