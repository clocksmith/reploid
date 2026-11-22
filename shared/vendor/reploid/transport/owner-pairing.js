export const OWNER_PAIRING_REQUEST = 'reploid:owner-pairing-request';
export const OWNER_PAIRING_RESULT = 'reploid:owner-pairing-result';
export const OWNER_PAIRING_ROOM_PATTERN = /^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i;
export const ownerParticipantId = value => typeof value === 'string' && /^peer:[0-9a-f]{24}$/.test(value);
export const ownerPairingCode = value => typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
export const ownerPairingRequestId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
export const ownerPairingRoomId = value => typeof value === 'string' && OWNER_PAIRING_ROOM_PATTERN.test(value);

/** Non-secret signaling routing marker for owner-pairing rendezvous rooms; never grants authority. */
export function ownerPairingRoomMarker(roomId) {
  if (!ownerPairingRoomId(roomId) || roomId === 'reploid-swarm-public') {
    throw Error('Owner pairing routing marker requires a valid nondefault room');
  }
  return `reploid-pairing-route-not-a-secret-v1:${roomId}`;
}
const replies = new WeakMap();

/** Send the single-use code only over a freshly verified channel to the pinned desktop. */
export async function requestOwnerPairing({ transport, verifyPeer, currentPeer, hostPeer, hostParticipantId, code,
  signal = AbortSignal.timeout(120000) }) {
  if (!ownerParticipantId(hostParticipantId) || !ownerPairingCode(code)) throw Error('Invalid owner pairing details');
  const channel = transport.getPeerBinding(hostPeer);
  if (!channel || await verifyPeer(hostPeer, signal) !== hostParticipantId) throw Error('Could not verify the paired desktop');
  const assertChannel = () => {
    signal.throwIfAborted();
    if (currentPeer(hostPeer) !== hostParticipantId) throw Error('Desktop connection changed during pairing');
  };
  assertChannel();
  const requestId = crypto.randomUUID();
  let waiting = replies.get(transport);
  if (!waiting) {
    waiting = new Map();
    replies.set(transport, waiting);
    transport.onMessage(OWNER_PAIRING_RESULT, (peer, result) => waiting.get(result?.requestId)?.(peer, result));
  }
  return new Promise((resolve, reject) => {
    const abort = () => finish(signal.reason);
    const finish = (error, result) => {
      waiting.delete(requestId);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    waiting.set(requestId, (peer, result) => {
      if (peer !== hostPeer) return;
      try {
        assertChannel();
        if (result.approved !== true) throw Error('Desktop declined owner pairing');
        finish(null, { hostParticipantId });
      } catch (error) { finish(error); }
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      assertChannel();
      if (!transport.sendToPeer(hostPeer, OWNER_PAIRING_REQUEST, { requestId, code })) throw Error('Desktop connection unavailable');
    } catch (error) { finish(error); }
  });
}
