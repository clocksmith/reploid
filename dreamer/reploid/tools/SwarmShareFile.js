/**
 * @fileoverview SwarmShareFile - Share a VFS file with connected swarm peers
 */

async function call(args = {}, deps = {}) {
  const { SwarmSync, VFS, SwarmTransport } = deps;

  if (!SwarmSync) throw new Error('SwarmSync not available - swarm may be disabled');
  if (!VFS) throw new Error('VFS not available');

  const path = args.path;

  if (!path) throw new Error('Missing path argument');

  // Check if file exists
  const exists = await VFS.exists(path);
  if (!exists) {
    throw new Error(`File not found: ${path}`);
  }

  // Check swarm connection
  const stats = SwarmTransport?.getStats?.() || {};
  if (stats.connectionState === 'disconnected' || !stats.transport) {
    return `Swarm not connected. Enable with localStorage.setItem('REPLOID_SWARM_ENABLED', 'true') and reload.`;
  }

  // Announce the file to peers
  const count = await SwarmSync.announceArtifact(path);

  if (count === 0) {
    return `Announced ${path} but no peers connected. Other tabs will see this file when they join.`;
  }

  return `Announced ${path} to ${count} peer(s). Peers can now request this file.`;
}

export const tool = {
  name: "SwarmShareFile",
  description: "Share a VFS file with connected swarm peers. Peers will receive an announcement and can request the file. Use SwarmListPeers to see connected peers first.",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'VFS path to share (e.g. /data/report.json, /test/myfile.txt)'
      }
    }
  },
  call
};

export default call;
