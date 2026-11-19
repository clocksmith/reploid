/**
 * Loading phases of the physical journey (fleet-journey-physical.js), as pure functions.
 *
 * A provider marked `deferLoadUntilBarrier` is started and enrolled with the others but loads the model only
 * after an operator releases a barrier. That is for a machine whose GPU is in use by something the driver must
 * not stop itself, such as a live service. Everything slow, the peer fill above all, happens first. The
 * operator then suspends that service and releases the barrier, and the remaining checks run inside a bounded
 * window that starts at the suspension.
 */
export const BARRIER_SCHEMA = 'reploid.fleet-journey-barrier/v1';
const BOUND = ['runId', 'barrierId', 'approvalToken', 'manifestSha256', 'archiveSha256'];
const PEER_SOURCE = 'authorized-custody-peers';

/** A provider offers its model files to peers unless it is the one filling, or the operator says otherwise. */
export function sharesModelFiles(spec) {
  if (spec.shareModelFiles !== undefined && typeof spec.shareModelFiles !== 'boolean') throw Error(`${spec.computerId} shareModelFiles must be true or false`);
  return spec.shareModelFiles ?? spec.fillFromPeers !== true;
}

/**
 * Who loads when. `holders` load first and offer pieces; `filler` then completes the model from `sources`;
 * `deferred` load after the barrier. Returns computer ids; throws on a list no run could complete.
 */
export function planLoading(providers, barrier = null) {
  const ids = providers.map(spec => spec.computerId);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw Error('Every provider needs its own computerId');
  const fillers = providers.filter(spec => spec.fillFromPeers === true), deferred = providers.filter(spec => spec.deferLoadUntilBarrier === true);
  if (fillers.length > 1) throw Error('At most one provider fills from peers');
  const filler = fillers[0] ?? null;
  if (filler && deferred.includes(filler)) throw Error(`${filler.computerId} cannot both fill from peers and wait for the barrier`);
  const holders = providers.filter(spec => spec !== filler && !deferred.includes(spec));
  if (!holders.length) throw Error('At least one provider must hold the model and load before the barrier');
  const sources = holders.filter(sharesModelFiles);
  if (filler && !sources.length) throw Error(`${filler.computerId} has no holder to fill from: one that shares model files must load before the barrier`);
  if (filler?.requireColdFill !== undefined && typeof filler.requireColdFill !== 'boolean') throw Error('requireColdFill must be true or false');
  if (!deferred.length) {
    if (barrier) throw Error('A barrier is configured but no provider has deferLoadUntilBarrier');
    return { holders: holders.map(spec => spec.computerId), filler: filler?.computerId ?? null, sources: sources.map(spec => spec.computerId), deferred: [], barrier: null };
  }
  const minutes = barrier?.maxMinutesAfterPause;
  if (!Number.isFinite(minutes) || minutes <= 0) throw Error('deferLoadUntilBarrier needs barrier.maxMinutesAfterPause, the minutes the run may take once the operator has suspended the outside service');
  if (barrier.approvalFile !== undefined && typeof barrier.approvalFile !== 'string') throw Error('barrier.approvalFile must be a path');
  return { holders: holders.map(spec => spec.computerId), filler: filler?.computerId ?? null, sources: sources.map(spec => spec.computerId),
    deferred: deferred.map(spec => spec.computerId), barrier: { maxMinutesAfterPause: minutes, approvalFile: barrier.approvalFile ?? null } };
}

/**
 * Accepts the operator's answer to one barrier. It must echo that barrier's run, identifier, token and package
 * digests, so an answer left over from another run or written for another package releases nothing, and it
 * must give the time of the suspension, which starts the window. Returns that time and the window's end.
 */
export function validateApproval(approval, barrier, now, { maxPauseAgeMs = 120000, maxClockAheadMs = 5000 } = {}) {
  if (approval?.approved !== true) throw Error('The barrier answer does not say approved: true');
  for (const key of BOUND) {
    if (key !== 'archiveSha256' && (typeof barrier[key] !== 'string' || !barrier[key])) throw Error(`The barrier has no ${key}`);
    if ((approval[key] ?? null) !== (barrier[key] ?? null)) throw Error(`The barrier answer names a different ${key}`);
  }
  const paused = typeof approval.pauseUtc === 'string' ? Date.parse(approval.pauseUtc) : NaN;
  if (!Number.isFinite(paused)) throw Error('The barrier answer needs pauseUtc, the time the outside service was suspended');
  if (paused > now + maxClockAheadMs) throw Error('pauseUtc is in the future');
  if (paused < now - maxPauseAgeMs) throw Error('pauseUtc is too old: answer the barrier right after suspending the outside service');
  return { pauseUtc: new Date(paused).toISOString(), deadline: paused + barrier.maxMinutesAfterPause * 60000 };
}

/** Why a finished fill cannot be reported as fetched whole from peers into empty directories; null if it can. */
export function coldFillProblem(distribution) {
  if (!distribution) return 'the fill reported no completion';
  if (!(distribution.fetchedBytes > 0)) return 'it fetched nothing';
  if (distribution.reusedPieces !== 0) return 'it did not report zero reused pieces';
  const others = Object.keys(distribution.bySource ?? {}).filter(source => source !== PEER_SOURCE);
  return others.length ? `some pieces came from ${others.join(', ')}` : null;
}
