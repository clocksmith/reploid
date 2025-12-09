/**
 * @fileoverview Swarm State Synchronization
 * Last-Writer-Wins merge with Lamport timestamps for goals, reflections, and artifacts.
 * Supports artifact chunking and pull-based transfer.
 */

const MAX_ARTIFACT_SIZE = 256 * 1024; // 256KB
const CHUNK_SIZE = 32 * 1024; // 32KB
const MAX_CONCURRENT_TRANSFERS = 3;
const TRANSFER_TIMEOUT = 30000; // 30s

const SwarmSync = {
  metadata: {
    id: 'SwarmSync',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'WebRTCSwarm', 'StateManager', 'ReflectionStore'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, WebRTCSwarm, StateManager, ReflectionStore } = deps;
    const { logger, generateId } = Utils;

    // LWW State Store: id -> { value, clock, peerId, updatedAt }
    const _syncedState = new Map();

    // Artifact transfer tracking
    const _pendingTransfers = new Map(); // transferId -> { chunks, received, timeout }
    const _activeTransfers = new Set(); // peerId:artifactId

    /**
     * LWW Merge - returns winner
     */
    const merge = (local, remote) => {
      // Remote has higher clock - remote wins
      if (remote.clock > local.clock) {
        return { winner: 'remote', value: remote };
      }
      // Local has higher clock - local wins
      if (remote.clock < local.clock) {
        return { winner: 'local', value: local };
      }
      // Same clock - lexicographic tiebreak on peerId
      if (remote.peerId > local.peerId) {
        return { winner: 'remote', value: remote };
      }
      return { winner: 'local', value: local };
    };

    /**
     * Create LWW entry with incremented clock
     */
    const createEntry = (id, value) => {
      return {
        id,
        value,
        clock: WebRTCSwarm.tick(), // Increment clock on local write
        peerId: WebRTCSwarm._getPeerId(),
        updatedAt: Date.now(),
        sharedFrom: null
      };
    };

    /**
     * Set local state (increments clock)
     */
    const setLocal = (id, value) => {
      const entry = createEntry(id, value);
      _syncedState.set(id, entry);

      // Broadcast update
      WebRTCSwarm.broadcast('goal-update', {
        id,
        value,
        clock: entry.clock,
        peerId: entry.peerId,
        updatedAt: entry.updatedAt
      });

      EventBus.emit('swarm:state-updated', { id, entry, source: 'local' });
      return entry;
    };

    /**
     * Apply remote state with LWW merge
     */
    const applyRemote = (id, remoteEntry) => {
      const local = _syncedState.get(id);

      if (!local) {
        // No local entry - accept remote
        const entry = {
          ...remoteEntry,
          sharedFrom: remoteEntry.peerId
        };
        _syncedState.set(id, entry);
        EventBus.emit('swarm:state-updated', { id, entry, source: 'remote' });
        return { accepted: true, entry };
      }

      // Merge with existing
      const { winner, value } = merge(local, remoteEntry);

      if (winner === 'remote') {
        const entry = {
          ...remoteEntry,
          sharedFrom: remoteEntry.peerId
        };
        _syncedState.set(id, entry);
        EventBus.emit('swarm:state-updated', { id, entry, source: 'remote' });
        return { accepted: true, entry };
      }

      return { accepted: false, entry: local };
    };

    /**
     * Get synced state
     */
    const get = (id) => {
      return _syncedState.get(id);
    };

    /**
     * Get all synced state
     */
    const getAll = () => {
      return Array.from(_syncedState.values());
    };

    /**
     * Initialize sync handlers
     */
    const init = async () => {
      // Register WebRTC message handlers
      WebRTCSwarm.onMessage('sync-request', handleSyncRequest);
      WebRTCSwarm.onMessage('sync-response', handleSyncResponse);
      WebRTCSwarm.onMessage('goal-update', handleGoalUpdate);
      WebRTCSwarm.onMessage('reflection-share', handleReflectionShare);
      WebRTCSwarm.onMessage('artifact-announce', handleArtifactAnnounce);
      WebRTCSwarm.onMessage('artifact-request', handleArtifactRequest);
      WebRTCSwarm.onMessage('artifact-chunk', handleArtifactChunk);
      WebRTCSwarm.onMessage('artifact-ack', handleArtifactAck);

      // Subscribe to local state changes to auto-sync
      EventBus.on('goal:set', (data) => {
        logger.debug('[SwarmSync] Goal set, syncing to swarm');
        setLocal(data.id, { type: 'goal', goal: data.goal, timestamp: data.timestamp });
      }, 'SwarmSync');

      EventBus.on('reflection:added', (reflection) => {
        // Avoid re-broadcasting reflections that were already shared from a peer
        const fromPeer = reflection?.context?.sharedFrom ||
          (reflection?.tags || []).find(tag => tag.startsWith('shared_from_'));
        if (fromPeer) {
          logger.debug(`[SwarmSync] Skipping shared reflection from ${fromPeer}`);
          return;
        }
        logger.debug('[SwarmSync] Reflection added, sharing with swarm');
        shareReflection(reflection);
      }, 'SwarmSync');

      logger.info('[SwarmSync] Initialized with auto-sync for goals and reflections');
      return true;
    };

    /**
     * Handle sync request - send full state snapshot
     */
    const handleSyncRequest = (peerId, payload) => {
      logger.info(`[SwarmSync] Sync request from ${peerId}`);

      const snapshot = {
        state: Array.from(_syncedState.entries()),
        timestamp: Date.now()
      };

      WebRTCSwarm.sendToPeer(peerId, 'sync-response', snapshot);
    };

    /**
     * Handle sync response - merge incoming state
     */
    const handleSyncResponse = (peerId, payload) => {
      logger.info(`[SwarmSync] Sync response from ${peerId}: ${payload.state?.length || 0} entries`);

      for (const [id, entry] of (payload.state || [])) {
        applyRemote(id, entry);
      }

      EventBus.emit('swarm:sync-complete', { peerId, count: payload.state?.length || 0 });
    };

    /**
     * Handle goal update
     */
    const handleGoalUpdate = (peerId, payload) => {
      const { id, value, clock, updatedAt } = payload;

      logger.debug(`[SwarmSync] Goal update from ${peerId}: ${id}`);

      applyRemote(id, {
        id,
        value,
        clock,
        peerId,
        updatedAt
      });
    };

    /**
     * Handle reflection share
     */
    const handleReflectionShare = async (peerId, payload) => {
      const { reflection } = payload;

      if (!reflection || !reflection.content) {
        logger.warn(`[SwarmSync] Invalid reflection from ${peerId}`);
        return;
      }

      logger.info(`[SwarmSync] Reflection from ${peerId}: ${reflection.type}`);

      // Add to local reflection store with provenance
      try {
        await ReflectionStore.add({
          ...reflection,
          tags: [...(reflection.tags || []), `shared_from_${peerId}`],
          context: {
            ...reflection.context,
            sharedFrom: peerId,
            sharedAt: Date.now()
          }
        });

        EventBus.emit('swarm:reflection-received', { peerId, reflection });
      } catch (e) {
        logger.error(`[SwarmSync] Failed to store shared reflection:`, e);
      }
    };

    /**
     * Share a reflection with the swarm
     */
    const shareReflection = (reflection) => {
      const count = WebRTCSwarm.broadcast('reflection-share', { reflection });
      logger.info(`[SwarmSync] Shared reflection with ${count} peers`);
      return count;
    };

    /**
     * Announce artifact availability (pull model)
     */
    const announceArtifact = async (artifactId) => {
      try {
        const metadata = await StateManager.getArtifactMetadata(artifactId);
        if (!metadata) {
          logger.warn(`[SwarmSync] Artifact not found: ${artifactId}`);
          return 0;
        }

        const content = await StateManager.getArtifactContent(artifactId);
        const size = content?.length || 0;

        if (size > MAX_ARTIFACT_SIZE) {
          logger.warn(`[SwarmSync] Artifact too large to share: ${size} > ${MAX_ARTIFACT_SIZE}`);
          return 0;
        }

        const count = WebRTCSwarm.broadcast('artifact-announce', {
          id: artifactId,
          name: metadata.name,
          type: metadata.type,
          size,
          hash: simpleHash(content)
        });

        logger.info(`[SwarmSync] Announced artifact ${artifactId} to ${count} peers`);
        return count;
      } catch (e) {
        logger.error(`[SwarmSync] Failed to announce artifact:`, e);
        return 0;
      }
    };

    /**
     * Handle artifact announcement
     */
    const handleArtifactAnnounce = (peerId, payload) => {
      const { id, name, type, size, hash } = payload;

      logger.info(`[SwarmSync] Artifact announced from ${peerId}: ${name} (${size} bytes)`);

      // Check if we already have it
      // For now, always request if we don't have it locally
      EventBus.emit('swarm:artifact-available', {
        peerId,
        id,
        name,
        type,
        size,
        hash
      });
    };

    // Request timeouts: transferKey -> timeoutId
    const _requestTimeouts = new Map();

    /**
     * Request artifact from peer
     */
    const requestArtifact = (peerId, artifactId) => {
      const transferKey = `${peerId}:${artifactId}`;

      if (_activeTransfers.size >= MAX_CONCURRENT_TRANSFERS) {
        logger.warn(`[SwarmSync] Too many concurrent transfers, queuing ${artifactId}`);
        return false;
      }

      if (_activeTransfers.has(transferKey)) {
        logger.warn(`[SwarmSync] Transfer already in progress: ${transferKey}`);
        return false;
      }

      _activeTransfers.add(transferKey);

      // Set request-side timeout to clean up if peer never responds
      const timeoutId = setTimeout(() => {
        if (_activeTransfers.has(transferKey)) {
          logger.warn(`[SwarmSync] Artifact request timeout: ${transferKey}`);
          _activeTransfers.delete(transferKey);
          _requestTimeouts.delete(transferKey);
          EventBus.emit('swarm:artifact-timeout', { peerId, artifactId });
        }
      }, TRANSFER_TIMEOUT);
      _requestTimeouts.set(transferKey, timeoutId);

      WebRTCSwarm.sendToPeer(peerId, 'artifact-request', { id: artifactId });
      logger.info(`[SwarmSync] Requested artifact ${artifactId} from ${peerId}`);

      return true;
    };

    /**
     * Handle artifact request
     */
    const handleArtifactRequest = async (peerId, payload) => {
      const { id } = payload;

      logger.info(`[SwarmSync] Artifact request from ${peerId}: ${id}`);

      try {
        const content = await StateManager.getArtifactContent(id);
        if (!content) {
          logger.warn(`[SwarmSync] Requested artifact not found: ${id}`);
          return;
        }

        if (content.length > MAX_ARTIFACT_SIZE) {
          logger.warn(`[SwarmSync] Artifact too large: ${content.length}`);
          return;
        }

        // Chunk and send
        const chunks = chunkData(content);
        const transferId = generateId('xfer');

        for (let i = 0; i < chunks.length; i++) {
          WebRTCSwarm.sendToPeer(peerId, 'artifact-chunk', {
            transferId,
            artifactId: id,
            seq: i,
            total: chunks.length,
            data: chunks[i]
          });
        }

        logger.info(`[SwarmSync] Sent artifact ${id} in ${chunks.length} chunks`);
      } catch (e) {
        logger.error(`[SwarmSync] Failed to send artifact:`, e);
      }
    };

    /**
     * Handle artifact chunk
     */
    const handleArtifactChunk = (peerId, payload) => {
      const { transferId, artifactId, seq, total, data } = payload;
      const transferKey = `${peerId}:${artifactId}`;

      // Clear request timeout since we got a response
      const requestTimeout = _requestTimeouts.get(transferKey);
      if (requestTimeout) {
        clearTimeout(requestTimeout);
        _requestTimeouts.delete(transferKey);
      }

      let transfer = _pendingTransfers.get(transferId);

      if (!transfer) {
        // New transfer
        transfer = {
          artifactId,
          chunks: new Array(total),
          received: 0,
          total,
          timeout: setTimeout(() => {
            logger.warn(`[SwarmSync] Transfer timeout: ${transferId}`);
            _pendingTransfers.delete(transferId);
            _activeTransfers.delete(transferKey);
          }, TRANSFER_TIMEOUT)
        };
        _pendingTransfers.set(transferId, transfer);
      }

      // Store chunk
      if (!transfer.chunks[seq]) {
        transfer.chunks[seq] = data;
        transfer.received++;
      }

      // Send ack
      WebRTCSwarm.sendToPeer(peerId, 'artifact-ack', {
        transferId,
        seq
      });

      // Check if complete
      if (transfer.received === transfer.total) {
        clearTimeout(transfer.timeout);
        _pendingTransfers.delete(transferId);
        _activeTransfers.delete(`${peerId}:${artifactId}`);

        // Reassemble
        const content = transfer.chunks.join('');

        logger.info(`[SwarmSync] Artifact transfer complete: ${artifactId} (${content.length} bytes)`);

        EventBus.emit('swarm:artifact-received', {
          peerId,
          artifactId,
          content,
          sharedFrom: peerId
        });
      }
    };

    /**
     * Handle artifact ack
     */
    const handleArtifactAck = (peerId, payload) => {
      // Could track delivery confirmation if needed
      logger.debug(`[SwarmSync] Chunk ack from ${peerId}: ${payload.seq}`);
    };

    /**
     * Chunk data into pieces
     */
    const chunkData = (data) => {
      const chunks = [];
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        chunks.push(data.slice(i, i + CHUNK_SIZE));
      }
      return chunks;
    };

    /**
     * Simple hash for content verification
     */
    const simpleHash = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(16);
    };

    /**
     * Get sync stats
     */
    const getStats = () => ({
      syncedEntries: _syncedState.size,
      pendingTransfers: _pendingTransfers.size,
      activeTransfers: _activeTransfers.size
    });

    return {
      init,
      setLocal,
      applyRemote,
      get,
      getAll,
      merge,
      shareReflection,
      announceArtifact,
      requestArtifact,
      getStats
    };
  }
};

export default SwarmSync;
