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

// Whole-model admission requires a WebRTC data channel. Signaling-only peers can be discovered but cannot receive requests.
const openConnections = connections => new Map((connections || []).filter(link => link.phase === 'connected'
  && link.channelState === 'open'
  && !['disconnected', 'failed', 'closed'].includes(link.iceState)).map(link => [link.id, link]));
const reachableOn = (open, peer) => {
  const link = open.get(peer.peerId);
  return !!link && (link.attemptId ?? null) === (peer.attemptId ?? null);
};

/**
 * Why a whole-model request for `model` is not sent to `peer` now, as { stage, reason }; { stage: null, reason: null }
 * when it can be sent. `open` is openConnections(connections), and `known` says whether connection state was supplied.
 * Stages: 'incompatible' (not a provider of this model for this page), 'not-ready' (a provider that has not loaded it),
 * 'no-capacity' (a ready provider with no free slot, or none this page can reach). projectChatCatalog admits providers
 * from this one function, so a view that states the reason cannot disagree with the choice.
 */
function providerExclusion(peer, model, open, known) {
  const out = (stage, reason) => ({ stage, reason });
  // A computer blocked on this device is never chosen, so it is not counted as capacity either.
  if (peer.blocked === true) return out('incompatible', 'blocked');
  if (peer.unresponsive === true) return out('incompatible', 'unresponsive');
  if (peer.identityProtocol !== 1 || peer.admissionProtocol !== 2) return out('incompatible', 'protocol');
  if (known && !reachableOn(open, peer)) return out('incompatible', 'unreachable');
  if (peer.model !== model.id) return out('incompatible', peer.model ? 'other-model' : 'no-model');
  if (peer.modelIdentity !== model.identity) return out('incompatible', 'other-build');
  if (!(model.adapters || []).every(adapter => peer.adapterIdentities?.includes(adapter.identity))) return out('incompatible', 'adapter');
  if (peer.readiness !== 'ready') return out('not-ready', peer.readiness === 'loading' ? 'loading' : 'not-loaded');
  if (!peer.hasInference) return out('not-ready', 'no-inference');
  if (!(peer.availableSlots > 0)) return out('no-capacity', Number.isSafeInteger(peer.availableSlots) ? 'busy' : 'capacity-unknown');
  if (!reachableOn(open, peer)) return out('no-capacity', 'unreachable');
  return out(null, null);
}

/** Each advertised computer against one catalog model: the decision projectChatCatalog makes, one row per computer,
 * in the order given. */
export function projectProviderEligibility({ model, peers, connections }) {
  const open = openConnections(connections);
  return (peers || []).map(peer => ({ peerId: peer.peerId, ...providerExclusion(peer, model, open, !!connections) }));
}

/** The computers a request could be sent to now, by the data-channel test admission uses: an open channel, and for a
 * computer that advertises, one opened by the connection attempt its advertisement names. */
export function reachablePeerIds({ peers, connections }) {
  const open = openConnections(connections);
  const advertised = new Map((peers || []).map(peer => [peer.peerId, peer]));
  return new Set([...open.keys()].filter(id => !advertised.has(id) || reachableOn(open, advertised.get(id))));
}

export function projectChatCatalog({ models, peers, connections, releasedPartitionModels = [] }) {
  const selections = models.filter(model => !model.partition).flatMap(model => [model, ...compatibleAdapters(model).map(adapter => ({
    ...model, name: adapter.name, selectionId: model.id + '/' + adapter.id, adapters: [adapter]
  }))]);
  // The host supplies only routes admitted by its release policy.
  return selections.map(model => {
    const decisions = projectProviderEligibility({ model, peers, connections });
    const sendable = new Set(peers.filter((peer, index) => decisions[index].stage === null));
    const ready = peers.filter((peer, index) => sendable.has(peer) || decisions[index].stage === 'no-capacity');
    const loading = decisions.some(row => row.reason === 'loading');
    const open = ready.some(peer => peer.availableSlots > 0);
    return { ...model, availability: ready.length ? (open ? 'ready' : 'busy')
      : loading ? 'loading' : 'unavailable', providerIds: ready.map(peer => peer.peerId),
      // Nothing reports a free slot, and at least one computer reports no count at all: not known to be full.
      ...(!open && ready.some(peer => !Number.isSafeInteger(peer.availableSlots)) ? { capacityUnknown: true } : {}),
      reachableProviderIds: ready.filter(peer => sendable.has(peer)).map(peer => peer.peerId) };
  }).concat(releasedPartitionModels);
}

export function projectChatPlacements(threads) {
  return Object.fromEntries(threads.flatMap(thread => {
    const completed = thread.attempts.findLast(attempt => attempt.status === 'completed' && attempt.execution);
    return completed ? [[thread.id, completed.execution]] : [];
  }));
}
