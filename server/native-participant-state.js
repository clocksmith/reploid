

/** CLI status only. Detailed receipts remain available through getState(); routine
 * notifications must not serialize signed artifact bodies or conversation text.
 * `at` (ISO 8601, UTC) is when the host observed this state. */
export function summarizeNativePartitionState(state, { at = Date.now() } = {}) {
  const text = (value, limit = 256) => {
    if (typeof value !== 'string') return null;
    return value.length > limit ? value.slice(0, limit) + '…' : value;
  };
  const scalar = value => {
    if (typeof value === 'string') return text(value);
    return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
    .map(key => [key, scalar(value[key])]));
  const rows = (values, project) => {
    const entries = Array.isArray(values) ? values : [];
    return { count: entries.length, omitted: Math.max(0, entries.length - 16), records: entries.slice(0, 16).map(project) };
  };
  const placement = Array.isArray(state.placement) ? state.placement : [];
  const acquisition = state.acquisition;
  return { event: 'partition-state', at: new Date(at).toISOString(), phase: text(state.phase), error: text(state.error, 1024),
    offering: state.offering === true, modelId: text(state.modelId), unsettledOwners: scalar(state.unsettledOwners),
    progress: state.progress ? pick(state.progress, ['stage', 'phase', 'message', 'loaded', 'total', 'progress',
      'status', 'prepared', 'key', 'elapsedMs', 'startedAt', 'maxDurationMs', 'outstanding']) : null,
    placement: placement.slice(0, 16).map(value => text(value)), placementOmitted: Math.max(0, placement.length - 16),
    descriptor: state.descriptor ? { ...pick(state.descriptor, ['schema', 'modelId', 'modelIdentity', 'planId', 'index',
      'participantId', 'ready', 'residentWeightBytes', 'generationDigest', 'canonicalGenerationId']),
      layerRange: Array.isArray(state.descriptor.layerRange) ? state.descriptor.layerRange.slice(0, 2).map(scalar) : null } : null,
    reservations: state.reservations ? { ...pick(state.reservations, ['active', 'availableSlots', 'closed']),
      ...rows(state.reservations.records, record => ({ attemptId: text(record.identity?.attemptId),
        ...pick(record, ['phase', 'failure', 'reservedAt', 'settlingAt', 'settledAt']) })) } : null,
    attempts: rows(state.attempts, record => pick(record, ['attemptId', 'threadId', 'status', 'phase'])),
    acquisition: acquisition ? { openingMode: text(acquisition.openingMode),
      memory: pick(acquisition.memory, ['liveBytes', 'allocatedBytes', 'maxBytes', 'peakBytes', 'allocations', 'rejected', 'lost']),
      preparation: pick(acquisition.preparation, ['openMs', 'acquisitionAndMaterializationMs']) } : null };
}
