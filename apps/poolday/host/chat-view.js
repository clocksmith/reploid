// Projections import only the pure computer and offer records (no runtime owner); this syntax check does not verify an artifact.
import { offerAvailability, offersOfPeer } from './computer-records.js';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
/** Pure projections. Discovery describes availability; accepted attempts own history. */
// The model checks the session's projections read. This file imports no runtime owner (scripts/verify-layers.js), so they are
// defined here and every other reader takes them from decisions/model-state.js, which re-exports them.
/** Statuses of a computer that answers now: ready, or busy and taking requests. */
export const SERVING_STATUSES = Object.freeze(['ready', 'busy']);
/** Statuses a request can be sent on: serving, or stored here and loaded on Send. */
export const USABLE_STATUSES = Object.freeze([...SERVING_STATUSES, 'cached']);
/**
 * Stored on this device, so a request for it can stay here: loaded, downloaded, or reported cached. A split route
 * and a private pool's model never run here, whatever their flags: the session sends them on
 * (host/chat-execution.js, `staysHere` and the private-pool branch of execute).
 */
export const storedHere = model => !!model && !model.partition && !model.fleet
  && !!(model.localReady || model.localCached || model.availability === 'cached');
/**
 * Whether a public computer can answer with this whole model now. It is one predicate for two decisions that must
 * agree: the evidence that ends "Finding computers…" early (chat-session.js) and the capacity a visitor who chose
 * nothing is sent to (decisions/conversation-controller.js). A private pool's model and a split route are neither.
 */
export const servesPublicAnswers = model => !model.fleet && !model.partition && SERVING_STATUSES.includes(model.networkAvailability);

export function selectAvailableChatModel(models, preference, location = 'auto') {
  // Application preference, not a quality claim or a priority advertised by peers.
  const rank = model => { const index = preference.indexOf(model.id); return index < 0 ? preference.length : index; };
  const candidates = models.slice().sort((a, b) => rank(a) - rank(b)
    || Number(!!a.adapters?.length) - Number(!!b.adapters?.length) || Number(!!a.partition) - Number(!!b.partition));
  const availability = model => location === 'network' ? model.networkAvailability ?? model.availability
    : location === 'local' ? !storedHere(model) ? 'unavailable' : model.localReady ? 'ready' : 'cached'
    : model.localReady || model.networkAvailability === 'ready' ? 'ready' : model.availability;
  // A fresh automatic choice follows ready shared capacity before requiring local preparation.
  if (location === 'auto') {
    const shared = candidates.find(model => model.networkAvailability === 'ready');
    if (shared) return shared;
  }
  for (const status of USABLE_STATUSES) {
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
function providerExclusion(peer, model, open, known, now) {
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
  // Whether it provides inference comes from its current offer, never a flag or role it advertised. A busy or failed
  // offer still stands but has no capacity, so it is never sent new work; a paused or expired one offers nothing.
  const inference = offerAvailability({ offers: offersOfPeer(peer) }, 'inference', now);
  if (!inference.offered) return out('not-ready', 'no-inference');
  if (!inference.available) return out('no-capacity', 'busy');
  if (!(peer.availableSlots > 0)) return out('no-capacity', Number.isSafeInteger(peer.availableSlots) ? 'busy' : 'capacity-unknown');
  if (!reachableOn(open, peer)) return out('no-capacity', 'unreachable');
  return out(null, null);
}

/** Each advertised computer against one catalog model: the decision projectChatCatalog makes, one row per computer,
 * in the order given. */
export function projectProviderEligibility({ model, peers, connections, now = Date.now() }) {
  const open = openConnections(connections);
  return (peers || []).map(peer => ({ peerId: peer.peerId, ...providerExclusion(peer, model, open, !!connections, now) }));
}

/** The computers a request could be sent to now, by the data-channel test admission uses: an open channel, and for a
 * computer that advertises, one opened by the connection attempt its advertisement names. */
export function reachablePeerIds({ peers, connections }) {
  const open = openConnections(connections);
  const advertised = new Map((peers || []).map(peer => [peer.peerId, peer]));
  return new Set([...open.keys()].filter(id => !advertised.has(id) || reachableOn(open, advertised.get(id))));
}

export function projectChatCatalog({ models, peers, connections, releasedPartitionModels = [], now = Date.now() }) {
  const selections = models.filter(model => !model.partition).flatMap(model => [model, ...compatibleAdapters(model).map(adapter => ({
    ...model, name: adapter.name, selectionId: model.id + '/' + adapter.id, adapters: [adapter]
  }))]);
  // The host supplies only routes admitted by its release policy.
  return selections.map(model => {
    const decisions = projectProviderEligibility({ model, peers, connections, now });
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
