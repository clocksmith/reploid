/**
 * @fileoverview SwarmGetStatus - Get detailed swarm connection status
 */

async function call(args = {}, deps = {}) {
  const { SwarmTransport, SwarmSync } = deps;

  if (!SwarmTransport) {
    return JSON.stringify({
      enabled: false,
      error: 'SwarmTransport not available',
      hint: 'Enable with localStorage.setItem("REPLOID_SWARM_ENABLED", "true") and reload'
    }, null, 2);
  }

  const stats = SwarmTransport.getStats();
  const syncStats = SwarmSync?.getStats?.() || {};
  const peers = SwarmTransport.getConnectedPeers();

  const status = {
    enabled: stats.connectionState !== 'disconnected' && !!stats.transport,
    transport: stats.transport || null,
    connectionState: stats.connectionState || 'disconnected',
    peerId: stats.peerId || null,
    roomId: stats.roomId || null,
    connectedPeers: peers.length,
    peerIds: peers.map(p => p.id),
    sync: {
      syncedEntries: syncStats.syncedEntries || 0,
      pendingTransfers: syncStats.pendingTransfers || 0,
      activeTransfers: syncStats.activeTransfers || 0
    },
    clock: stats.clock || 0
  };

  return JSON.stringify(status, null, 2);
}

export const tool = {
  name: "SwarmGetStatus",
  description: "Get detailed swarm connection status and statistics as JSON. Useful for debugging swarm connectivity issues.",
  inputSchema: {
    type: 'object',
    properties: {}
  },
  call
};

export default call;
