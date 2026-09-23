/**
 * @fileoverview Swarm Transport Abstraction
 * Auto-selects between BroadcastChannel (same browser, no server) and WebRTC (cross-machine).
 * Provides a unified interface for SwarmSync regardless of underlying transport.
 */

import { requireResolvedConfig } from '../config/index.js';
import { createWebRTCSwarm } from './swarm.js';

const PROTOCOL_VERSION = 1;


// Valid message types
const MESSAGE_TYPES = new Set([
  'sync-request', 'sync-response',
  'goal-update', 'reflection-share',
  'artifact-announce', 'artifact-request', 'artifact-chunk', 'artifact-ack',
  'reploid:peer-advertisement',
  'reploid:generation-request', 'reploid:generation-update',
  'reploid:generation-result', 'reploid:generation-error',
  'reploid:receipt',
  'reploid:tool-offer', 'reploid:tool-offer-ack',
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
    const policy = requireResolvedConfig(deps.config);
    const MAX_PAYLOAD_SIZE = policy.webrtc.maxMessageBytes;
    const BroadcastChannel = deps.BroadcastChannel || globalThis.BroadcastChannel;
    const WebSocket = deps.WebSocket || globalThis.WebSocket;

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
    let initVersion = 0;
    let cancelProbe = null;

    // Peer timeout for BroadcastChannel (no heartbeat from server)
    const PEER_TIMEOUT = policy.webrtc.peerTimeoutMs;
    const ANNOUNCE_INTERVAL = policy.webrtc.announceIntervalMs;
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
    const getRoomId = () => policy.webrtc.broadcastRoomId;
    const isEnabled = () => policy.mesh.enabled;
    const checkSignalingServer = async () => {
      if (!policy.webrtc.signalingUrl || typeof WebSocket !== 'function') return false;
      return new Promise(resolve => {
        let socket = null;
        let settled = false;
        const finish = available => {
          if (settled) return;
          settled = true;
          cancelProbe = null;
          clearTimeout(timer);
          if (socket) { socket.onopen = null; socket.onerror = null; socket.close(); }
          resolve(available);
        };
        const timer = setTimeout(() => finish(false), policy.webrtc.signalingProbeTimeoutMs);
        cancelProbe = () => finish(false);
        try {
          socket = new WebSocket(policy.webrtc.signalingUrl);
          socket.onopen = () => finish(true);
          socket.onerror = () => finish(false);
        } catch { finish(false); }
      });
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
      if (data.targetPeer && data.targetPeer !== _peerId) return;

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
    const initWebRTC = async (version) => {
      _transport = 'webrtc';

      try {
        const transport = deps.createWebRTCSwarm
          ? await deps.createWebRTCSwarm()
          : createWebRTCSwarm(deps);
        if (version !== initVersion) { transport.disconnect(); return false; }
        _webrtcSwarm = transport;
        for (const [type, handler] of _messageHandlers.entries()) transport.onMessage(type, handler);
        const initialized = await transport.init();
        if (version !== initVersion) { transport.disconnect(); return false; }
        if (!initialized && policy.webrtc.transportOrder.length !== 1) { transport.disconnect(); _webrtcSwarm = null; return false; }

        if (_webrtcSwarm) {
          _peerId = _webrtcSwarm._getPeerId();
          _connectionState = _webrtcSwarm.getConnectionState();
          for (const [type, handler] of _messageHandlers.entries()) {
            _webrtcSwarm.onMessage(type, handler);
          }
          logger.info('[SwarmTransport] Using WebRTC transport via WebRTCSwarm');
          return true;
        }
      } catch (e) {
        logger.warn('[SwarmTransport] WebRTC initialization failed', e);
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
      if (!isEnabled()) return false;
      if (_webrtcSwarm || _connectionState === 'connected') return true;
      const version = ++initVersion;
      _peerId = deps.peerId || generateId('peer');
      _roomId = getRoomId();
      for (const transport of policy.webrtc.transportOrder) {
        if (transport === 'broadcast' && typeof BroadcastChannel === 'function') {
          initBroadcastChannel();
          return true;
        }
        if (transport === 'webrtc' && (policy.webrtc.transportOrder.length === 1 || await checkSignalingServer())) {
          if (version !== initVersion) return false;
          if (await initWebRTC(version)) return version === initVersion;
        }
        if (version !== initVersion) return false;
      }
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
    const getConnectionState = () => _transport === 'webrtc' && _webrtcSwarm
      ? _webrtcSwarm.getConnectionState() : _connectionState;

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
      initVersion += 1;
      cancelProbe?.();
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
        connectionState: getConnectionState(),
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

export function createSwarmTransport(options) { return SwarmTransport.factory(options); }
