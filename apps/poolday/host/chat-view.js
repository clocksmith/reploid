// Projections remain import-free; this syntax check does not verify an artifact.
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
/** Pure projections. Discovery describes availability; accepted attempts own history. */
export function selectAvailableChatModel(models, preference, location = 'auto') {
  // Application preference, not a quality claim or a priority advertised by peers.
  const rank = model => { const index = preference.indexOf(model.id); return index < 0 ? preference.length : index; };
  const candidates = models.slice().sort((a, b) => rank(a) - rank(b)
    || Number(!!a.adapters?.length) - Number(!!b.adapters?.length) || Number(!!a.partition) - Number(!!b.partition));
  const availability = model => location === 'network' ? model.networkAvailability ?? model.availability
    : location === 'local' ? model.partition ? 'unavailable' : model.localReady ? 'ready' : model.localCached ? 'cached' : 'unavailable'
    : model.localReady || model.networkAvailability === 'ready' ? 'ready' : model.availability;
  // A fresh automatic choice follows ready shared capacity before requiring local preparation.
  if (location === 'auto') {
    const shared = candidates.find(model => model.networkAvailability === 'ready');
    if (shared) return shared;
  }
  for (const status of ['ready', 'busy', 'cached']) {
    if (location === 'network' && status === 'cached') continue;
    const model = candidates.find(model => availability(model) === status);
    if (model) return model;
  }
  return null;
}

/** A base model's compatible adapters: those declaring its exact artifact identity. Names never decide compatibility. */
export const compatibleAdapters = model => (model.availableAdapters || []).filter(adapter => typeof adapter?.id === 'string' && adapter.id
  && SHA256_PATTERN.test(adapter.identity) && SHA256_PATTERN.test(model.identity || '') && adapter.baseModelIdentity === model.identity);

export function projectChatCatalog({ models, peers, connections, releasedPartitionModels = [] }) {
  // Whole-model admission requires a WebRTC data channel. Signaling-only peers can be discovered but cannot receive requests.
  const openPeers = new Map((connections || []).filter(link => link.phase === 'connected'
    && link.channelState === 'open'
    && !['disconnected', 'failed', 'closed'].includes(link.iceState)).map(link => [link.id, link]));
  const reachable = peer => {
    const link = openPeers.get(peer.peerId);
    return !!link && (link.attemptId ?? null) === (peer.attemptId ?? null);
  };
  const selections = models.filter(model => !model.partition).flatMap(model => [model, ...compatibleAdapters(model).map(adapter => ({
    ...model, name: adapter.name, selectionId: model.id + '/' + adapter.id, adapters: [adapter]
  }))]);
  // The host supplies only routes admitted by its release policy.
  return selections.map(model => {
    // A computer blocked on this device is never chosen, so it is not counted as capacity either.
    const compatible = peers.filter(peer => peer.blocked !== true && peer.identityProtocol === 1 && peer.admissionProtocol === 2
      && (!connections || reachable(peer)) && peer.model === model.id && peer.modelIdentity === model.identity
      && (model.adapters || []).every(adapter => peer.adapterIdentities?.includes(adapter.identity)));
    const ready = compatible.filter(peer => peer.readiness === 'ready' && peer.hasInference);
    const loading = compatible.some(peer => peer.readiness === 'loading');
    return { ...model, availability: ready.length ? (ready.some(peer => peer.availableSlots > 0) ? 'ready' : 'busy')
      : loading ? 'loading' : 'unavailable', providerIds: ready.map(peer => peer.peerId),
      reachableProviderIds: ready.filter(peer => peer.availableSlots > 0 && reachable(peer)).map(peer => peer.peerId) };
  }).concat(releasedPartitionModels);
}

export function projectChatPlacements(threads) {
  return Object.fromEntries(threads.flatMap(thread => {
    const completed = thread.attempts.findLast(attempt => attempt.status === 'completed' && attempt.execution);
    return completed ? [[thread.id, completed.execution]] : [];
  }));
}
