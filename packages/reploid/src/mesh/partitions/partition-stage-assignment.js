import { assertPartition as assert, validateOrderedPartitionCapability } from './partition-contract.js';

/** A contributor's own claim while it chooses or prepares a stage. A hint, never an assignment. */
export const STAGE_ASSIGNMENT_SCHEMA = 'reploid.stage-assignment/v1';

/** Launch 3, opt-in. An operator's `auto` choice authorizes this participant's own policy to pick
 * its stage from observed discovery. Discovery grants nothing, and nothing here assigns another
 * participant. Supply counts distinct participants: ready offers plus auto claims of peers
 * still preparing. Unassigned auto peers are joiners. The caller re-evaluates only while idle. */
export function planStageAssignment({ participantId, model, stageCount, capabilities, now, current = null,
  maxOffersPerPeer }) {
  assert(typeof participantId === 'string' && participantId.length > 0 && typeof model?.id === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(model.identity) && Number.isSafeInteger(stageCount) && stageCount >= 2
    && Array.isArray(capabilities) && Number.isSafeInteger(now) && Number.isSafeInteger(maxOffersPerPeer)
    && (current === null || Number.isSafeInteger(current) && current >= 0 && current < stageCount),
  'Explicit stage assignment input required');
  const stageIndex = value => Number.isSafeInteger(value) && value >= 0 && value < stageCount;
  const supply = Array.from({ length: stageCount }, () => new Set()), joiners = new Set();
  for (const peer of capabilities) {
    if (peer?.participantId === participantId || peer?.available !== true || !(peer.expiresAt > now)) continue;
    const description = peer.description;
    try { validateOrderedPartitionCapability(description, peer.participantId, maxOffersPerPeer); } catch { continue; }
    if (description.phase === 'ready') for (const offer of description.models) {
      if (offer.id === model.id && offer.identity === model.identity && offer.availability === 'ready'
        && stageIndex(offer.index)) supply[offer.index].add(peer.participantId);
    }
    const claim = description.assignment;
    if (claim?.schema === STAGE_ASSIGNMENT_SCHEMA && claim.modelId === model.id && claim.modelIdentity === model.identity
      && ['waiting', 'loading', 'ready'].includes(description.phase)) {
      if (claim.index === null) joiners.add(peer.participantId);
      else if (stageIndex(claim.index)) supply[claim.index].add(peer.participantId);
    }
  }
  for (const id of joiners) if (supply.some(set => set.has(id))) joiners.delete(id);
  const counts = supply.map(set => set.size);
  // Least supplied; ties go to the lowest index so every observer orders stages alike.
  const least = (rows, skip = -1) => rows.reduce((best, count, index) =>
    index !== skip && (best < 0 || count < rows[best]) ? index : best, -1);
  const decide = (index, reason) => Object.freeze({ index, reason, move: current !== null && index !== current,
    supply: Object.freeze([...counts]), joiners: joiners.size });
  if (current === null) {
    // Simultaneous joiners that observe each other fill stages in participant-id order.
    const rank = [participantId, ...joiners].sort().indexOf(participantId), filled = [...counts];
    let index = -1;
    for (let turn = 0; turn <= rank; turn++) { index = least(filled); filled[index]++; }
    return decide(index, 'cold-least-supplied');
  }
  // Hysteresis: move only when this stage has at least two more contributors than the least
  // supplied one, no joiner is about to fill the gap, and only its highest participant id moves.
  const others = supply[current], target = least(counts, current);
  const highest = [participantId, ...others].sort().at(-1) === participantId;
  if (joiners.size || !highest || others.size < counts[target] + 1) return decide(current, 'retain');
  return decide(target, 'rebalance');
}
