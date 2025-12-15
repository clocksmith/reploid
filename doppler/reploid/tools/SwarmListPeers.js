/**
 * @fileoverview SwarmListPeers - List connected swarm peers and connection status
 */

async function call(args = {}, deps = {}) {
  const { SwarmTransport, SwarmSync } = deps;

  if (!SwarmTransport) {
    return `SwarmTransport not available. Swarm may be disabled. Enable with localStorage.setItem('REPLOID_SWARM_ENABLED', 'true') and reload.`;
  }

  const stats = SwarmTransport.getStats();
  const syncStats = SwarmSync?.getStats?.() || {};

  // Check if swarm is enabled
  if (stats.connectionState === 'disconnected' || !stats.transport) {
    return `Swarm not connected.

To enable swarm mode:
1. Run: localStorage.setItem('REPLOID_SWARM_ENABLED', 'true')
2. Reload the page
3. Open another tab with the same room (use ?swarm=<room> parameter)

Current state: ${stats.connectionState || 'disconnected'}`;
  }

  const peers = SwarmTransport.getConnectedPeers();

  let result = `Swarm Status:
- Transport: ${stats.transport}
- Connection: ${stats.connectionState}
- Room: ${stats.roomId || 'unknown'}
- My Peer ID: ${stats.peerId || 'unknown'}
- Synced entries: ${syncStats.syncedEntries || 0}
- Active transfers: ${syncStats.activeTransfers || 0}

`;

  if (peers.length === 0) {
    result += `No peers connected yet.

To connect another tab:
1. Open a new browser tab
2. Navigate to the same URL with ?swarm=<same-room>
3. Or use the default local room for same-browser tabs`;
  } else {
    result += `Connected Peers (${peers.length}):\n`;
    for (const peer of peers) {
      const lastSeen = peer.lastSeen ? new Date(peer.lastSeen).toISOString() : 'unknown';
      result += `- ${peer.id} (last seen: ${lastSeen})\n`;
    }
    result += `\nUse SwarmShareFile to share files with these peers.`;
  }

  return result;
}

export const tool = {
  name: "SwarmListPeers",
  description: "List all connected swarm peers and show connection status. Use this before SwarmShareFile or SwarmRequestFile to see available peers.",
  inputSchema: {
    type: 'object',
    properties: {}
  },
  call
};

export default call;
