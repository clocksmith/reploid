/**
 * @fileoverview SwarmRequestFile - Request a file from a connected peer
 */

async function call(args = {}, deps = {}) {
  const { SwarmSync, SwarmTransport } = deps;

  if (!SwarmSync) throw new Error('SwarmSync not available - swarm may be disabled');
  if (!SwarmTransport) throw new Error('SwarmTransport not available');

  const { peerId, path } = args;

  if (!peerId) throw new Error('Missing peerId argument - use SwarmListPeers to find peer IDs');
  if (!path) throw new Error('Missing path argument - the VFS path as announced by the peer');

  // Check swarm connection
  const stats = SwarmTransport.getStats();
  if (stats.connectionState === 'disconnected' || !stats.transport) {
    return `Swarm not connected. Enable with localStorage.setItem('REPLOID_SWARM_ENABLED', 'true') and reload.`;
  }

  // Verify peer exists
  const peers = SwarmTransport.getConnectedPeers();
  const peerExists = peers.some(p => p.id === peerId);
  if (!peerExists) {
    const peerList = peers.map(p => p.id).join(', ') || 'none';
    return `Peer ${peerId} not found. Connected peers: ${peerList}`;
  }

  // Request the file
  const requested = SwarmSync.requestArtifact(peerId, path);

  if (!requested) {
    return `Request failed - transfer may already be in progress or max concurrent transfers reached.`;
  }

  // Build the target path where file will be saved
  const targetPath = `/shared${path.startsWith('/') ? '' : '/'}${path}`;

  return `Requested ${path} from peer ${peerId}. File will be saved to ${targetPath} when transfer completes.`;
}

export const tool = {
  name: "SwarmRequestFile",
  description: "Request a file from a connected swarm peer. Use SwarmListPeers to find peer IDs. The file will be automatically saved to /shared/ when received.",
  inputSchema: {
    type: 'object',
    required: ['peerId', 'path'],
    properties: {
      peerId: {
        type: 'string',
        description: 'ID of the peer to request from (get from SwarmListPeers)'
      },
      path: {
        type: 'string',
        description: 'Path of the file to request (as announced by peer, e.g. /test/myfile.txt)'
      }
    }
  },
  call
};

export default call;
