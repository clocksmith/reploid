/**
 * @fileoverview Swarm Transport Abstraction
 * Auto-selects between BroadcastChannel (same browser, no server) and WebRTC (cross-machine).
 * Provides a unified interface for SwarmSync regardless of underlying transport.
 */

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB

// Valid message types
const MESSAGE_TYPES = new Set([
  'sync-request', 'sync-response',
  'goal-update', 'reflection-share',
  'artifact-announce', 'artifact-request', 'artifact-chunk', 'artifact-ack',
  'ping', 'pong', 'peer-announce', 'peer-leave',
  'raft:request-vote', 'raft:request-vote-response',
  'raft:append-entries', 'raft:append-entries-response',
  'raft:client-request', 'raft:client-response',
  'fl:hello', 'fl:round-start', 'fl:update', 'fl:round-commit', 'fl:round-failed'
]);

const SwarmTransport = {
  metadata: {
    id: 'SwarmTransport',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, generateId } = Utils;

    // State
    let _peerId = null;
    let _roomId = null;
    let _transport = null; // 'broadcast' | 'webrtc'
    let _broadcastChannel = null;
    let _webrtcSwarm = null; // Reference to WebRTCSwarm if using WebRTC
    let _messageHandlers = new Map();
    let _logicalClock = 0;
    let _peers = new Map(); // peerId -> { lastSeen, metadata }
    let _connectionState = 'disconnected';

    // Peer timeout for BroadcastChannel (no heartbeat from server)
    const PEER_TIMEOUT = 60000;
    const ANNOUNCE_INTERVAL = 15000;
    let _announceTimer = null;
    let _cleanupTimer = null;

    /**
     * Generate UUID v4
     */
    const uuid = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    };

    /**
     * Increment logical clock
     */
    const tick = () => ++_logicalClock;

    /**
     * Update clock on receive
     */
    const updateClock = (remoteClock) => {
      _logicalClock = Math.max(_logicalClock, remoteClock) + 1;
    };

    /**
     * Get room ID from URL param or default
     */
    const getRoomId = () => {
      if (typeof window === 'undefined') return 'reploid-swarm-default';

      const urlParams = new URLSearchParams(window.location.search);
      const swarmParam = urlParams.get('swarm');

      if (swarmParam && swarmParam !== 'true') {
        return `reploid-swarm-${swarmParam}`;
      }

      // Default room for same-browser tabs
      return 'reploid-swarm-local';
    };

    /**
     * Check if swarm is enabled
     */
    const isEnabled = () => {
      if (typeof window === 'undefined') return false;

      const urlParams = new URLSearchParams(window.location.search);
      const swarmParam = urlParams.get('swarm');
      if (swarmParam) return true;

      return localStorage.getItem('REPLOID_SWARM_ENABLED') === 'true';
    };

    /**
     * Check if signaling server is available
     */
    const checkSignalingServer = async () => {
      if (typeof window === 'undefined') return false;

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/signaling`;

        // Quick WebSocket probe with timeout
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 2000);

          try {
            const ws = new WebSocket(url);
            ws.onopen = () => {
              clearTimeout(timeout);
              ws.close();
              resolve(true);
            };
            ws.onerror = () => {
              clearTimeout(timeout);
              resolve(false);
            };
          } catch {
            clearTimeout(timeout);
            resolve(false);
          }
        });
      } catch {
        return false;
      }
    };

    /**
     * Validate message envelope
     */
    const validateEnvelope = (envelope) => {
      if (!envelope || typeof envelope !== 'object') {
        return { valid: false, reason: 'Invalid envelope format' };
      }
      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        return { valid: false, reason: `Protocol version mismatch: ${envelope.protocolVersion}` };
      }
      if (!MESSAGE_TYPES.has(envelope.type)) {
        return { valid: false, reason: `Unknown message type: ${envelope.type}` };
      }
      if (!envelope.peerId || typeof envelope.peerId !== 'string') {
        return { valid: false, reason: 'Missing or invalid peerId' };
      }
      return { valid: true };
    };

    /**
     * Wrap message in protocol envelope
     */
    const wrapMessage = (type, payload) => {
      const payloadStr = JSON.stringify(payload || {});
      if (payloadStr.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Payload exceeds max size: ${payloadStr.length} > ${MAX_PAYLOAD_SIZE}`);
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        type,
        peerId: _peerId,
        roomId: _roomId,
        timestamp: tick(),
        payload: payload || {},
        payloadSize: payloadStr.length
      };
    };

    // =========================================
    // BroadcastChannel Transport
    // =========================================

    /**
     * Initialize BroadcastChannel transport
     */
    const initBroadcastChannel = () => {
      _transport = 'broadcast';
      _broadcastChannel = new BroadcastChannel(_roomId);

      _broadcastChannel.onmessage = (event) => {
        handleBroadcastMessage(event.data);
      };

      _connectionState = 'connected';
      EventBus.emit('swarm:state-change', { state: _connectionState, transport: 'broadcast' });

      // Announce presence
      broadcastRaw({ type: 'peer-announce', peerId: _peerId, timestamp: Date.now() });

      // Periodic announce for peer discovery
      _announceTimer = setInterval(() => {
        broadcastRaw({ type: 'peer-announce', peerId: _peerId, timestamp: Date.now() });
      }, ANNOUNCE_INTERVAL);

      // Cleanup stale peers
      _cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [peerId, peer] of _peers) {
          if (now - peer.lastSeen > PEER_TIMEOUT) {
            logger.debug(`[SwarmTransport] Peer timeout: ${peerId}`);
            _peers.delete(peerId);
            EventBus.emit('swarm:peer-left', { peerId });
          }
        }
      }, PEER_TIMEOUT / 2);

      logger.info(`[SwarmTransport] BroadcastChannel initialized for room: ${_roomId}`);
      return true;
    };

    /**
     * Send raw message via BroadcastChannel (for internal use)
     */
    const broadcastRaw = (message) => {
      if (_broadcastChannel) {
        _broadcastChannel.postMessage(message);
      }
    };

    /**
     * Handle incoming BroadcastChannel message
     */
    const handleBroadcastMessage = (data) => {
      // Handle peer announce (not wrapped in envelope)
      if (data.type === 'peer-announce') {
        if (data.peerId !== _peerId) {
          const isNew = !_peers.has(data.peerId);
          _peers.set(data.peerId, { lastSeen: Date.now(), metadata: {} });

          if (isNew) {
            logger.info(`[SwarmTransport] Peer discovered: ${data.peerId}`);
            EventBus.emit('swarm:peer-joined', { peerId: data.peerId });

            // Announce back so they know about us
            broadcastRaw({ type: 'peer-announce', peerId: _peerId, timestamp: Date.now() });
          }
        }
        return;
      }

      if (data.type === 'peer-leave') {
        if (data.peerId !== _peerId && _peers.has(data.peerId)) {
          _peers.delete(data.peerId);
          EventBus.emit('swarm:peer-left', { peerId: data.peerId });
        }
        return;
      }

      // Validate envelope
      const validation = validateEnvelope(data);
      if (!validation.valid) {
        logger.debug(`[SwarmTransport] Invalid message: ${validation.reason}`);
        return;
      }

      // Ignore own messages
      if (data.peerId === _peerId) return;

      // Ignore messages for other rooms
      if (data.roomId && data.roomId !== _roomId) return;

      // Update peer tracking
      _peers.set(data.peerId, { lastSeen: Date.now(), metadata: {} });

      // Update clock
      updateClock(data.timestamp);

      // Route to handler
      const handler = _messageHandlers.get(data.type);
      if (handler) {
        try {
          handler(data.peerId, data.payload, data);
        } catch (e) {
          logger.error(`[SwarmTransport] Handler error for ${data.type}:`, e);
        }
      }

      // Emit event
      EventBus.emit(`swarm:message:${data.type}`, {
        peerId: data.peerId,
        payload: data.payload,
        timestamp: data.timestamp
      });
    };

    // =========================================
    // WebRTC Transport (delegates to WebRTCSwarm)
    // =========================================

    /**
     * Initialize WebRTC transport via existing WebRTCSwarm
     */
    const initWebRTC = async () => {
      _transport = 'webrtc';

      // WebRTCSwarm should already be initialized by boot.js
      // We just need to wire up our handlers
      try {
        // Import dynamically to avoid circular dependency
        const container = window.__REPLOID_CONTAINER__;
        if (container) {
          _webrtcSwarm = await container.resolve('WebRTCSwarm');

          // Mirror state from WebRTCSwarm
          _peerId = _webrtcSwarm._getPeerId();
          _connectionState = _webrtcSwarm.getConnectionState();

          logger.info(`[SwarmTransport] Using WebRTC transport via WebRTCSwarm`);
          return true;
        }
      } catch (e) {
        logger.warn(`[SwarmTransport] WebRTCSwarm not available, falling back to BroadcastChannel`);
      }

      return false;
    };

    // =========================================
    // Unified Public API
    // =========================================

    /**
     * Initialize transport - auto-selects best option
     */
    const init = async () => {
      if (!isEnabled()) {
        logger.info('[SwarmTransport] Disabled (add ?swarm=true or ?swarm=<room> to URL)');
        return false;
      }

      _peerId = generateId('peer');
      _roomId = getRoomId();

      logger.info(`[SwarmTransport] Initializing - peerId: ${_peerId}, room: ${_roomId}`);

      // Check if signaling server is available
      const hasSignaling = await checkSignalingServer();

      if (hasSignaling) {
        // Try WebRTC first if server is available
        const webrtcOk = await initWebRTC();
        if (webrtcOk) {
          logger.info('[SwarmTransport] Using WebRTC transport (signaling server available)');
          return true;
        }
      }

      // Fall back to BroadcastChannel (same browser only)
      if (typeof BroadcastChannel !== 'undefined') {
        initBroadcastChannel();
        logger.info('[SwarmTransport] Using BroadcastChannel transport (same browser)');
        return true;
      }

      logger.warn('[SwarmTransport] No transport available');
      return false;
    };

    /**
     * Send message to specific peer
     */
    const sendToPeer = (remotePeerId, type, payload) => {
      if (_transport === 'webrtc' && _webrtcSwarm) {
        return _webrtcSwarm.sendToPeer(remotePeerId, type, payload);
      }

      if (_transport === 'broadcast' && _broadcastChannel) {
        // BroadcastChannel is inherently broadcast, but we can add target filtering
        const envelope = wrapMessage(type, payload);
        envelope.targetPeer = remotePeerId; // Receiver can filter
        _broadcastChannel.postMessage(envelope);
        return true;
      }

      return false;
    };

    /**
     * Broadcast message to all peers
     */
    const broadcast = (type, payload) => {
      if (_transport === 'webrtc' && _webrtcSwarm) {
        return _webrtcSwarm.broadcast(type, payload);
      }

      if (_transport === 'broadcast' && _broadcastChannel) {
        const envelope = wrapMessage(type, payload);
        _broadcastChannel.postMessage(envelope);
        return _peers.size; // Approximate count
      }

      return 0;
    };

    /**
     * Register message handler
     */
    const onMessage = (type, handler) => {
      _messageHandlers.set(type, handler);

      // Also register with WebRTCSwarm if using it
      if (_transport === 'webrtc' && _webrtcSwarm) {
        _webrtcSwarm.onMessage(type, handler);
      }
    };

    /**
     * Get connected peers
     */
    const getConnectedPeers = () => {
      if (_transport === 'webrtc' && _webrtcSwarm) {
        return _webrtcSwarm.getConnectedPeers();
      }

      return Array.from(_peers.entries()).map(([id, peer]) => ({
        id,
        metadata: peer.metadata,
        lastSeen: peer.lastSeen
      }));
    };

    /**
     * Get connection state
     */
    const getConnectionState = () => _connectionState;

    /**
     * Get transport type
     */
    const getTransportType = () => _transport;

    /**
     * Get logical clock
     */
    const getClock = () => _logicalClock;

    /**
     * Disconnect and cleanup
     */
    const disconnect = () => {
      if (_announceTimer) {
        clearInterval(_announceTimer);
        _announceTimer = null;
      }

      if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
      }

      if (_broadcastChannel) {
        broadcastRaw({ type: 'peer-leave', peerId: _peerId });
        _broadcastChannel.close();
        _broadcastChannel = null;
      }

      if (_webrtcSwarm) {
        _webrtcSwarm.disconnect();
        _webrtcSwarm = null;
      }

      _peers.clear();
      _connectionState = 'disconnected';
      _transport = null;

      EventBus.emit('swarm:state-change', { state: _connectionState });
    };

    /**
     * Get stats
     */
    const getStats = () => {
      if (_transport === 'webrtc' && _webrtcSwarm) {
        return {
          ..._webrtcSwarm.getStats(),
          transport: 'webrtc'
        };
      }

      return {
        peerId: _peerId,
        roomId: _roomId,
        transport: _transport,
        connectionState: _connectionState,
        connectedPeers: _peers.size,
        clock: _logicalClock
      };
    };

    // Register default handlers
    onMessage('ping', (peerId, payload) => {
      sendToPeer(peerId, 'pong', { ts: payload.ts, received: Date.now() });
    });

    return {
      init,
      disconnect,
      sendToPeer,
      broadcast,
      onMessage,
      getConnectionState,
      getConnectedPeers,
      getTransportType,
      getStats,
      getClock,
      tick,
      _getPeerId: () => _peerId,
      _getSessionId: () => _roomId
    };
  }
};

export default SwarmTransport;
