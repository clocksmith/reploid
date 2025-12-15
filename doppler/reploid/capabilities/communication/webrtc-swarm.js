/**
 * @fileoverview WebRTC Swarm Transport
 * Peer-to-peer coordination via WebRTC with secure message validation,
 * session-scoped rooms, and exponential backoff reconnection.
 */

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB
const MAX_BACKOFF_MS = 30000;
const HEARTBEAT_INTERVAL = 30000;
const PEER_TIMEOUT = 60000;

// Valid message types
const MESSAGE_TYPES = new Set([
  'sync-request', 'sync-response',
  'goal-update', 'reflection-share',
  'artifact-announce', 'artifact-request', 'artifact-chunk', 'artifact-ack',
  'ping', 'pong'
]);

const WebRTCSwarm = {
  metadata: {
    id: 'WebRTCSwarm',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, generateId } = Utils;

    // Configuration
    const CONFIG = {
      signalingServer: null, // Set dynamically based on window.location
      reconnectBaseMs: 1000,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      channelOptions: { ordered: true, maxRetransmits: 3 }
    };

    // State
    let _peerId = null;
    let _sessionId = null;
    let _roomId = null;
    let _signalingWs = null;
    let _connectionState = 'disconnected'; // disconnected | connecting | connected | reconnecting
    let _reconnectAttempt = 0;
    let _reconnectTimer = null;
    let _heartbeatTimer = null;
    let _peers = new Map(); // peerId -> { connection, dataChannel, metadata, status, lastSeen }
    let _messageHandlers = new Map(); // type -> handler function
    let _logicalClock = 0;

    // Bandwidth tracking
    const _stats = {
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      startTime: Date.now(),
      rejected: 0
    };

    /**
     * Generate signaling server URL from current location
     */
    const getSignalingUrl = () => {
      if (typeof window === 'undefined') return null;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/signaling`;
    };

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
     * Increment logical clock (Lamport timestamp)
     */
    const tick = () => ++_logicalClock;

    /**
     * Update logical clock on receive
     */
    const updateClock = (remoteClock) => {
      _logicalClock = Math.max(_logicalClock, remoteClock) + 1;
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
      if (typeof envelope.timestamp !== 'number') {
        return { valid: false, reason: 'Missing or invalid timestamp' };
      }
      if (envelope.payloadSize > MAX_PAYLOAD_SIZE) {
        return { valid: false, reason: `Payload too large: ${envelope.payloadSize}` };
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
        timestamp: tick(),
        payload: payload || {},
        payloadSize: payloadStr.length
      };
    };

    /**
     * Check if swarm is enabled via URL param or localStorage
     */
    const isEnabled = () => {
      if (typeof window === 'undefined') return false;

      // URL param takes priority: ?swarm=true or ?swarm=<roomId>
      const urlParams = new URLSearchParams(window.location.search);
      const swarmParam = urlParams.get('swarm');
      if (swarmParam) return true;

      // Fall back to localStorage
      return localStorage.getItem('REPLOID_SWARM_ENABLED') === 'true';
    };

    /**
     * Get room token from URL param or session
     */
    const getRoomToken = () => {
      if (typeof window === 'undefined') return null;

      const urlParams = new URLSearchParams(window.location.search);
      const swarmParam = urlParams.get('swarm');

      // If swarm param is a custom string, use it as token
      if (swarmParam && swarmParam !== 'true') {
        return swarmParam;
      }

      // Otherwise use session-based token
      return _sessionId;
    };

    /**
     * Get room ID from token
     */
    const getRoomId = (token) => {
      return `reploid-swarm-${token}`;
    };

    /**
     * Initialize the swarm transport
     */
    const init = async () => {
      // Check if enabled via URL param or feature flag
      if (!isEnabled()) {
        logger.info('[WebRTCSwarm] Disabled (add ?swarm=true to URL or set REPLOID_SWARM_ENABLED=true)');
        return false;
      }

      // Generate or restore IDs
      _peerId = generateId('peer');
      _sessionId = localStorage.getItem('REPLOID_SESSION_ID') || uuid();
      localStorage.setItem('REPLOID_SESSION_ID', _sessionId);

      // Get room token (from URL param or session)
      const roomToken = getRoomToken();
      _roomId = getRoomId(roomToken);

      CONFIG.signalingServer = getSignalingUrl();

      logger.info(`[WebRTCSwarm] Initializing - peerId: ${_peerId}, room: ${_roomId}`);

      // Connect to signaling server
      await connectToSignaling();

      return true;
    };

    /**
     * Connect to signaling server with retry
     */
    const connectToSignaling = () => {
      return new Promise((resolve, reject) => {
        if (!CONFIG.signalingServer) {
          reject(new Error('No signaling server configured'));
          return;
        }

        if (_signalingWs) {
          _signalingWs.close();
        }

        _connectionState = 'connecting';
        EventBus.emit('swarm:state-change', { state: _connectionState });
        logger.info(`[WebRTCSwarm] Connecting to ${CONFIG.signalingServer}`);

        try {
          _signalingWs = new WebSocket(CONFIG.signalingServer);

          _signalingWs.onopen = () => {
            logger.info('[WebRTCSwarm] Connected to signaling server');
            _connectionState = 'connected';
            _reconnectAttempt = 0;
            EventBus.emit('swarm:state-change', { state: _connectionState });

            // Clear any pending reconnect
            if (_reconnectTimer) {
              clearTimeout(_reconnectTimer);
              _reconnectTimer = null;
            }

            // Join room (token must match room suffix for auth)
            const token = _roomId.replace('reploid-swarm-', '');
            sendSignaling({
              type: 'join',
              peerId: _peerId,
              roomId: _roomId,
              token,
              metadata: { capabilities: [] }
            });

            // Start heartbeat
            startHeartbeat();

            resolve(true);
          };

          _signalingWs.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              handleSignalingMessage(message);
            } catch (e) {
              logger.error('[WebRTCSwarm] Failed to parse signaling message:', e);
            }
          };

          _signalingWs.onerror = (error) => {
            logger.error('[WebRTCSwarm] WebSocket error:', error);
          };

          _signalingWs.onclose = () => {
            logger.warn('[WebRTCSwarm] Disconnected from signaling server');
            _connectionState = 'disconnected';
            stopHeartbeat();
            EventBus.emit('swarm:state-change', { state: _connectionState });

            // Clear peers so reconnect will re-dial
            clearPeers();

            // Schedule reconnect
            scheduleReconnect();
          };
        } catch (e) {
          logger.error('[WebRTCSwarm] Failed to create WebSocket:', e);
          _connectionState = 'disconnected';
          scheduleReconnect();
          reject(e);
        }
      });
    };

    /**
     * Schedule reconnection with exponential backoff
     */
    const scheduleReconnect = () => {
      if (_reconnectTimer) return;

      _reconnectAttempt++;
      const backoff = Math.min(
        CONFIG.reconnectBaseMs * Math.pow(2, _reconnectAttempt - 1),
        MAX_BACKOFF_MS
      );

      logger.info(`[WebRTCSwarm] Reconnecting in ${backoff}ms (attempt ${_reconnectAttempt})`);
      _connectionState = 'reconnecting';
      EventBus.emit('swarm:state-change', { state: _connectionState, attempt: _reconnectAttempt });

      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        connectToSignaling().catch(e => {
          logger.error('[WebRTCSwarm] Reconnect failed:', e);
        });
      }, backoff);
    };

    /**
     * Send message to signaling server
     */
    const sendSignaling = (message) => {
      if (!_signalingWs || _signalingWs.readyState !== WebSocket.OPEN) {
        logger.warn('[WebRTCSwarm] Cannot send signaling: not connected');
        return false;
      }
      try {
        _signalingWs.send(JSON.stringify(message));
        return true;
      } catch (e) {
        logger.error('[WebRTCSwarm] Failed to send signaling:', e);
        return false;
      }
    };

    /**
     * Handle incoming signaling messages
     */
    const handleSignalingMessage = async (message) => {
      const { type } = message;

      switch (type) {
        case 'welcome':
          logger.debug('[WebRTCSwarm] Received welcome from signaling server');
          break;

        case 'joined':
          logger.info(`[WebRTCSwarm] Joined room ${message.roomId}, existing peers: ${message.peers?.length || 0}`);
          // Connect to existing peers
          for (const remotePeerId of (message.peers || [])) {
            await connectToPeer(remotePeerId);
          }
          break;

        case 'peer-joined':
          logger.info(`[WebRTCSwarm] Peer joined: ${message.peerId}`);
          EventBus.emit('swarm:peer-joined', { peerId: message.peerId });
          break;

        case 'peer-left':
          logger.info(`[WebRTCSwarm] Peer left: ${message.peerId}`);
          removePeer(message.peerId);
          EventBus.emit('swarm:peer-left', { peerId: message.peerId });
          break;

        case 'offer':
          await handleOffer(message.peerId, message.offer);
          break;

        case 'answer':
          await handleAnswer(message.peerId, message.answer);
          break;

        case 'ice-candidate':
          await handleIceCandidate(message.peerId, message.candidate);
          break;

        case 'error':
          logger.error('[WebRTCSwarm] Signaling error:', message.error);
          break;

        default:
          logger.debug(`[WebRTCSwarm] Unknown signaling message: ${type}`);
      }
    };

    /**
     * Connect to a remote peer
     */
    const connectToPeer = async (remotePeerId) => {
      // Skip if already connected or connecting
      const existingPeer = _peers.get(remotePeerId);
      if (existingPeer) {
        if (existingPeer.status === 'connected') {
          logger.debug(`[WebRTCSwarm] Already connected to ${remotePeerId}, skipping`);
          return;
        }
        // Close stale connection before reconnecting
        logger.info(`[WebRTCSwarm] Closing stale connection to ${remotePeerId}`);
        removePeer(remotePeerId);
      }

      logger.info(`[WebRTCSwarm] Connecting to peer: ${remotePeerId}`);

      const connection = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
      const dataChannel = connection.createDataChannel('reploid', CONFIG.channelOptions);

      const peer = {
        id: remotePeerId,
        connection,
        dataChannel,
        metadata: {},
        status: 'connecting',
        lastSeen: Date.now()
      };

      _peers.set(remotePeerId, peer);

      // ICE candidate handler
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignaling({
            type: 'ice-candidate',
            peerId: _peerId,
            targetPeer: remotePeerId,
            candidate: event.candidate
          });
        }
      };

      // Connection state monitoring
      connection.onconnectionstatechange = () => {
        logger.debug(`[WebRTCSwarm] Connection state with ${remotePeerId}: ${connection.connectionState}`);
        if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
          removePeer(remotePeerId);
        }
      };

      // Data channel handlers
      setupDataChannel(dataChannel, remotePeerId, peer);

      // Create and send offer
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      sendSignaling({
        type: 'offer',
        peerId: _peerId,
        targetPeer: remotePeerId,
        offer
      });
    };

    /**
     * Handle incoming WebRTC offer
     */
    const handleOffer = async (remotePeerId, offer) => {
      logger.info(`[WebRTCSwarm] Received offer from: ${remotePeerId}`);

      const connection = new RTCPeerConnection({ iceServers: CONFIG.iceServers });

      const peer = {
        id: remotePeerId,
        connection,
        dataChannel: null,
        metadata: {},
        status: 'connecting',
        lastSeen: Date.now()
      };

      _peers.set(remotePeerId, peer);

      // ICE candidate handler
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignaling({
            type: 'ice-candidate',
            peerId: _peerId,
            targetPeer: remotePeerId,
            candidate: event.candidate
          });
        }
      };

      // Wait for incoming data channel
      connection.ondatachannel = (event) => {
        peer.dataChannel = event.channel;
        setupDataChannel(event.channel, remotePeerId, peer);
      };

      // Set remote description and create answer
      await connection.setRemoteDescription(offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      sendSignaling({
        type: 'answer',
        peerId: _peerId,
        targetPeer: remotePeerId,
        answer
      });
    };

    /**
     * Handle incoming WebRTC answer
     */
    const handleAnswer = async (remotePeerId, answer) => {
      const peer = _peers.get(remotePeerId);
      if (peer) {
        await peer.connection.setRemoteDescription(answer);
      }
    };

    /**
     * Handle incoming ICE candidate
     */
    const handleIceCandidate = async (remotePeerId, candidate) => {
      const peer = _peers.get(remotePeerId);
      if (peer && candidate) {
        try {
          await peer.connection.addIceCandidate(candidate);
        } catch (e) {
          logger.error(`[WebRTCSwarm] Failed to add ICE candidate for ${remotePeerId}:`, e);
        }
      }
    };

    /**
     * Setup data channel handlers
     */
    const setupDataChannel = (dataChannel, remotePeerId, peer) => {
      dataChannel.onopen = () => {
        logger.info(`[WebRTCSwarm] Data channel opened with ${remotePeerId}`);
        peer.status = 'connected';
        EventBus.emit('swarm:peer-connected', { peerId: remotePeerId });

        // Request initial sync
        sendToPeer(remotePeerId, 'sync-request', {});
      };

      dataChannel.onmessage = (event) => {
        handlePeerMessage(remotePeerId, event.data);
      };

      dataChannel.onerror = (error) => {
        logger.error(`[WebRTCSwarm] Data channel error with ${remotePeerId}:`, error);
      };

      dataChannel.onclose = () => {
        logger.info(`[WebRTCSwarm] Data channel closed with ${remotePeerId}`);
        peer.status = 'disconnected';
      };
    };

    /**
     * Remove peer and cleanup
     */
    const removePeer = (remotePeerId) => {
      const peer = _peers.get(remotePeerId);
      if (peer) {
        try {
          if (peer.dataChannel) peer.dataChannel.close();
          if (peer.connection) peer.connection.close();
        } catch (e) {
          // Ignore cleanup errors
        }
        _peers.delete(remotePeerId);
      }
    };

    /**
     * Remove all peers
     */
    const clearPeers = () => {
      for (const [peerId] of _peers) {
        removePeer(peerId);
      }
    };

    /**
     * Handle incoming peer message
     */
    const handlePeerMessage = (remotePeerId, data) => {
      let envelope;
      try {
        // Size check before parse
        if (data.length > MAX_PAYLOAD_SIZE * 2) {
          logger.warn(`[WebRTCSwarm] Message too large from ${remotePeerId}: ${data.length}`);
          _stats.rejected++;
          return;
        }

        envelope = JSON.parse(data);
      } catch (e) {
        logger.warn(`[WebRTCSwarm] Failed to parse message from ${remotePeerId}`);
        _stats.rejected++;
        return;
      }

      // Validate envelope
      const validation = validateEnvelope(envelope);
      if (!validation.valid) {
        logger.warn(`[WebRTCSwarm] Invalid message from ${remotePeerId}: ${validation.reason}`);
        _stats.rejected++;
        return;
      }

      // Update logical clock
      updateClock(envelope.timestamp);

      // Update peer last seen
      const peer = _peers.get(remotePeerId);
      if (peer) {
        peer.lastSeen = Date.now();
      }

      // Track stats
      _stats.messagesReceived++;
      _stats.bytesReceived += data.length;

      // Route to handler
      const handler = _messageHandlers.get(envelope.type);
      if (handler) {
        try {
          handler(remotePeerId, envelope.payload, envelope);
        } catch (e) {
          logger.error(`[WebRTCSwarm] Handler error for ${envelope.type}:`, e);
        }
      }

      // Emit event for external listeners
      EventBus.emit(`swarm:message:${envelope.type}`, {
        peerId: remotePeerId,
        payload: envelope.payload,
        timestamp: envelope.timestamp
      });
    };

    /**
     * Send message to specific peer
     */
    const sendToPeer = (remotePeerId, type, payload) => {
      const peer = _peers.get(remotePeerId);
      if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== 'open') {
        logger.warn(`[WebRTCSwarm] Cannot send to ${remotePeerId}: not connected`);
        return false;
      }

      try {
        const envelope = wrapMessage(type, payload);
        const data = JSON.stringify(envelope);

        peer.dataChannel.send(data);

        _stats.messagesSent++;
        _stats.bytesSent += data.length;

        return true;
      } catch (e) {
        logger.error(`[WebRTCSwarm] Failed to send to ${remotePeerId}:`, e);
        return false;
      }
    };

    /**
     * Broadcast message to all connected peers
     */
    const broadcast = (type, payload) => {
      let sent = 0;
      for (const [peerId] of _peers) {
        if (sendToPeer(peerId, type, payload)) {
          sent++;
        }
      }
      return sent;
    };

    /**
     * Register message handler
     */
    const onMessage = (type, handler) => {
      if (!MESSAGE_TYPES.has(type)) {
        logger.warn(`[WebRTCSwarm] Registering handler for unknown type: ${type}`);
      }
      _messageHandlers.set(type, handler);
    };

    /**
     * Start heartbeat timer
     */
    const startHeartbeat = () => {
      stopHeartbeat();
      _heartbeatTimer = setInterval(() => {
        // Send heartbeat to signaling
        sendSignaling({
          type: 'heartbeat',
          peerId: _peerId,
          roomId: _roomId
        });

        // Ping all peers
        broadcast('ping', { ts: Date.now() });

        // Check for stale peers
        const now = Date.now();
        for (const [peerId, peer] of _peers) {
          if (now - peer.lastSeen > PEER_TIMEOUT) {
            logger.warn(`[WebRTCSwarm] Peer ${peerId} is stale, removing`);
            removePeer(peerId);
            EventBus.emit('swarm:peer-timeout', { peerId });
          }
        }
      }, HEARTBEAT_INTERVAL);
    };

    /**
     * Stop heartbeat timer
     */
    const stopHeartbeat = () => {
      if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
      }
    };

    /**
     * Disconnect from swarm
     */
    const disconnect = () => {
      stopHeartbeat();

      // Close all peer connections
      for (const [peerId] of _peers) {
        removePeer(peerId);
      }

      // Close signaling
      if (_signalingWs) {
        sendSignaling({ type: 'leave', peerId: _peerId, roomId: _roomId });
        _signalingWs.close();
        _signalingWs = null;
      }

      _connectionState = 'disconnected';
      EventBus.emit('swarm:state-change', { state: _connectionState });
    };

    /**
     * Get current connection state
     */
    const getConnectionState = () => _connectionState;

    /**
     * Get connected peers
     */
    const getConnectedPeers = () => {
      return Array.from(_peers.entries())
        .filter(([_, peer]) => peer.status === 'connected')
        .map(([id, peer]) => ({
          id,
          metadata: peer.metadata,
          lastSeen: peer.lastSeen
        }));
    };

    /**
     * Get stats
     */
    const getStats = () => ({
      peerId: _peerId,
      sessionId: _sessionId,
      roomId: _roomId,
      connectionState: _connectionState,
      connectedPeers: getConnectedPeers().length,
      totalPeers: _peers.size,
      ..._stats,
      uptime: Date.now() - _stats.startTime
    });

    /**
     * Get logical clock value
     */
    const getClock = () => _logicalClock;

    // Register default handlers
    onMessage('ping', (peerId, payload) => {
      sendToPeer(peerId, 'pong', { ts: payload.ts, received: Date.now() });
    });

    onMessage('pong', (peerId, payload) => {
      const latency = Date.now() - payload.ts;
      logger.debug(`[WebRTCSwarm] Latency to ${peerId}: ${latency}ms`);
    });

    return {
      init,
      disconnect,
      sendToPeer,
      broadcast,
      onMessage,
      getConnectionState,
      getConnectedPeers,
      getStats,
      getClock,
      tick, // Expose for SwarmSync to increment clock on local writes
      // Expose for SwarmSync
      _getPeerId: () => _peerId,
      _getSessionId: () => _sessionId
    };
  }
};

export default WebRTCSwarm;
