#!/usr/bin/env node

/**
 * @fileoverview Strict Reploid signaling server for WebRTC peer coordination.
 */

import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';

export const SIGNALING_MESSAGE_TYPES = new Set([
  'join',
  'leave',
  'offer',
  'answer',
  'ice-candidate',
  'heartbeat',
  'relay-message'
]);

const RELAY_PROTOCOL_VERSION = 1;
const RELAY_MESSAGE_TYPES = new Set([
  'reploid:peer-advertisement',
  'reploid:generation-request',
  'reploid:generation-update',
  'reploid:generation-result',
  'reploid:generation-error',
  'reploid:receipt',
  'ping',
  'pong'
]);

const DEFAULT_PATH = '/signaling';
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_PEERS_PER_ROOM = 256;
const DEFAULT_MAX_PEERS_TOTAL = 8192;
const DEFAULT_MAX_ROOMS = 4096;
const DEFAULT_MAX_MESSAGES_PER_WINDOW = 512;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 1000;
const PEER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,127}$/i;
const ROOM_ID_PATTERN = /^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i;

const ensurePositiveInteger = (value, fallback) => {
  const next = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(next) && next > 0 ? next : fallback;
};

const toErrorLine = (message) => String(message || 'Protocol error').trim() || 'Protocol error';

const normalizeMetadataValue = (value) => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
};

const sanitizeMetadata = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 16)
      .map(([key, entry]) => [String(key || '').trim().slice(0, 64), normalizeMetadataValue(entry)])
      .filter(([key]) => key.length > 0)
  );
};

export function isLoopbackAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === '::ffff:127.0.0.1';
}

const isLoopbackOrigin = (origin) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = String(url.hostname || '').trim().toLowerCase();
    return host === 'localhost' || isLoopbackAddress(host);
  } catch {
    return false;
  }
};

