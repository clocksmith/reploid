import { createP2PTransport } from '../../transport/assignment.js';
import { createMeshPeerIdentity } from '../peer-identity.js';
import { assertPartition as assert } from './partition-contract.js';

/** Manual signaling adapter with certificate-bound identities. Reuses Poolday's
 * transport and identity challenge; a signaling code grants no compute permission.
 */
export function createPartitionLink({ identity, roomId, kind, initiator, config, rtcConfig,
  timeoutMs, createEndpoint, onChange = () => {} }) {
  assert(['entry', 'stage'].includes(kind) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    'Explicit partition link kind and timeout required');
  let remoteId = null, receiver, endpoint = null, channel = null, disposed = false, codeSignals = [], connecting = null;
  const handlers = new Map(), lifetime = new AbortController();
  const signal = (type, payload) => { codeSignals.push({ type, payload }); };
  const fingerprint = description => description?.sdp?.split(/\r?\n/)
    .find(line => line.startsWith('a=fingerprint:sha-256 '))?.slice(14);
  const transport = createP2PTransport({ config, initiator, rtcConfig,
    signaling: { subscribe: fn => { receiver = fn; return () => { receiver = null; }; },
      sendOffer: payload => signal('offer', payload), sendAnswer: payload => signal('answer', payload),
      sendIceCandidate: payload => signal('ice-candidate', payload), sendClose() {} },
    onMessage: message => handlers.get(message.type)?.(remoteId, message.payload),
    onAuxiliaryChannel: accepted => {
      if (initiator || channel || accepted.label !== 'reploid-partition-' + kind) return false;
      channel = accepted; attach(channel).catch(failed); return true;
    },
    onStateChange: state => {
      if (state === 'connected' && initiator) {
        channel = transport.getPeerConnection().createDataChannel('reploid-partition-' + kind, { ordered: true });
        attach(channel).catch(failed);
      }
      if (['failed', 'closed'].includes(state)) {
        lifetime.abort(new Error('Partition link lost'));
        Promise.resolve(endpoint?.close()).catch(failed);
      }
      onChange();
    },
  });
  const peerIdentity = createMeshPeerIdentity({ transport: {
    _getPeerId: () => identity.peerId,
    getPeerBinding: () => {
      const pc = transport.getPeerConnection();
      return transport.getState() === 'connected' ? { local: fingerprint(pc.localDescription), remote: fingerprint(pc.remoteDescription) } : null;
    },
    onMessage: (type, handler) => handlers.set(type, handler),
    sendToPeer: (_peer, type, payload) => { transport.send({ type, payload }); return true; },
  }, getIdentity: () => identity, roomId, timeoutMs, maxPending: 2 });
  let error = null;
  function failed(cause) { error = String(cause.message); lifetime.abort(cause); channel?.close(); onChange(); }
  async function attach(accepted) {
    const deadline = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)]);
    const wait = (event, predicate) => new Promise((resolve, reject) => {
      const done = (error) => { accepted.removeEventListener(event, received); deadline.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
      const received = input => { if (!predicate || predicate(input)) done(); };
      const aborted = () => done(deadline.reason);
      accepted.addEventListener(event, received); deadline.addEventListener('abort', aborted, { once: true });
      if (deadline.aborted) aborted(); else if (event === 'open' && accepted.readyState === 'open') done();
    });
    const ready = initiator ? wait('message', e => e.data === 'partition-entry-ready') : wait('open');
    ready.catch(() => {});
    await wait('open');
    const verified = await peerIdentity.verify(remoteId, deadline);
    assert(verified === remoteId, 'Partition link signing identity differs from signaling code');
    if (initiator) await ready;
    deadline.throwIfAborted();
    endpoint = await createEndpoint({ channel: accepted, localParticipantId: identity.peerId, remoteParticipantId: verified, kind, initiator });
    if (!initiator) accepted.send('partition-entry-ready');
    onChange();
  }
  return Object.freeze({
    get endpoint() { return endpoint; },
    get remoteId() { return remoteId; },
    getState: () => ({ state: transport.getState(), kind, remoteId, ready: !!endpoint && !lifetime.signal.aborted, error }),
    async connect() {
      if (connecting) return connecting;
      connecting = transport.connect(); connecting.catch(failed);
      assert(transport.getPeerConnection(), 'Transport did not create its connection');
    },
    async exportCode() {
      const deadline = performance.now() + timeoutMs;
      while (!codeSignals.some(s => s.type === (initiator ? 'offer' : 'answer'))
        || transport.getPeerConnection().iceGatheringState !== 'complete') {
        lifetime.signal.throwIfAborted();
        if (performance.now() >= deadline) throw new Error('Partition signaling timed out');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return btoa(JSON.stringify({ schema: 'reploid.partition-link/v1', peerId: identity.peerId, roomId, kind, signals: codeSignals }));
    },
    acceptCode(code) {
      assert(typeof code === 'string' && code.length <= 90000, 'Invalid partition connection code');
      const packet = JSON.parse(atob(code.trim()));
      assert(packet.schema === 'reploid.partition-link/v1' && packet.roomId === roomId && packet.kind === kind
        && /^peer:[a-f0-9]{24}$/.test(packet.peerId) && packet.peerId !== identity.peerId
        && (!remoteId || remoteId === packet.peerId) && Array.isArray(packet.signals) && packet.signals.length <= 70,
      'Partition signaling identity mismatch');
      remoteId = packet.peerId;
      for (const item of packet.signals) { assert(['offer', 'answer', 'ice-candidate'].includes(item.type), 'Invalid signal'); receiver(item); }
    },
    async close() {
      if (disposed) return; disposed = true; lifetime.abort(); peerIdentity.close();
      await endpoint?.close(); await transport.close();
    },
  });
}
