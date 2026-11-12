// In-memory peer network for automatic-partition tests. Peers are indexed by position; each
// peer's networks are kept in registry.get(String(index)) keyed by network label, so a test can
// reach a peer's network (and its endpoints) directly. Data channels are open EventTarget pairs
// that deliver structured clones on a microtask; closing one side closes the other.

/** An open, ordered in-memory data channel pair. */
export function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, {
    readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); }
  }));
  return pair;
}

/**
 * The createNetwork port for peer `index` (holding `identity`) among `identities`. Registers the
 * peer's network map in `registry`. connect(remoteId) pairs this peer's endpoint with the remote
 * peer's endpoint on the same label, or throws until the remote peer has opened that network.
 */
export function memoryNetworkPort({ registry, identities, index, identity }) {
  const networks = new Map(); registry.set(String(index), networks);
  return function createNetwork(options) {
    const endpoints = new Map();
    const network = { options, endpoints,
      async connect(remoteId) {
        if (endpoints.has(remoteId)) return endpoints.get(remoteId);
        const other = registry.get(remoteId)?.get(options.label);
        if (!other) throw Error('not yet connected');
        const [left, right] = channels();
        const local = options.createEndpoint({ channel: left, remoteParticipantId: identities[Number(remoteId)].peerId });
        const remote = other.options.createEndpoint({ channel: right, remoteParticipantId: identity.peerId });
        endpoints.set(remoteId, local); other.endpoints.set(String(index), remote);
        left.addEventListener('close', () => endpoints.delete(remoteId), { once: true });
        right.addEventListener('close', () => other.endpoints.delete(String(index)), { once: true });
        options.onPeer?.(remoteId, local); other.options.onPeer?.(String(index), remote);
        return local;
      },
      async close() { networks.delete(options.label); await Promise.all([...endpoints.values()].map(endpoint => endpoint.close())); }
    };
    networks.set(options.label, network); return network;
  };
}