class SignalingServer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      path: options.path || DEFAULT_PATH,
      heartbeatInterval: ensurePositiveInteger(options.heartbeatInterval, 30000),
      peerTimeout: ensurePositiveInteger(options.peerTimeout, 60000),
      maxMessageBytes: ensurePositiveInteger(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES),
      maxPeersPerRoom: ensurePositiveInteger(options.maxPeersPerRoom, DEFAULT_MAX_PEERS_PER_ROOM),
      maxPeersTotal: ensurePositiveInteger(options.maxPeersTotal, DEFAULT_MAX_PEERS_TOTAL),
      maxRooms: ensurePositiveInteger(options.maxRooms, DEFAULT_MAX_ROOMS),
      maxMessagesPerWindow: ensurePositiveInteger(options.maxMessagesPerWindow, DEFAULT_MAX_MESSAGES_PER_WINDOW),
      rateLimitWindowMs: ensurePositiveInteger(options.rateLimitWindowMs, DEFAULT_RATE_LIMIT_WINDOW_MS),
      localOnly: options.localOnly === true,
      allowedOrigins: Array.isArray(options.allowedOrigins) ? [...options.allowedOrigins] : [],
      logger: options.logger || console
    };

    this.virtualPeers = Array.isArray(options.virtualPeers)
      ? options.virtualPeers.filter((peer) => peer && typeof peer.peerId === 'string')
      : [];

    this.wss = new WebSocketServer({
      noServer: true,
      path: this.options.path,
      maxPayload: this.options.maxMessageBytes,
      perMessageDeflate: false
    });

    this.rooms = new Map();
    this.peers = new Map();
    this.connectionMeta = new WeakMap();
    this.heartbeatMonitor = null;
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      messagesForwarded: 0,
      rejectedMessages: 0,
      rejectedConnections: 0,
      totalConnections: 0,
      startedAt: Date.now()
    };

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.startHeartbeatMonitor();
  }

  shouldHandle(req) {
    return this.wss.shouldHandle(req);
  }

  log(level, message, details) {
    const method = this.options.logger?.[level] || this.options.logger?.log || console.log;
    if (details !== undefined) {
      method.call(this.options.logger, `[SignalingServer] ${message}`, details);
      return;
    }
    method.call(this.options.logger, `[SignalingServer] ${message}`);
  }

  rejectUpgrade(socket, statusCode, message) {
    const body = toErrorLine(message);
    const response = [
      `HTTP/1.1 ${statusCode} ${statusCode === 403 ? 'Forbidden' : 'Bad Request'}`,
      'Connection: close',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body
    ].join('\r\n');

    try {
      socket.write(response);
    } catch {
      // Ignore socket write failures during rejection.
    }
    socket.destroy();
  }

  isOriginAllowed(origin) {
    if (!origin) return true;

    if (this.options.localOnly && !isLoopbackOrigin(origin)) {
      return false;
    }

    if (!this.options.allowedOrigins.length) {
      return true;
    }

    return this.options.allowedOrigins.some((candidate) => {
      if (candidate instanceof RegExp) {
        return candidate.test(origin);
      }
      return String(candidate) === origin;
    });
  }

  handleUpgrade(req, socket, head) {
    if (!this.shouldHandle(req)) {
      this.rejectUpgrade(socket, 404, 'Not found');
      return;
    }

    if (this.options.localOnly && !isLoopbackAddress(req.socket?.remoteAddress)) {
      this.metrics.rejectedConnections += 1;
      this.rejectUpgrade(socket, 403, 'Loopback connections only');
      return;
    }

    if (!this.isOriginAllowed(req.headers.origin)) {
      this.metrics.rejectedConnections += 1;
      this.rejectUpgrade(socket, 403, 'Origin not allowed');
      return;
    }

    socket.setNoDelay?.(true);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  handleConnection(ws, req) {
    this.metrics.totalConnections += 1;
    this.connectionMeta.set(ws, {
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      resetAt: Date.now() + this.options.rateLimitWindowMs,
      messageCount: 0,
      peerId: null,
      roomId: null,
      remoteAddress: req.socket?.remoteAddress || null,
      origin: req.headers.origin || null
    });

    ws.on('message', (data, isBinary) => {
      this.handleRawMessage(ws, data, isBinary);
    });

    ws.on('close', () => {
      const meta = this.connectionMeta.get(ws);
      if (meta?.peerId) {
        this.removePeer(meta.peerId, meta.roomId, {
          closeSocket: false,
          reason: 'disconnect'
        });
      }
    });

    ws.on('error', (error) => {
      const meta = this.connectionMeta.get(ws);
      this.log('error', `WebSocket error for peer ${meta?.peerId || 'pending'}`, error);
    });

    this.sendMessage(ws, {
      type: 'welcome',
      timestamp: Date.now(),
      path: this.options.path,
      localOnly: this.options.localOnly
    });
  }

  handleRawMessage(ws, data, isBinary) {
    const meta = this.connectionMeta.get(ws);
    if (!meta) return;

    if (isBinary) {
      this.metrics.rejectedMessages += 1;
      this.closeWithError(ws, 1003, 'Binary frames are not supported');
      return;
    }

    const raw = typeof data === 'string' ? data : data.toString();
    if (Buffer.byteLength(raw) > this.options.maxMessageBytes) {
      this.metrics.rejectedMessages += 1;
      this.closeWithError(ws, 1009, 'Message exceeds max size');
      return;
    }

    const now = Date.now();
    if (now >= meta.resetAt) {
      meta.resetAt = now + this.options.rateLimitWindowMs;
      meta.messageCount = 0;
    }
    meta.messageCount += 1;
    if (meta.messageCount > this.options.maxMessagesPerWindow) {
      this.metrics.rejectedMessages += 1;
      this.closeWithError(ws, 1008, 'Rate limit exceeded');
      return;
    }

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.metrics.rejectedMessages += 1;
      this.closeWithError(ws, 1003, 'Invalid JSON payload');
      return;
    }

    const validation = this.validateMessage(message, meta);
    if (!validation.valid) {
      this.metrics.rejectedMessages += 1;
      this.sendError(ws, validation.error);
      return;
    }

    meta.lastSeen = Date.now();
    this.metrics.messagesReceived += 1;

    switch (message.type) {
      case 'join':
        this.handleJoin(ws, message, meta);
        break;
      case 'leave':
        this.removePeer(meta.peerId, meta.roomId, {
          closeSocket: false,
          reason: 'leave'
        });
        break;
      case 'heartbeat':
        this.handleHeartbeat(meta);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.handleSignaling(message, meta);
        break;
      case 'relay-message':
        this.handleRelayMessage(message, meta);
        break;
      default:
        this.metrics.rejectedMessages += 1;
        this.sendError(ws, `Unsupported message type: ${message.type}`);
    }
  }

  validateMessage(message, meta) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { valid: false, error: 'Message must be a JSON object' };
    }

    const type = String(message.type || '').trim();
    if (!SIGNALING_MESSAGE_TYPES.has(type)) {
      return { valid: false, error: `Unsupported message type: ${type || 'unknown'}` };
    }

    if (type === 'join') {
      return this.validateJoin(message, meta);
    }

    if (!meta.peerId || !meta.roomId) {
      return { valid: false, error: 'Join is required before signaling' };
    }

    if (message.peerId !== meta.peerId) {
      return { valid: false, error: 'peerId does not match the current connection' };
    }

    if (message.roomId && message.roomId !== meta.roomId) {
      return { valid: false, error: 'roomId does not match the current connection' };
    }

    if (type === 'leave' || type === 'heartbeat') {
      return { valid: true };
    }

    if (!PEER_ID_PATTERN.test(String(message.targetPeer || ''))) {
      return { valid: false, error: 'targetPeer is required' };
    }

    if (type === 'relay-message') {
      if (!message.envelope || typeof message.envelope !== 'object' || Array.isArray(message.envelope)) {
        return { valid: false, error: 'envelope payload is required' };
      }
      if (!this.validateRelayEnvelope(message.envelope)) {
        return { valid: false, error: 'relay envelope is invalid' };
      }
      return { valid: true };
    }

    if (type === 'offer' && !message.offer) {
      return { valid: false, error: 'offer payload is required' };
    }

    if (type === 'answer' && !message.answer) {
      return { valid: false, error: 'answer payload is required' };
    }

    if (type === 'ice-candidate' && !message.candidate) {
      return { valid: false, error: 'candidate payload is required' };
    }

    return { valid: true };
  }

  validateJoin(message, meta) {
    const { peerId, roomId, token, metadata } = message;

    if (!peerId || !roomId) {
      return { valid: false, error: 'Missing peerId or roomId' };
    }

    if (!PEER_ID_PATTERN.test(String(peerId))) {
      return { valid: false, error: 'peerId is invalid' };
    }

    if (!ROOM_ID_PATTERN.test(String(roomId))) {
      return { valid: false, error: 'roomId is invalid' };
    }

    const expectedToken = String(roomId).replace('reploid-swarm-', '');
    if (!token || token !== expectedToken) {
      return { valid: false, error: 'Unauthorized room access' };
    }

    const existingRoom = this.rooms.get(roomId);
    const existingPeer = this.peers.get(peerId);
    if (!existingRoom && this.rooms.size >= this.options.maxRooms) {
      return { valid: false, error: 'Room limit reached' };
    }

    if (!existingPeer && this.peers.size >= this.options.maxPeersTotal) {
      return { valid: false, error: 'Peer limit reached' };
    }

    if (
      existingRoom
      && existingRoom.size >= this.options.maxPeersPerRoom
      && (!existingPeer || existingPeer.roomId !== roomId)
    ) {
      return { valid: false, error: 'Room capacity reached' };
    }

    if (meta.peerId && meta.peerId !== peerId) {
      return { valid: false, error: 'Connection is already bound to a different peerId' };
    }

    if (metadata !== undefined && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      return { valid: false, error: 'metadata must be an object' };
    }

    return { valid: true };
  }

  handleJoin(ws, message, meta) {
    const { peerId, roomId, metadata } = message;

    const oldPeer = this.peers.get(peerId);
    if (oldPeer && oldPeer.ws !== ws) {
      this.removePeer(peerId, oldPeer.roomId, {
        closeSocket: true,
        closeCode: 4000,
        closeReason: 'Peer session replaced',
        reason: 'replaced'
      });
    }

    if (meta.roomId && meta.roomId !== roomId && meta.peerId === peerId) {
      const priorRoom = this.rooms.get(meta.roomId);
      if (priorRoom) {
        priorRoom.delete(peerId);
        if (priorRoom.size === 0) {
          this.rooms.delete(meta.roomId);
        }
      }
    }

    const room = this.rooms.get(roomId) || new Set();
    const peers = Array.from(room).filter((id) => id !== peerId);
    room.add(peerId);
    this.rooms.set(roomId, room);

    const sanitizedMetadata = sanitizeMetadata(metadata);
    this.peers.set(peerId, {
      ws,
      roomId,
      lastSeen: Date.now(),
      metadata: sanitizedMetadata
    });

    meta.peerId = peerId;
    meta.roomId = roomId;
    meta.lastSeen = Date.now();

    this.sendMessage(ws, {
      type: 'joined',
      peerId,
      roomId,
      peers,
      timestamp: Date.now()
    });

    this.broadcastToRoom(roomId, {
      type: 'peer-joined',
      peerId,
      metadata: sanitizedMetadata,
      timestamp: Date.now()
    }, peerId);

    this.emit('peer-joined', { peerId, roomId, metadata: sanitizedMetadata });
    this.syncVirtualPeers(ws, roomId, peerId);
  }

  handleHeartbeat(meta) {
    const peer = this.peers.get(meta.peerId);
    if (peer) {
      peer.lastSeen = Date.now();
    }
  }

  handleSignaling(message, meta) {
    const sourcePeer = this.peers.get(meta.peerId);
    const targetPeer = this.peers.get(message.targetPeer);
    if (!sourcePeer) {
      return;
    }

    if (!targetPeer) {
      this.sendError(sourcePeer.ws, 'Target peer is not available');
      return;
    }

    if (targetPeer.roomId !== meta.roomId || sourcePeer.roomId !== meta.roomId) {
      this.sendError(sourcePeer.ws, 'Peers must be in the same room');
      return;
    }

    const forwarded = {
      type: message.type,
      peerId: meta.peerId,
      targetPeer: message.targetPeer,
      timestamp: Date.now()
    };

    if (message.type === 'offer') {
      forwarded.offer = message.offer;
    } else if (message.type === 'answer') {
      forwarded.answer = message.answer;
    } else if (message.type === 'ice-candidate') {
      forwarded.candidate = message.candidate;
    }

    sourcePeer.lastSeen = Date.now();
    targetPeer.lastSeen = Date.now();
    this.metrics.messagesForwarded += 1;
    this.sendMessage(targetPeer.ws, forwarded);
  }

  validateRelayEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return false;
    }

    if (Number(envelope.protocolVersion) !== RELAY_PROTOCOL_VERSION) {
      return false;
    }

    const type = String(envelope.type || '').trim();
    if (!RELAY_MESSAGE_TYPES.has(type)) {
      return false;
    }

    if (!PEER_ID_PATTERN.test(String(envelope.peerId || ''))) {
      return false;
    }

    if (typeof envelope.timestamp !== 'number') {
      return false;
    }

    if (envelope.payload !== undefined && (typeof envelope.payload !== 'object' || envelope.payload === null || Array.isArray(envelope.payload))) {
      return false;
    }

    return Buffer.byteLength(JSON.stringify(envelope)) <= this.options.maxMessageBytes;
  }

  getVirtualPeersForRoom(roomId) {
    return this.virtualPeers.filter((peer) => {
      if (!peer) return false;
      if (peer.available === false) return false;
      if (typeof peer.matchesRoom === 'function') {
        try {
          return !!peer.matchesRoom(roomId);
        } catch (error) {
          this.log('error', `Virtual peer matcher failed for ${peer.peerId}`, error);
          return false;
        }
      }
      return true;
    });
  }

  getVirtualPeer(roomId, peerId) {
    return this.getVirtualPeersForRoom(roomId).find((peer) => peer.peerId === peerId) || null;
  }

  syncVirtualPeers(ws, roomId, targetPeerId) {
    const virtualPeers = this.getVirtualPeersForRoom(roomId);
    virtualPeers.forEach((peer) => {
      const metadata = sanitizeMetadata(
        typeof peer.getMetadata === 'function' ? peer.getMetadata(roomId) : peer.metadata
      );

      this.sendMessage(ws, {
        type: 'peer-joined',
        peerId: peer.peerId,
        metadata,
        timestamp: Date.now()
      });

      if (typeof peer.onPeerJoined === 'function') {
        Promise.resolve(peer.onPeerJoined({
          roomId,
          targetPeerId,
          metadata,
          sendEnvelope: (remotePeerId, envelope) => this.sendRelayedEnvelope(remotePeerId, roomId, peer.peerId, envelope)
        })).catch((error) => {
          this.log('error', `Virtual peer join hook failed for ${peer.peerId}`, error);
        });
      }
    });
  }

  handleRelayMessage(message, meta) {
    const sourcePeer = this.peers.get(meta.peerId);
    if (!sourcePeer) return;

    const virtualPeer = this.getVirtualPeer(meta.roomId, message.targetPeer);
    if (virtualPeer) {
      sourcePeer.lastSeen = Date.now();
      this.metrics.messagesForwarded += 1;

      if (typeof virtualPeer.onMessage === 'function') {
        Promise.resolve(virtualPeer.onMessage({
          roomId: meta.roomId,
          sourcePeerId: meta.peerId,
          envelope: message.envelope,
          sendEnvelope: (remotePeerId, envelope) => this.sendRelayedEnvelope(remotePeerId, meta.roomId, virtualPeer.peerId, envelope)
        })).catch((error) => {
          this.log('error', `Virtual peer message hook failed for ${virtualPeer.peerId}`, error);
          this.sendRelayedEnvelope(meta.peerId, meta.roomId, virtualPeer.peerId, {
            protocolVersion: RELAY_PROTOCOL_VERSION,
            type: 'reploid:generation-error',
            peerId: virtualPeer.peerId,
            timestamp: Date.now(),
            payload: {
              requestId: String(message.envelope?.payload?.requestId || ''),
              error: error?.message || 'Virtual peer execution failed'
            },
            payloadSize: 0
          });
        });
      }
      return;
    }

    const targetPeer = this.peers.get(message.targetPeer);
    if (!targetPeer) {
      this.sendError(sourcePeer.ws, 'Target peer is not available');
      return;
    }

    if (targetPeer.roomId !== meta.roomId || sourcePeer.roomId !== meta.roomId) {
      this.sendError(sourcePeer.ws, 'Peers must be in the same room');
      return;
    }

    sourcePeer.lastSeen = Date.now();
    targetPeer.lastSeen = Date.now();
    this.metrics.messagesForwarded += 1;
    this.sendMessage(targetPeer.ws, {
      type: 'relay-message',
      peerId: meta.peerId,
      targetPeer: message.targetPeer,
      envelope: message.envelope,
      timestamp: Date.now()
    });
  }

  sendRelayedEnvelope(targetPeerId, roomId, sourcePeerId, envelope) {
    const targetPeer = this.peers.get(targetPeerId);
    if (!targetPeer || targetPeer.roomId !== roomId) {
      return false;
    }

    this.metrics.messagesForwarded += 1;
    this.sendMessage(targetPeer.ws, {
      type: 'relay-message',
      peerId: sourcePeerId,
      targetPeer: targetPeerId,
      envelope,
      timestamp: Date.now()
    });
    return true;
  }

  closeWithError(ws, code, message) {
    this.sendError(ws, message);
    try {
      ws.close(code, toErrorLine(message).slice(0, 120));
    } catch {
      // Ignore close failures.
    }
  }

  removePeer(peerId, roomId, options = {}) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    this.peers.delete(peerId);

    const targetRoomId = roomId || peer.roomId;
    const room = this.rooms.get(targetRoomId);
    if (room) {
      room.delete(peerId);
      if (room.size === 0) {
        this.rooms.delete(targetRoomId);
      } else {
        this.broadcastToRoom(targetRoomId, {
          type: 'peer-left',
          peerId,
          timestamp: Date.now()
        });
      }
    }

    const meta = this.connectionMeta.get(peer.ws);
    if (meta?.peerId === peerId) {
      meta.peerId = null;
      meta.roomId = null;
    }

    if (options.closeSocket && peer.ws.readyState === WebSocket.OPEN) {
      try {
        peer.ws.close(options.closeCode || 1000, options.closeReason || 'Closing peer');
      } catch {
        // Ignore close failures.
      }
    }

    this.emit('peer-left', { peerId, roomId: targetRoomId, reason: options.reason || null });
  }

  broadcastToRoom(roomId, message, excludePeerId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let sent = 0;
    room.forEach((peerId) => {
      if (peerId === excludePeerId) return;
      const peer = this.peers.get(peerId);
      if (peer && peer.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(peer.ws, message);
        sent += 1;
      }
    });

    return sent;
  }

  sendMessage(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const payload = JSON.stringify(message);
      ws.send(payload);
      this.metrics.messagesSent += 1;
    } catch (error) {
      this.log('error', 'Failed to send message', error);
    }
  }

  sendError(ws, errorMessage) {
    this.sendMessage(ws, {
      type: 'error',
      error: toErrorLine(errorMessage),
      timestamp: Date.now()
    });
  }

  startHeartbeatMonitor() {
    this.stopHeartbeatMonitor();
    this.heartbeatMonitor = setInterval(() => {
      const now = Date.now();
      const staleThreshold = now - this.options.peerTimeout;

      const stalePeers = [];
      this.peers.forEach((peer, peerId) => {
        if (peer.lastSeen < staleThreshold) {
          stalePeers.push({ peerId, roomId: peer.roomId });
        }
      });

      stalePeers.forEach(({ peerId, roomId }) => {
        this.removePeer(peerId, roomId, {
          closeSocket: true,
          closeCode: 4001,
          closeReason: 'Peer timeout',
          reason: 'timeout'
        });
      });
    }, this.options.heartbeatInterval);
  }

  stopHeartbeatMonitor() {
    if (!this.heartbeatMonitor) return;
    clearInterval(this.heartbeatMonitor);
    this.heartbeatMonitor = null;
  }

  getStats() {
    return {
      path: this.options.path,
      localOnly: this.options.localOnly,
      totalRooms: this.rooms.size,
      totalPeers: this.peers.size,
      maxPeersPerRoom: this.options.maxPeersPerRoom,
      maxPeersTotal: this.options.maxPeersTotal,
      maxRooms: this.options.maxRooms,
      messagesReceived: this.metrics.messagesReceived,
      messagesSent: this.metrics.messagesSent,
      messagesForwarded: this.metrics.messagesForwarded,
      rejectedMessages: this.metrics.rejectedMessages,
      rejectedConnections: this.metrics.rejectedConnections,
      uptime: Date.now() - this.metrics.startedAt,
      rooms: Array.from(this.rooms.entries()).map(([roomId, peers]) => ({
        roomId,
        peerCount: peers.size,
        peers: Array.from(peers),
        virtualPeers: this.getVirtualPeersForRoom(roomId).map((peer) => peer.peerId)
      })),
      virtualPeers: this.virtualPeers.map((peer) => ({
        peerId: peer.peerId,
        metadata: sanitizeMetadata(
          typeof peer.getMetadata === 'function' ? peer.getMetadata() : peer.metadata
        )
      }))
    };
  }

  close() {
    this.stopHeartbeatMonitor();
    const openPeers = Array.from(this.peers.values());
    this.rooms.clear();
    this.peers.clear();

    for (const peer of openPeers) {
      this.sendMessage(peer.ws, { type: 'server-shutdown', timestamp: Date.now() });
      try {
        peer.ws.close();
      } catch {
        // Ignore close failures.
      }
    }

    this.wss.close();
  }
}

export default SignalingServer;
