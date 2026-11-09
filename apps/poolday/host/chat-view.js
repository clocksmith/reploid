/** Pure projections. Discovery describes availability; accepted attempts own history. */
export function selectAvailableChatModel(models, preference, location = 'auto') {
  // Application preference, not a quality claim or a priority advertised by peers.
  const rank = model => { const index = preference.indexOf(model.id); return index < 0 ? preference.length : index; };
  const candidates = models.slice().sort((a, b) => rank(a) - rank(b)
    || Number(!!a.adapters?.length) - Number(!!b.adapters?.length) || Number(!!a.partition) - Number(!!b.partition));
  const availability = model => location === 'network' ? model.networkAvailability ?? model.availability
    : location === 'local' ? model.partition ? 'unavailable' : model.localReady ? 'ready' : model.localCached ? 'cached' : 'unavailable'
    : model.localReady || model.networkAvailability === 'ready' ? 'ready' : model.availability;
  for (const status of ['ready', 'busy', 'cached']) {
    if (location === 'network' && status === 'cached') continue;
    const model = candidates.find(model => availability(model) === status);
    if (model) return model;
  }
  return null;
}

/** A base model's compatible adapters: those declaring its exact artifact identity. Names never decide compatibility. */
export const compatibleAdapters = model => (model.availableAdapters || []).filter(adapter => typeof adapter?.id === 'string' && adapter.id
  && /^sha256:[a-f0-9]{64}$/.test(adapter.identity) && /^sha256:[a-f0-9]{64}$/.test(model.identity || '') && adapter.baseModelIdentity === model.identity);

export function projectChatCatalog({ models, peers, releasedPartitionModels = [] }) {
  const selections = models.filter(model => !model.partition).flatMap(model => [model, ...compatibleAdapters(model).map(adapter => ({
    ...model, name: adapter.name, selectionId: model.id + '/' + adapter.id, adapters: [adapter]
  }))]);
  // The host supplies only routes admitted by its release policy.
  return selections.map(model => {
    const compatible = peers.filter(peer => peer.model === model.id && peer.modelIdentity === model.identity
      && (model.adapters || []).every(adapter => peer.adapterIdentities?.includes(adapter.identity)));
    const ready = compatible.filter(peer => peer.readiness === 'ready' && peer.hasInference);
    const loading = compatible.some(peer => peer.readiness === 'loading');
    return { ...model, availability: ready.length ? (ready.some(peer => peer.availableSlots > 0) ? 'ready' : 'busy')
      : loading ? 'loading' : 'unavailable', providerIds: ready.map(peer => peer.peerId) };
  }).concat(releasedPartitionModels);
}

export function projectChatPlacements(threads) {
  return Object.fromEntries(threads.flatMap(thread => {
    const completed = thread.attempts.findLast(attempt => attempt.status === 'completed' && attempt.execution);
    return completed ? [[thread.id, completed.execution]] : [];
  }));
}
