import { assertPartition as assert } from './partition-contract.js';

const LABEL = 'reploid-partitions';
const READY = 'reploid.partition-channel-ready/v1';

/** Uses the existing mesh certificate/signature verifier; never trusts an advertised peer ID. */
export function createPartitionNetwork({ transport, verifyPeer, createEndpoint, maxPeers, timeoutMs, onPeer = () => {} }) {
  assert(typeof transport?.onDataChannel === 'function' && typeof transport.getPeerBinding === 'function'
    && typeof verifyPeer === 'function' && typeof createEndpoint === 'function'
    && Number.isSafeInteger(maxPeers) && maxPeers > 0 && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    && timeoutMs <= 2147483647, 'Partition network ports and budgets required');
  const entries = new Map(), retiring = new Set();
  let closed = false, closing = null, settlementFailure = null;
  const settleEntry = entry => {
    if (!entry.settlement) {
      entry.settlement = Promise.resolve().then(() => entry.endpoint?.close());
      retiring.add(entry.settlement);
      entry.settlement.then(() => retiring.delete(entry.settlement), error => {
        retiring.delete(entry.settlement); settlementFailure ||= error;
      });
    }
    return entry.settlement;
  };
  const wait = (entry, handshake) => new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); entry.channel.removeEventListener('open', opened);
      entry.channel.removeEventListener('message', message); entry.channel.removeEventListener('close', lost);
      entry.controller.signal.removeEventListener('abort', lost);
      error ? reject(error) : resolve();
    };
    const opened = () => { if (!handshake) finish(); };
    const message = event => finish(event.data === READY ? null : new Error('Invalid partition channel handshake'));
    const lost = () => finish(new Error('Partition channel closed during authentication'));
    const timer = setTimeout(() => finish(new Error('Partition channel authentication timed out')), timeoutMs);
    entry.channel.addEventListener('open', opened);
    if (handshake) entry.channel.addEventListener('message', message, { once: true });
    entry.channel.addEventListener('close', lost, { once: true });
    entry.controller.signal.addEventListener('abort', lost, { once: true });
    if (entry.controller.signal.aborted || entry.channel.readyState === 'closed') lost();
    else if (!handshake && entry.channel.readyState === 'open') finish();
  });
  const attach = (peerId, channel, incoming) => {
    assert(!closed && !entries.has(peerId) && entries.size < maxPeers, 'Partition peer limit or duplicate connection');
    const entry = { channel, controller: new AbortController(), endpoint: null, promise: null };
    entries.set(peerId, entry);
    channel.addEventListener('close', () => {
      entry.controller.abort();
      if (entries.get(peerId) === entry) entries.delete(peerId);
      settleEntry(entry);
    }, { once: true });
    // Install the handshake listener before any asynchronous certificate verification.
    const ready = wait(entry, !incoming);
    ready.catch(() => {});
    entry.promise = (async () => {
      const timer = setTimeout(() => entry.controller.abort(), timeoutMs);
      try {
        const before = transport.getPeerBinding(peerId);
        assert(before, 'Authenticated WebRTC certificate binding required');
        const verifiedId = await verifyPeer(peerId, entry.controller.signal);
        entry.controller.signal.throwIfAborted();
        const after = transport.getPeerBinding(peerId);
        assert(/^peer:[a-f0-9]{24}$/.test(verifiedId) && before.local === after?.local && before.remote === after?.remote,
          'Partition peer identity or certificate changed');
        await ready;
        entry.controller.signal.throwIfAborted();
        entry.endpoint = createEndpoint({ channel, remoteParticipantId: verifiedId });
        if (incoming) channel.send(READY);
        onPeer(peerId, entry.endpoint);
        return entry.endpoint;
      } catch (error) {
        entry.controller.abort(); channel.close();
        if (entries.get(peerId) === entry) entries.delete(peerId);
        await settleEntry(entry).catch(() => {});
        throw error;
      } finally { clearTimeout(timer); }
    })();
    return entry.promise;
  };
  const unsubscribe = transport.onDataChannel(LABEL, (peerId, channel) => {
    try { attach(peerId, channel, true).catch(() => {}); } catch { channel.close(); }
  });
  return Object.freeze({
    connect(peerId) {
      assert(!closed, 'Partition network closed');
      if (entries.has(peerId)) return entries.get(peerId).promise;
      assert(entries.size < maxPeers, 'Partition peer limit');
      const channel = transport.openDataChannel(peerId, LABEL);
      try { return attach(peerId, channel, false); } catch (error) { channel.close(); throw error; }
    },
    close() {
      if (closing) return closing;
      closed = true; unsubscribe();
      const pending = [...entries.values()];
      closing = Promise.resolve().then(async () => {
        for (const entry of pending) { entry.controller.abort(); entry.channel.close(); }
        await Promise.allSettled(pending.map(entry => entry.promise));
        const results = await Promise.allSettled([...retiring, ...pending.map(settleEntry)]);
        entries.clear();
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (settlementFailure && !failures.includes(settlementFailure)) failures.push(settlementFailure);
        if (failures.length) throw new AggregateError(failures, 'Partition network settlement failed');
      });
      return closing;
    }
  });
}
