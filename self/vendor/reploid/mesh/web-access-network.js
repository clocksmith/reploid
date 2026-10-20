/** Bounded search/extraction jobs on the existing authenticated peer connection.
 * Hosts provide public-web execution and opt-in. This channel never reads browser tabs,
 * requests model execution, changes disclosure recipients, or closes its borrowed transport. */
import policy from './web-access-policy.json' with { type: 'json' };
import { createRemoteGenerationRequests } from './remote-generation-requests.js';

const OFFER = 'reploid:web-offer', REQUEST = 'reploid:web-request';
const RESPONSE = 'reploid:web-response', CANCEL = 'reploid:web-cancel';
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const fail = message => { throw new Error(message); };

export function createWebAccessNetwork({ transport, verifyPeer, worker = null, enabled = () => false, onChange = () => {} }) {
  const offers = new Map(), checking = new Map(), epochs = new Map(), inbound = new Map(), seen = new Map();
  let closed = false;
  const send = (peer, type, payload) => !closed && size(payload) <= policy.maxMessageBytes && transport.sendToPeer(peer, type, payload);
  const pending = createRemoteGenerationRequests({ timeoutMs: policy.timeoutMs, maxPending: policy.maxPending,
    sendCancel: (peer, requestId) => send(peer, CANCEL, { requestId }) });
  const peers = () => new Set(transport.getConnectedPeers().map(peer => peer.id));
  const available = () => !closed && worker && enabled() === true;
  const describe = () => available() && (worker.isAvailable?.() ?? true) ? { service: worker.service, version: worker.version } : null;
  const publish = peer => send(peer, OFFER, describe());
  const notify = () => onChange();
  const retire = peer => {
    if (offers.delete(peer)) notify();
    pending.retirePeer(peer);
    for (const job of inbound.values()) if (job.peer === peer) job.controller.abort(new Error('Search requester disconnected'));
  };
  const tick = () => {
    if (closed) return;
    const connected = peers();
    for (const peer of epochs.keys()) if (!connected.has(peer)) { epochs.delete(peer); checking.get(peer)?.abort(); }
    for (const peer of offers.keys()) if (!connected.has(peer)) retire(peer);
    for (const job of inbound.values()) if (!connected.has(job.peer) || !available()) job.controller.abort(new Error('Web contribution stopped'));
    for (const peer of connected) publish(peer);
    const cutoff = Date.now() - policy.resultTtlMs;
    for (const [key, at] of seen) if (at < cutoff) seen.delete(key);
  };
  transport.onMessage(OFFER, (peer, offer) => {
    if (closed || !peers().has(peer)) return;
    if (!offer) { checking.get(peer)?.abort(); epochs.delete(peer); retire(peer); return; }
    if (!Object.hasOwn(policy.services, offer.service) || offer.version !== policy.services[offer.service] || checking.has(peer) || checking.size >= policy.maxPeers) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    checking.set(peer, controller); epochs.set(peer, controller);
    Promise.resolve().then(() => verifyPeer(peer, controller.signal)).then(participantId => {
      if (closed || epochs.get(peer) !== controller || controller.signal.aborted || !peers().has(peer) || !validId(participantId)) return;
      const prior = offers.get(peer);
      if (prior?.participantId === participantId && prior.service === offer.service && prior.version === offer.version) return;
      if (offers.size >= policy.maxPeers) return;
      offers.set(peer, { peerId: peer, participantId, service: offer.service, version: offer.version }); notify();
    }).catch(() => {}).finally(() => { clearTimeout(timer); checking.delete(peer); });
  });
  transport.onMessage(RESPONSE, (peer, payload) => {
    if (closed || !payload || size(payload) > policy.maxMessageBytes) return;
    const job = pending.get(payload.requestId, peer);
    if (!job) return;
    if (payload.error) pending.settle(job, { error: new Error(String(payload.error).slice(0, 256)) });
    else pending.settle(job, { response: payload.result });
  });
  transport.onMessage(CANCEL, (peer, payload) => {
    const job = inbound.get(`${peer}/${payload?.requestId}`);
    job?.controller.abort(new Error('Web request cancelled'));
  });
  transport.onMessage(REQUEST, (peer, input) => {
    if (closed || !input || !validId(input.requestId) || size(input) > policy.maxMessageBytes) return;
    const key = `${peer}/${input.requestId}`;
    const reject = message => send(peer, RESPONSE, { requestId: input.requestId, error: message });
    if (!available()) return reject('Web contribution is off');
    if (input.operation === 'search' && worker.isAvailable?.() === false) return reject('Contributor browser is unavailable');
    if (input.service !== worker.service || input.version !== worker.version) return reject('Search service changed');
    if (!['search', 'extract'].includes(input.operation) || !input.args || typeof input.args !== 'object') return reject('Invalid web request');
    if (inbound.has(key) || seen.has(key)) return reject('Duplicate web request');
    if (inbound.size >= policy.maxInbound || seen.size >= policy.maxSeen) return reject('Web contributor is busy');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Web request timed out')), policy.timeoutMs);
    const job = { peer, controller, promise: null }; inbound.set(key, job); seen.set(key, Date.now());
    job.promise = Promise.resolve().then(async () => {
      const requester = await verifyPeer(peer, controller.signal);
      controller.signal.throwIfAborted();
      if (!validId(requester) || !available() || !peers().has(peer)) fail('Web request is not authorized');
      const result = await worker[input.operation](input.args, { signal: controller.signal, requester });
      controller.signal.throwIfAborted();
      if (!available()) fail('Web contribution stopped');
      if (size({ requestId: input.requestId, result }) > policy.maxMessageBytes) fail('Web result exceeds the transfer limit');
      send(peer, RESPONSE, { requestId: input.requestId, result });
    }).catch(() => reject(controller.signal.aborted ? 'Web request cancelled or timed out' : 'Web request failed'))
      .finally(() => { clearTimeout(timer); inbound.delete(key); });
  });
  const timer = setInterval(tick, policy.pollMs); timer.unref?.(); tick();
  return Object.freeze({
    getOffers: () => [...offers.values()].map(offer => ({ ...offer })),
    refresh: tick,
    async request(offer, operation, args, signal) {
      offer = structuredClone(offer); args = structuredClone(args);
      signal?.throwIfAborted();
      const current = offers.get(offer?.peerId);
      if (closed || !current || current.participantId !== offer.participantId || current.service !== offer.service || current.version !== offer.version || !peers().has(offer.peerId)) fail('Search contributor changed; allow a new search');
      const identity = await verifyPeer(offer.peerId, signal);
      signal?.throwIfAborted();
      if (identity !== offer.participantId || offers.get(offer.peerId) !== current) fail('Search contributor changed; allow a new search');
      const requestId = crypto.randomUUID();
      return pending.start({ requestId, providerPeerId: offer.peerId, signal }, () => send(offer.peerId, REQUEST,
        { requestId, service: current.service, version: current.version, operation, args }));
    },
    async close() {
      for (const peer of peers()) send(peer, OFFER, null);
      for (const controller of checking.values()) controller.abort();
      pending.close(); closed = true; clearInterval(timer); offers.clear(); notify();
      for (const job of inbound.values()) job.controller.abort(new Error('Web contributor closed'));
      await Promise.allSettled([...inbound.values()].map(job => job.promise));
    }
  });
}
