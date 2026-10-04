import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { assertPartition as assert } from './partition-contract.js';

/** Owns bounded capability observation, never placement, loading or permission. */
export function createPartitionDiscovery({ identity, catalog, policy, peers, createNetwork,
  describe, onChange = () => {}, now = Date.now }) {
  const connections = new Map(), lifetime = new AbortController();
  let refreshing = null, closed = false;
  const snapshot = () => [...connections.entries()].map(([transportId, peer]) => {
    const expiresAt = peer.observedAt + policy.inputLimits.descriptorTtlMs;
    return { transportId, participantId: peer.participantId, observedAt: peer.observedAt,
      expiresAt, available: !closed && !!peer.description && now() < expiresAt,
      reason: closed ? 'closed' : !peer.description ? peer.reason || 'unobserved'
        : now() >= expiresAt ? 'expired' : 'observed', description: structuredClone(peer.description) };
  });
  const notify = () => onChange(snapshot());
  const network = createNetwork({ label: 'reploid-partitions-control',
    maxPeers: policy.maxPeers, timeoutMs: policy.connectTimeoutMs,
    createEndpoint: ({ channel, remoteParticipantId }) => {
      const endpoint = createPartitionDataChannel({ channel, localParticipantId: identity.peerId,
        remoteParticipantId, limits: policy.controlChannel,
        authorize: async ({ metadata, byteLength }) => metadata.operation === 'describe' && byteLength === 0,
        serve: async () => structuredClone(describe()) });
      const peer = { endpoint, participantId: remoteParticipantId, description: null, observedAt: 0,
        close: () => endpoint.close() };
      channel.addEventListener('close', () => {
        for (const [id, value] of connections) if (value === peer) connections.delete(id);
        notify();
      }, { once: true });
      return peer;
    },
    onPeer(transportId, peer) { if (!closed) connections.set(transportId, peer); }
  });
  return Object.freeze({
    getSnapshot: snapshot,
    getModels: () => snapshot().filter(peer => peer.available).flatMap(peer => peer.description.models),
    refresh() {
      if (closed) return Promise.resolve(snapshot());
      if (refreshing) return refreshing;
      refreshing = (async () => {
        for (const peer of peers().slice(0, policy.maxPeers)) {
          if (closed) break;
          if (!connections.has(peer.id) && peer.localTransportId < peer.id) {
            try { await network.connect(peer.id); } catch { /* The next bounded refresh may retry. */ }
          }
        }
        await Promise.allSettled([...connections.values()].map(async peer => {
          try {
            const description = await peer.endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal: lifetime.signal });
            assert(description.participantId === peer.participantId && Array.isArray(description.models)
              && description.models.length <= catalog.length && [null, 0, 1].includes(description.index)
              && ['idle', 'waiting', 'loading', 'ready', 'failed'].includes(description.phase),
            'Partition capability identity or inventory mismatch');
            if (!closed) { peer.description = structuredClone(description); peer.observedAt = now(); peer.reason = null; }
          } catch { peer.description = null; peer.reason = 'description-unavailable'; }
        }));
        notify(); return snapshot();
      })().finally(() => { refreshing = null; });
      return refreshing;
    },
    async close() {
      if (closed) return; closed = true; lifetime.abort(new Error('Partition discovery closed'));
      await network.close(); await refreshing; connections.clear();
    }
  });
}
