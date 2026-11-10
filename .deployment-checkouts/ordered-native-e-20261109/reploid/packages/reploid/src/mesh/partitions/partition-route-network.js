import { assertPartition as assert, canonicalPartitionJson, canonicalPartitionRoute } from './partition-contract.js';

const REQUEST = 'reploid.partition-channel-route/v1';
const ACCEPT = 'reploid.partition-channel-route-accepted/v1';
/** Auxiliary channel label for ordered routes; the swarm transport must admit it. */
export const ORDERED_PARTITION_CHANNEL = 'reploid-partitions-ordered';
/** Route-bound channels inside the existing authenticated partition network. */
export function createRoutePartitionNetwork({ transport, verifyPeer, createEndpoint, maxPeers, timeoutMs,
  ordered, onPeer = () => {}, label }) {
  assert(label === ORDERED_PARTITION_CHANNEL && typeof ordered?.validateRoute === 'function'
    && Number.isSafeInteger(ordered.maxRouteBytes) && ordered.maxRouteBytes > 0
    && typeof transport?.onDataChannel === 'function' && typeof transport.getPeerBinding === 'function'
    && typeof verifyPeer === 'function' && typeof createEndpoint === 'function'
    && Number.isSafeInteger(maxPeers) && maxPeers > 0 && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    && timeoutMs <= 2147483647, 'Ordered network identity, route and channel budgets required');
  const { maxRouteBytes, validateRoute } = ordered;
  const entries = new Map();
  let closed = false, closing = null;
  const routeSnapshot = route => {
    const value = canonicalPartitionRoute(route);
    assert(new TextEncoder().encode(canonicalPartitionJson(value)).byteLength <= maxRouteBytes, 'Ordered route exceeds handshake allocation');
    return value;
  };
  const keyFor = (peerId, route) => JSON.stringify([peerId, canonicalPartitionJson(route)]);
  const sameCertificate = (peerId, original) => {
    const current = transport.getPeerBinding(peerId);
    return !!original && original.local === current?.local && original.remote === current?.remote;
  };
  function handshake(entry, incoming) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, value) => {
        if (finished) return; finished = true; clearTimeout(timer);
        entry.channel.removeEventListener('message', receive);
        entry.channel.removeEventListener('close', lost);
        entry.controller.signal.removeEventListener('abort', lost);
        error ? reject(error) : resolve(value);
      };
      const lost = () => finish(new Error('Ordered channel closed during authentication'));
      const receive = event => {
        try {
          // Bound text before parsing; envelope overhead is fixed, route budget explicit.
          assert(typeof event.data === 'string' && event.data.length <= maxRouteBytes + 128
            && new TextEncoder().encode(event.data).byteLength <= maxRouteBytes + 128, 'Ordered handshake allocation exceeded');
          const message = JSON.parse(event.data);
          assert(message.schema === (incoming ? REQUEST : ACCEPT)
            && Object.keys(message).length === 2, 'Ordered channel handshake version mismatch');
          const route = routeSnapshot(message.route);
          if (!incoming) assert(canonicalPartitionJson(route) === canonicalPartitionJson(entry.route), 'Ordered handshake route changed');
          finish(null, route);
        } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(new Error('Ordered channel authentication timed out')), timeoutMs);
      entry.channel.addEventListener('message', receive);
      entry.channel.addEventListener('close', lost, { once: true });
      entry.controller.signal.addEventListener('abort', lost, { once: true });
      if (entry.controller.signal.aborted || entry.channel.readyState === 'closed') lost();
    });
  }
  function opened(entry) {
    if (entry.channel.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = error => { entry.channel.removeEventListener('open', ready);
        entry.controller.signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const ready = () => done(), abort = () => done(new Error('Ordered channel opening cancelled'));
      entry.channel.addEventListener('open', ready, { once: true });
      entry.controller.signal.addEventListener('abort', abort, { once: true });
      if (entry.controller.signal.aborted) abort();
    });
  }
  async function guarded(entry, operation) {
    entry.controller.signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error('Ordered authentication or route validation cancelled'));
      entry.controller.signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => {
      entry.controller.signal.throwIfAborted(); return operation();
    }), cancelled]); }
    finally { entry.controller.signal.removeEventListener('abort', abort); }
  }
  function retireEntry(entry) {
    if (entry.retirement) return entry.retirement;
    entry.retiring = true;
    const operation = Promise.resolve().then(() => entry.endpoint?.close()).then(() => {
      entry.controller.abort(); entry.channel.close();
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
    });
    entry.retirement = operation;
    operation.catch(() => { if (entry.retirement === operation) entry.retirement = null; });
    return operation;
  }
  function attach(peerId, channel, incoming, route) {
    assert(!closed && entries.size < maxPeers, 'Ordered channel allocation exhausted');
    const key = route ? keyFor(peerId, route) : Symbol('unbound-route');
    assert(!entries.has(key), 'Ordered route channel already exists');
    const entry = { peerId, key, route, channel, controller: new AbortController(), endpoint: null,
      promise: null, retirement: null, retiring: false, lost: false };
    entries.set(key, entry);
    channel.addEventListener('close', () => {
      entry.lost = true; entry.controller.abort();
      // A closed socket alone never clears resident ownership.
      Promise.resolve(entry.promise).catch(() => {}).then(() => retireEntry(entry)).catch(() => {});
    }, { once: true });
    const received = handshake(entry, incoming); received.catch(() => {});
    entry.promise = (async () => {
      const timer = setTimeout(() => entry.controller.abort(), timeoutMs);
      try {
        const observedCertificate = transport.getPeerBinding(peerId);
        assert(observedCertificate && typeof observedCertificate.local === 'string' && typeof observedCertificate.remote === 'string',
          'Authenticated WebRTC certificate binding required');
        const certificate = {local: observedCertificate.local, remote: observedCertificate.remote};
        const remoteParticipantId = await guarded(entry, () => verifyPeer(peerId, entry.controller.signal));
        entry.controller.signal.throwIfAborted();
        assert(/^peer:[a-f0-9]{24}$/.test(remoteParticipantId) && sameCertificate(peerId, certificate), 'Ordered peer identity or certificate changed');
        await opened(entry); entry.controller.signal.throwIfAborted();
        if (!incoming) channel.send(JSON.stringify({ schema: REQUEST, route: entry.route }));
        const bound = await received; entry.controller.signal.throwIfAborted();
        assert(await guarded(entry, () => validateRoute(bound, { remoteParticipantId, remoteTransportId: peerId, incoming,
          signal: entry.controller.signal })) === true, 'Ordered route validation declined');
        entry.controller.signal.throwIfAborted();
        assert(sameCertificate(peerId, certificate), 'Ordered peer certificate changed during route validation');
        if (incoming) {
          const boundKey = keyFor(peerId, bound);
          assert(!entries.has(boundKey), 'Ordered route channel already exists');
          entries.delete(entry.key); entry.key = boundKey; entry.route = bound; entries.set(boundKey, entry);
        }
        entry.endpoint = createEndpoint({ channel, remoteParticipantId, remoteTransportId: peerId, route: entry.route });
        assert(entry.endpoint && typeof entry.endpoint.close === 'function', 'Ordered endpoint cleanup owner required');
        if (incoming) channel.send(JSON.stringify({ schema: ACCEPT, route: entry.route }));
        onPeer(peerId, entry.endpoint, structuredClone(entry.route));
        return entry.endpoint;
      } catch (error) {
        entry.controller.abort();
        try { await retireEntry(entry); } catch { /* Explicit retire/close retries retained ownership. */ }
        throw error;
      } finally { clearTimeout(timer); }
    })();
    return entry.promise;
  }
  const unsubscribe = transport.onDataChannel(label, (peerId, channel) => {
    try { attach(peerId, channel, true).catch(() => {}); } catch { channel.close(); }
  });
  return Object.freeze({
    connect(peerId, { route } = {}) {
      assert(!closed, 'Ordered partition network closed');
      const snapshot = routeSnapshot(route), key = keyFor(peerId, snapshot), existing = entries.get(key);
      if (existing) {
        assert(!existing.retiring && !existing.lost, 'Previous ordered route cleanup remains charged');
        return existing.promise;
      }
      assert(entries.size < maxPeers, 'Ordered channel allocation exhausted');
      const channel = transport.openDataChannel(peerId, label);
      try { return attach(peerId, channel, false, snapshot); } catch (error) { channel.close(); throw error; }
    },
    async retire(peerId, { route }) {
      const entry = entries.get(keyFor(peerId, routeSnapshot(route)));
      if (!entry) return;
      entry.retiring = true;
      if (!entry.endpoint) entry.controller.abort();
      await entry.promise.catch(() => {});
      await retireEntry(entry);
    },
    getState() { return { closed, channels: entries.size, retiring: [...entries.values()].filter(entry=>entry.retiring).length }; },
    close() {
      if (closing) return closing;
      closed = true; unsubscribe();
      const snapshot = [...entries.values()]; snapshot.forEach(entry=>entry.controller.abort());
      closing = (async () => {
        await Promise.allSettled(snapshot.map(entry=>entry.promise));
        const results = await Promise.allSettled(snapshot.map(retireEntry));
        const failures = results.filter(result=>result.status === 'rejected').map(result=>result.reason);
        if (failures.length) throw new AggregateError(failures, 'Ordered network cleanup remains unsettled');
      })().catch(error => { closing = null; throw error; });
      return closing;
    }
  });
}
