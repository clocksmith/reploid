import { assertPartition as assert, validateOrderedPartitionCapability } from './partition-contract.js';

/** A contributor's own claim while it chooses or prepares a stage. A hint, never an assignment. */
export const STAGE_ASSIGNMENT_SCHEMA = 'reploid.stage-assignment/v1';
/** A ranking coordinator's measured decode cost per stage of its current route. A hint, never an assignment. */
export const STAGE_COSTS_SCHEMA = 'reploid.stage-costs/v1';

const matchesPlan = (model, planId) => typeof model.partitionPlanId === 'string' && model.partitionPlanId === planId;

// Complete matching matters when a small device cannot prepare every stage.
// Iterative augmenting paths keep stack depth independent of the peer count.
function matchStageJoiners(joiners, missing) {
  const owners = new Map(), selected = new Map();
  for (const id of [...joiners.keys()].sort().reverse()) {
    const queue = [id], parents = new Map([[id, null]]);
    let found = null;
    for (let cursor = 0; cursor < queue.length && !found; cursor++) {
      const candidate = queue[cursor];
      for (const index of missing) {
        if (!joiners.get(candidate).includes(index)) continue;
        const owner = owners.get(index);
        if (owner === undefined) { found = { id: candidate, index }; break; }
        if (!parents.has(owner)) { parents.set(owner, candidate); queue.push(owner); }
      }
    }
    while (found) {
      const previous = selected.get(found.id), parent = parents.get(found.id);
      selected.set(found.id, found.index); owners.set(found.index, found.id);
      found = parent === null ? null : { id: parent, index: previous };
    }
  }
  return selected.size === missing.length ? selected : null;
}

const observedPeers = (capabilities, now, maxOffersPerPeer) => capabilities.filter(peer => {
  if (peer?.available !== true || !(peer.expiresAt > now)) return false;
  try { validateOrderedPartitionCapability(peer.description, peer.participantId, maxOffersPerPeer); return true; } catch { return false; }
});

/** Opt-in replica demand from observed discovery: a stage whose advertised queue exceeds `queueBound`,
 * else the stage a ranking coordinator measured at least `bottleneckRatio` times slower than every
 * other stage. Returns the one stage that would gain most from another replica, or none. */
export function stageDemand({ model, stageCount, capabilities, now, maxOffersPerPeer, queueBound, bottleneckRatio }) {
  assert(Number.isSafeInteger(queueBound) && queueBound >= 0 && typeof bottleneckRatio === 'number' && bottleneckRatio > 1,
    'Explicit replica demand bounds required');
  const peers = observedPeers(capabilities, now, maxOffersPerPeer), queued = Array(stageCount).fill(0);
  for (const peer of peers) {
    const waiting = peer.description.capacity.queued;
    if (peer.description.phase !== 'ready' || !Number.isSafeInteger(waiting) || waiting < 0) continue;
    for (const offer of peer.description.models) if (offer.id === model.id && offer.identity === model.identity && matchesPlan(model, offer.planId)
      && offer.availability === 'ready' && Number.isSafeInteger(offer.index) && offer.index < stageCount) {
      queued[offer.index] = Math.max(queued[offer.index], waiting);
    }
  }
  const busiest = queued.reduce((best, value, index) => value > queued[best] ? index : best, 0);
  if (queued[busiest] > queueBound) return Object.freeze({ index: busiest, reason: 'queue', queued: Object.freeze(queued) });
  // Coordinators are read in participant-id order so every observer resolves the same claim.
  for (const peer of [...peers].sort((a, b) => a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0)) {
    const costs = peer.description.stageCosts, decode = costs?.decodeMs;
    if (costs?.schema !== STAGE_COSTS_SCHEMA || costs.modelId !== model.id || costs.modelIdentity !== model.identity || !matchesPlan(model, costs.planId)
      || !Array.isArray(decode) || decode.length !== stageCount || !decode.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) continue;
    const slowest = decode.reduce((best, value, index) => value > decode[best] ? index : best, 0);
    const next = Math.max(...decode.filter((_, index) => index !== slowest));
    if (decode[slowest] > 0 && decode[slowest] >= bottleneckRatio * next) {
      return Object.freeze({ index: slowest, reason: 'bottleneck', queued: Object.freeze(queued) });
    }
  }
  return Object.freeze({ index: null, reason: null, queued: Object.freeze(queued) });
}

/** Launch 3, opt-in. An operator's `auto` choice authorizes this participant's own policy to pick
 * its stage from observed discovery. Discovery grants nothing, and nothing here assigns another
 * participant. Supply counts distinct participants: ready offers plus auto claims of peers
 * still preparing. Unassigned auto peers are joiners. The caller re-evaluates only while idle. */
