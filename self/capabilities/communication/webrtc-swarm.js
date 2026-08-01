/**
 * @fileoverview WebRTC Swarm Transport
 * Peer-to-peer coordination via WebRTC with secure message validation,
 * session-scoped rooms, and exponential backoff reconnection.
 */

import { getCurrentReploidStorage } from '../../instance.js';
import { getResolvedSignalingConfig } from './signaling-config.js';

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64KB
const MAX_BACKOFF_MS = 30000;
const HEARTBEAT_INTERVAL = 30000;
const PEER_TIMEOUT = 60000;
const MAX_PENDING_ICE_PER_PEER = 32;
const PENDING_ICE_TTL_MS = 30000;

// Valid message types
const MESSAGE_TYPES = new Set([
  'sync-request', 'sync-response',
  'goal-update', 'reflection-share',
  'artifact-announce', 'artifact-request', 'artifact-chunk', 'artifact-ack',
  'reploid:peer-advertisement',
  'reploid:generation-request', 'reploid:generation-update',
  'reploid:generation-result', 'reploid:generation-error',
  'reploid:receipt',
  'ping', 'pong',
  'raft:request-vote', 'raft:request-vote-response',
  'raft:append-entries', 'raft:append-entries-response',
  'raft:client-request', 'raft:client-response',
  'fl:hello', 'fl:round-start', 'fl:update', 'fl:round-commit', 'fl:round-failed'
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
    let _roomToken = null;
    let _signalingWs = null;
    let _connectionState = 'stopped'; // connecting | connected | stopping | stopped | retrying
    let _reconnectAttempt = 0;
    let _reconnectTimer = null;
    let _heartbeatTimer = null;
    let _manualStop = false;
    let _peers = new Map(); // peerId -> { connection, dataChannel, metadata, status, lastSeen }
    let _messageHandlers = new Map(); // type -> handler function
    let _logicalClock = 0;
    const _pendingIceCandidates = new Map();
    const _latencyByPeer = new Map();

    // Bandwidth tracking
    const _stats = {
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      startTime: Date.now(),
      rejected: 0,
      relayMessagesSent: 0,
      relayBytesSent: 0,
      relayLastSendAt: null,
      relayLastEnqueueMs: null
    };

    const setConnectionState = (state, detail = {}) => {
      _connectionState = state;
      EventBus.emit('swarm:state-change', { state, ...detail });
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
      return getCurrentReploidStorage().getItem('REPLOID_SWARM_ENABLED') !== 'false';
    };

    /**
     * Resolve a non-public room identifier and its bearer capability. The room
     * ID is deliberately not derived from the capability: signaling metadata
     * is observable to the server and must not disclose membership authority.
     */
    const getRoomCredentials = () => {
      if (typeof window === 'undefined') return null;

      const urlParams = new URLSearchParams(window.location.search);
      const swarmParam = urlParams.get('swarm');
      const suppliedToken = urlParams.get('swarmToken');
      const storage = getCurrentReploidStorage();
      const storedRoomId = storage?.getItem('REPLOID_SWARM_ROOM_ID');
      const storedToken = storage?.getItem('REPLOID_SWARM_ROOM_TOKEN');

      const roomSuffix = swarmParam && swarmParam !== 'true'
        ? swarmParam.trim()
        : String(storedRoomId || '').trim() || uuid();
      const token = String(suppliedToken || storedToken || '').trim() || `${uuid()}${uuid()}`;

      if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(roomSuffix)) {
        throw new Error('Swarm room identifier contains unsupported characters');
      }
      if (token.length < 32) {
        throw new Error('Swarm room capability must contain at least 32 characters');
      }

      storage?.setItem('REPLOID_SWARM_ROOM_ID', roomSuffix);
      storage?.setItem('REPLOID_SWARM_ROOM_TOKEN', token);
      return {
        roomId: `reploid-swarm-${roomSuffix}`,
        token
      };
    };

    /**
     * Get room ID from token
     */
    const getRoomId = (credentials) => {
      if (!credentials?.roomId || !credentials?.token) {
        throw new Error('Swarm room credentials are required');
      }
      return credentials.roomId;
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

      _manualStop = false;

      // Generate or restore IDs
      _peerId = generateId('peer');
      _sessionId = localStorage.getItem('REPLOID_SESSION_ID') || uuid();
      localStorage.setItem('REPLOID_SESSION_ID', _sessionId);

      // A room capability is distinct from the room ID and is never public by default.
      const roomCredentials = getRoomCredentials();
      _roomId = getRoomId(roomCredentials);
      _roomToken = roomCredentials.token;

      CONFIG.signalingServer = getResolvedSignalingConfig().url;

      logger.info(`[WebRTCSwarm] Initializing - peerId: ${_peerId}, room: ${_roomId}`);

      // Connect to signaling server
      return connectToSignaling();
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

        setConnectionState('connecting');
        logger.info(`[WebRTCSwarm] Connecting to ${CONFIG.signalingServer}`);

        try {
          const signalingWs = new WebSocket(CONFIG.signalingServer);
          _signalingWs = signalingWs;

          let settled = false;
          const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };

          signalingWs.onopen = () => {
            if (_signalingWs !== signalingWs) {
              signalingWs.close();
              settle(false);
              return;
            }
            if (_manualStop) {
              signalingWs.close();
              settle(false);
              return;
            }
            logger.info('[WebRTCSwarm] Connected to signaling server');
            setConnectionState('connected');
            _reconnectAttempt = 0;

            // Clear any pending reconnect
            if (_reconnectTimer) {
              clearTimeout(_reconnectTimer);
              _reconnectTimer = null;
            }

            // Join with the private room capability, never a value derived from the room ID.
            sendSignaling({
              type: 'join',
              peerId: _peerId,
              roomId: _roomId,
              token: _roomToken,
              metadata: { capabilities: [] }
            });

            // Start heartbeat
            startHeartbeat();

            settle(true);
          };

          signalingWs.onmessage = (event) => {
            if (_signalingWs !== signalingWs) return;
            try {
              const message = JSON.parse(event.data);
              handleSignalingMessage(message);
            } catch (e) {
              logger.error('[WebRTCSwarm] Failed to parse signaling message:', e);
            }
          };

          signalingWs.onerror = (error) => {
            if (_signalingWs !== signalingWs) {
              settle(false);
              return;
            }
            logger.error('[WebRTCSwarm] WebSocket error:', error);
            settle(false);
            // Browsers normally follow an error with close. Cover the rare
            // non-closing failure too, while onopen can cancel this timer.
            if (!_manualStop) scheduleReconnect();
          };

          signalingWs.onclose = () => {
            if (_signalingWs !== signalingWs) {
              settle(false);
              return;
            }
            logger.warn('[WebRTCSwarm] Disconnected from signaling server');
            stopHeartbeat();

            // Clear peers so reconnect will re-dial
            clearPeers();

            if (_manualStop) {
              setConnectionState('stopped');
              settle(false);
              return;
            }

            settle(false);
            scheduleReconnect();
          };
        } catch (e) {
          logger.error('[WebRTCSwarm] Failed to create WebSocket:', e);
          setConnectionState('stopped');
          if (!_manualStop) scheduleReconnect();
          reject(e);
        }
      });
    };

    /**
     * Schedule reconnection with exponential backoff
     */
    const scheduleReconnect = () => {
      if (_manualStop || _reconnectTimer) return;

      _reconnectAttempt++;
      const backoff = Math.min(
        CONFIG.reconnectBaseMs * Math.pow(2, _reconnectAttempt - 1),
        MAX_BACKOFF_MS
      );

      logger.info(`[WebRTCSwarm] Reconnecting in ${backoff}ms (attempt ${_reconnectAttempt})`);
      setConnectionState('retrying', { attempt: _reconnectAttempt });

      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        if (_manualStop) return;
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
          if (message.metadata?.transport === 'signaling-relay') {
            registerRelayPeer(message.peerId, message.metadata);
          }
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

        case 'relay-message':
          if (!_peers.has(message.peerId)) {
            registerRelayPeer(message.peerId, { transport: 'signaling-relay' });
          }
          handlePeerEnvelope(message.peerId, message.envelope);
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
      await flushPendingIceCandidates(remotePeerId, connection);
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
        await flushPendingIceCandidates(remotePeerId, peer.connection);
      }
    };

    const queuePendingIceCandidate = (remotePeerId, candidate) => {
      const now = Date.now();
      const pending = (_pendingIceCandidates.get(remotePeerId) || [])
        .filter((entry) => now - entry.receivedAt <= PENDING_ICE_TTL_MS);
      pending.push({ candidate, receivedAt: now });
      _pendingIceCandidates.set(remotePeerId, pending.slice(-MAX_PENDING_ICE_PER_PEER));
    };

    const flushPendingIceCandidates = async (remotePeerId, connection) => {
      const pending = _pendingIceCandidates.get(remotePeerId) || [];
      _pendingIceCandidates.delete(remotePeerId);
      for (const entry of pending) {
        if (Date.now() - entry.receivedAt > PENDING_ICE_TTL_MS) continue;
        await connection.addIceCandidate(entry.candidate);
      }
    };

    /**
     * Handle incoming ICE candidate
     */
    const handleIceCandidate = async (remotePeerId, candidate) => {
      const peer = _peers.get(remotePeerId);
      if (!candidate) return;
      if (!peer?.connection || !peer.connection.remoteDescription) {
        queuePendingIceCandidate(remotePeerId, candidate);
        return;
      }
      try {
        await peer.connection.addIceCandidate(candidate);
      } catch (e) {
        logger.error(`[WebRTCSwarm] Failed to add ICE candidate for ${remotePeerId}:`, e);
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
     * Register a relay-backed peer that communicates through the signaling socket.
     */
    const registerRelayPeer = (remotePeerId, metadata = {}) => {
      const existingPeer = _peers.get(remotePeerId);
      if (existingPeer && existingPeer.transport === 'signaling-relay') {
        existingPeer.metadata = { ...existingPeer.metadata, ...metadata };
        existingPeer.lastSeen = Date.now();
        existingPeer.status = 'connected';
        return existingPeer;
      }

      const peer = {
        id: remotePeerId,
        connection: null,
        dataChannel: null,
        metadata: { ...metadata },
        status: 'connected',
        lastSeen: Date.now(),
        transport: 'signaling-relay'
      };

      _peers.set(remotePeerId, peer);
      return peer;
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
      _pendingIceCandidates.delete(remotePeerId);
      _latencyByPeer.delete(remotePeerId);
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

      handlePeerEnvelope(remotePeerId, envelope, data.length);
    };

    /**
     * Handle a parsed envelope from either WebRTC or signaling relay transport.
     */
    const handlePeerEnvelope = (remotePeerId, envelope, sizeHint = null) => {
      const serializedLength = Number.isFinite(sizeHint) ? sizeHint : JSON.stringify(envelope || {}).length;

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
      _stats.bytesReceived += serializedLength;

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
      if (!peer) {
        logger.warn(`[WebRTCSwarm] Cannot send to ${remotePeerId}: not connected`);
        return false;
      }

      try {
        const envelope = wrapMessage(type, payload);
        const data = JSON.stringify(envelope);

        if (peer.transport === 'signaling-relay') {
          const startedAt = globalThis.performance?.now?.() ?? Date.now();
          const sent = sendSignaling({
            type: 'relay-message',
            peerId: _peerId,
            roomId: _roomId,
            targetPeer: remotePeerId,
            envelope
          });
          if (sent) {
            _stats.messagesSent++;
            _stats.bytesSent += data.length;
            _stats.relayMessagesSent++;
            _stats.relayBytesSent += data.length;
            _stats.relayLastSendAt = Date.now();
            _stats.relayLastEnqueueMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
          }
          return sent;
        }

        if (!peer.dataChannel || peer.dataChannel.readyState !== 'open') {
          logger.warn(`[WebRTCSwarm] Cannot send to ${remotePeerId}: not connected`);
          return false;
        }

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
        for (const [peerId, candidates] of _pendingIceCandidates) {
          const liveCandidates = candidates.filter((entry) => now - entry.receivedAt <= PENDING_ICE_TTL_MS);
          if (liveCandidates.length > 0) _pendingIceCandidates.set(peerId, liveCandidates);
          else _pendingIceCandidates.delete(peerId);
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
      _manualStop = true;
      if (_reconnectTimer) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
      }
      setConnectionState('stopping');
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
      setConnectionState('stopped');
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
      latencyByPeer: Object.fromEntries(_latencyByPeer),
      pendingIceCandidateCount: Array.from(_pendingIceCandidates.values())
        .reduce((total, candidates) => total + candidates.length, 0),
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
      _latencyByPeer.set(peerId, {
        roundTripMs: latency,
        measuredAt: Date.now()
      });
      EventBus.emit('swarm:latency', { peerId, roundTripMs: latency });
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
