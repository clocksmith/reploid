/**
 * @fileoverview Whether an established peer connection is direct or goes through a TURN relay,
 * read from this browser's own WebRTC statistics. It is a local observation of the selected
 * candidate pair. It grants nothing and is null whenever the statistics do not say.
 */
const CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx', 'relay']);

/** @returns {'relayed' | 'direct' | null} */
export function classifyConnectionPath(report) {
  if (!report || typeof report.values !== 'function' || typeof report.get !== 'function') return null;
  const stats = [...report.values()];
  // The transport names the pair in use. Firefox marks the pair itself instead. A pair that is
  // merely nominated or succeeded is not evidence of the path in use, so it is not consulted.
  const selectedIds = stats.filter(item => item?.type === 'transport' && item.selectedCandidatePairId)
    .map(item => item.selectedCandidatePairId);
  const pairs = selectedIds.length ? selectedIds.map(id => report.get(id)).filter(Boolean)
    : stats.filter(item => item?.type === 'candidate-pair' && item.selected === true);
  if (pairs.length !== 1 || pairs[0].type !== 'candidate-pair') return null;
  const types = [pairs[0].localCandidateId, pairs[0].remoteCandidateId]
    .map(id => report.get(id)?.candidateType);
  if (!types.every(type => CANDIDATE_TYPES.has(type))) return null;
  return types.includes('relay') ? 'relayed' : 'direct';
}

/** Never rejects: missing or failing statistics are reported as unknown. */
export async function observeConnectionPath(connection) {
  if (typeof connection?.getStats !== 'function') return null;
  try { return classifyConnectionPath(await connection.getStats()); }
  catch { return null; }
}
