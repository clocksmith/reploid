// Find the connection that belongs to one specific computer, proven by its signed identity.
// Shared by owner pairing and guest join so both trust a host the same way.

const PEER_POLL_MS = 40;

export const waitFor = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(signal.reason);
  }
  signal?.addEventListener('abort', onAbort, { once: true });
});

const candidatePeers = channel => {
  const peers = typeof channel.getPeers === 'function' ? channel.getPeers() : [];
  const connected = typeof channel.transport?.getConnectedPeers === 'function'
    ? channel.transport.getConnectedPeers().map(peer => peer.id) : [];
  return { peers, ids: [...new Set([...peers.map(peer => peer.peerId), ...connected])] };
};

/** An already verified connection to the host on this channel, with its path and ready model, or null. */
export function resolveVerifiedPeer(channel, hostParticipantId) {
  if (!channel?.transport) return null;
  const { peers, ids } = candidatePeers(channel);
  const states = typeof channel.getPeerStates === 'function' ? channel.getPeerStates() : [];
  for (const peerId of ids) {
    if (!channel.transport.getPeerBinding?.(peerId)) continue;
    if (channel.currentPeer?.(peerId) !== hostParticipantId) continue;
    const peerInfo = peers.find(peer => peer.peerId === peerId) || null;
    const linkState = states.find(item => item.id === peerId) || null;
    return {
      hostPeer: peerId,
      transportPath: linkState?.path || 'connected',
      readyModel: peerInfo?.readiness === 'ready' ? (peerInfo.model || null) : null
    };
  }
  return null;
}

/**
 * Wait up to waitMs for a connection whose verified identity is the host, checking each new binding once.
 * Nothing secret is sent while searching; callers send their code or token only to the returned peer.
 */
export async function findVerifiedHostPeer({ getChannel, channel, hostParticipantId, targetRoomId = null, signal, waitMs,
  now = Date.now, isClosed = () => false, unavailable = 'Connection unavailable', notFound = 'Could not find the verified computer on this connection. Confirm it is online and retry.' }) {
  const deadline = now() + Math.max(0, waitMs);
  const checkedBindings = new Map();
  while (!isClosed()) {
    signal.throwIfAborted();
    const active = getChannel() || channel;
    if (!active?.transport) throw new Error(unavailable);
    if (targetRoomId && active.roomId && active.roomId !== targetRoomId) {
      throw new Error('Swarm connection moved away from the requested room');
    }
    const existing = resolveVerifiedPeer(active, hostParticipantId);
    if (existing) return { channel: active, hostPeer: existing.hostPeer };
    for (const peerId of candidatePeers(active).ids) {
      signal.throwIfAborted();
      const binding = active.transport?.getPeerBinding?.(peerId);
      if (!binding) continue;
      const bindingKey = JSON.stringify(binding);
      if (checkedBindings.get(peerId) === bindingKey) continue;
      checkedBindings.set(peerId, bindingKey);
      try {
        if (await active.verifyPeer(peerId, signal) === hostParticipantId) return { channel: active, hostPeer: peerId };
      } catch { /* Keep checking other connected peers without disclosing anything. */ }
    }
    if (now() >= deadline) break;
    await waitFor(Math.min(PEER_POLL_MS, Math.max(1, deadline - now())), signal);
  }
  throw new Error(notFound);
}