export function planStageAssignment({ participantId, model, stageCount, capabilities, now, current = null,
  maxOffersPerPeer, demand = null, eligibleIndexes = null }) {
  assert(typeof participantId === 'string' && participantId.length > 0 && typeof model?.id === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(model.identity) && typeof model.partitionPlanId === 'string' && model.partitionPlanId.length > 0 && Number.isSafeInteger(stageCount) && stageCount >= 2
    && Array.isArray(capabilities) && Number.isSafeInteger(now) && Number.isSafeInteger(maxOffersPerPeer)
    && (current === null || Number.isSafeInteger(current) && current >= 0 && current < stageCount),
  'Explicit stage assignment input required');
  const stageIndex = value => Number.isSafeInteger(value) && value >= 0 && value < stageCount;
  const validIndexes = values => Array.isArray(values) && values.length <= stageCount
    && values.every(stageIndex) && new Set(values).size === values.length;
  assert(eligibleIndexes === null || validIndexes(eligibleIndexes), 'Invalid eligible stage indexes');
  const indexes = eligibleIndexes ?? Array.from({ length: stageCount }, (_, index) => index);
  const wanted = demand && indexes.includes(demand.index) ? demand.index : null;
  const supply = Array.from({ length: stageCount }, () => new Set()), joiners = new Map();
  let replicaPreparing = false;
  for (const peer of capabilities) {
    if (peer?.participantId === participantId || peer?.available !== true || !(peer.expiresAt > now)) continue;
    const description = peer.description;
    try { validateOrderedPartitionCapability(description, peer.participantId, maxOffersPerPeer); } catch { continue; }
    if (description.phase === 'ready') for (const offer of description.models) {
      if (offer.id === model.id && offer.identity === model.identity && matchesPlan(model, offer.planId) && offer.availability === 'ready'
        && stageIndex(offer.index)) supply[offer.index].add(peer.participantId);
    }
    const claim = description.assignment;
    if (claim?.schema === STAGE_ASSIGNMENT_SCHEMA && claim.modelId === model.id && claim.modelIdentity === model.identity && matchesPlan(model, claim.planId)
      && ['waiting', 'loading', 'ready'].includes(description.phase)) {
      if (claim.eligibleIndexes !== undefined && !validIndexes(claim.eligibleIndexes)) continue;
      if (claim.index === null) joiners.set(peer.participantId, claim.eligibleIndexes ?? Array.from({ length: stageCount }, (_, index) => index));
      else if (stageIndex(claim.index)) {
        supply[claim.index].add(peer.participantId);
        if (claim.index === wanted && description.phase !== 'ready') replicaPreparing = true;
      }
    }
  }
  for (const id of joiners.keys()) if (supply.some(set => set.has(id))) joiners.delete(id);
  const counts = supply.map(set => set.size);
  // Least supplied; ties go to the lowest index so every observer orders stages alike.
  const least = (rows, skip = -1) => rows.reduce((best, count, index) =>
    index !== skip && indexes.includes(index) && (best < 0 || count < rows[best]) ? index : best, -1);
  const decide = (index, reason) => Object.freeze({ index, reason, move: current !== null && index !== current,
    supply: Object.freeze([...counts]), joiners: joiners.size });
  // A replica is useful only once every stage has a supplier: completing a route comes first.
  const replicate = wanted !== null && counts.every(count => count > 0);
  if (current === null) {
    if (!indexes.length) return decide(null, 'no-eligible-stage');
    // Preparation consumes the owner's resources. Wait until observed suppliers
    // and willing joiners can cover a route; excess joiners remain unprepared.
    const missing = counts.flatMap((count, index) => count === 0 ? [index] : []);
    const rank = [participantId, ...joiners.keys()].sort().indexOf(participantId);
    if (missing.length > joiners.size + 1) return decide(null, 'waiting-for-route');
    if (indexes.length !== stageCount || [...joiners.values()].some(values => values.length !== stageCount)) {
      const matched = matchStageJoiners(new Map([...joiners, [participantId, indexes]]), missing);
      if (!matched) return decide(null, 'waiting-for-route');
      if (matched.has(participantId)) return decide(matched.get(participantId), 'cold-least-supplied');
    } else if (rank < missing.length) return decide(missing[rank], 'cold-least-supplied');
    // One joiner addresses the observed demand. An in-flight replica already
    // addresses that observation; wait for fresh demand after it becomes ready.
    const replicaRank = [participantId, ...[...joiners].filter(([, values]) => values.includes(wanted)).map(([id]) => id)].sort().indexOf(participantId);
    if (replicate && replicaRank === 0 && !replicaPreparing) return decide(wanted, 'replicate-' + demand.reason);
    return decide(null, 'no-useful-assignment');
  }
  // Hysteresis: move only when this stage has at least two more contributors than the least
  // supplied one, no joiner is about to fill the gap, and only its highest participant id moves.
  const others = supply[current], target = least(counts, current);
  const highest = [participantId, ...others].sort().at(-1) === participantId;
  if (joiners.size || !highest || target < 0) return decide(current, 'retain');
  // Leave for a demanded stage only while another contributor keeps this stage supplied.
  if (replicate && wanted !== current && others.size >= 1) return decide(wanted, 'replicate-' + demand.reason);
  if (others.size < counts[target] + 1) return decide(current, 'retain');
  return decide(target, 'rebalance');
}
