const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
const CHAT_MAX_LENGTH = 280;
const AUDIT_PROTOCOL = 'security-audit-v1';
const AUDIT_SPEC = '2026-03-12';

function clampText(value, max = 160) {
  return String(value || '').slice(0, max);
}

function sanitizeSnapshot(snapshot) {
  const rawFindings = Array.isArray(snapshot?.findings) ? snapshot.findings : [];
  return {
    actor: {
      alias: clampText(snapshot?.actor?.alias, 48),
      peerId: clampText(snapshot?.actor?.peerId, 48)
    },
    generatedAt: clampText(snapshot?.generatedAt, 48),
    summary: {
      total: Number(snapshot?.summary?.total) || 0,
      critical: Number(snapshot?.summary?.critical) || 0,
      warning: Number(snapshot?.summary?.warning) || 0
    },
    findings: rawFindings.slice(0, 20).map((finding) => ({
      severity: finding?.severity === 'critical' ? 'critical' : 'warning',
      code: clampText(finding?.code, 64),
      summary: clampText(finding?.summary, 220),
      surface: clampText(finding?.surface, 80),
      subject: clampText(finding?.subject, 80),
      remediation: clampText(finding?.remediation, 220)
    }))
  };
}

function sanitizeChatMessage(message) {
  return {
    body: clampText(message?.body, CHAT_MAX_LENGTH),
    alias: clampText(message?.alias, 48),
    kind: message?.kind === 'warning' ? 'warning' : 'chat',
    sentAt: clampText(message?.sentAt, 48)
  };
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

export class AuditMesh {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.peerId = createId('audit');
    this.alias = 'runner';
    this.roomId = null;
    this.token = null;
    this.websocket = null;
    this.peers = new Map();
    this.heartbeatTimer = null;
    this.latestSnapshot = null;
    this.hasJoinedRoom = false;
  }

  emit(type, detail = {}) {
    this.onEvent(type, detail);
  }

  getSignalingUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/signaling`;
  }

  getPeerList() {
    return Array.from(this.peers.values()).map((peer) => ({
      peerId: peer.peerId,
      alias: peer.alias,
      state: peer.state,
      snapshot: peer.snapshot || null
    }));
  }

  async connect({ roomId, alias }) {
    if (this.websocket) {
      this.disconnect();
    }

    this.alias = alias || this.alias;
    this.token = roomId;
    this.roomId = `reploid-swarm-${roomId}`;
    this.hasJoinedRoom = false;

    await new Promise((resolve, reject) => {
      const websocket = new WebSocket(this.getSignalingUrl());
      this.websocket = websocket;

      websocket.onopen = () => {
        this.emit('signaling-state', { state: 'connecting' });
        websocket.send(
          JSON.stringify({
            type: 'join',
            peerId: this.peerId,
            roomId: this.roomId,
            token: this.token,
            metadata: {
              alias: this.alias,
              role: 'self-audit-runner',
              protocol: AUDIT_PROTOCOL,
              spec: AUDIT_SPEC
            }
          })
        );
        this.startHeartbeat();
      };

      websocket.onerror = (error) => {
        this.emit('log', { level: 'error', message: 'Signaling error', detail: error });
      };

      websocket.onclose = () => {
        this.stopHeartbeat();
        this.hasJoinedRoom = false;
        this.emit('signaling-state', { state: 'disconnected' });
        this.closeAllPeers();
      };

      websocket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleSignalingMessage(message);
        } catch (error) {
          this.emit('log', { level: 'error', message: 'Failed to parse signaling message', detail: error });
        }
      };

      setTimeout(() => {
        if (!this.hasJoinedRoom) {
          reject(new Error('Timed out while waiting for room join confirmation'));
        }
      }, 8000);

      this._resolveJoin = resolve;
      this._rejectJoin = reject;
    });
  }

  disconnect() {
    this.stopHeartbeat();
    this.closeAllPeers();
    if (this.websocket) {
      if (this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({ type: 'leave', peerId: this.peerId, roomId: this.roomId }));
      }
      this.websocket.close();
      this.websocket = null;
    }
  }

  async handleSignalingMessage(message) {
    switch (message.type) {
      case 'joined':
        this.hasJoinedRoom = true;
        this.emit('signaling-state', { state: 'connected' });
        this.emit('log', {
          level: 'info',
          message: `Joined room ${message.roomId}`,
          detail: { peers: message.peers?.length || 0 }
        });
        if (this._resolveJoin) {
          this._resolveJoin();
          this._resolveJoin = null;
          this._rejectJoin = null;
        }
        for (const remotePeerId of message.peers || []) {
          await this.connectToPeer(remotePeerId);
        }
        this.emit('peer-state', { peers: this.getPeerList() });
        break;

      case 'peer-joined':
        this.emit('log', {
          level: 'info',
          message: `${clampText(message.metadata?.alias || message.peerId, 48)} joined the room`
        });
        break;

      case 'peer-left':
        this.removePeer(message.peerId);
        this.emit('log', { level: 'info', message: `${message.peerId} left the room` });
        this.emit('peer-state', { peers: this.getPeerList() });
        break;

      case 'offer':
        await this.handleOffer(message.peerId, message.offer);
        break;

      case 'answer':
        await this.handleAnswer(message.peerId, message.answer);
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(message.peerId, message.candidate);
        break;

      case 'error':
        this.emit('log', { level: 'error', message: message.error || 'Signaling rejected the request' });
        if (!this.hasJoinedRoom && this._rejectJoin) {
          this._rejectJoin(new Error(message.error || 'Signaling rejected the request'));
          this._rejectJoin = null;
          this._resolveJoin = null;
        }
        break;

      default:
        break;
    }
  }

  sendSignaling(message) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
    this.websocket.send(JSON.stringify(message));
  }

  async connectToPeer(remotePeerId) {
    const existing = this.peers.get(remotePeerId);
    if (existing?.state === 'connected') return;
    if (existing) this.removePeer(remotePeerId);

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dataChannel = connection.createDataChannel('audit');
    const peer = {
      peerId: remotePeerId,
      alias: remotePeerId,
      connection,
      dataChannel,
      state: 'connecting',
      snapshot: null
    };

    this.peers.set(remotePeerId, peer);
    this.attachConnectionHandlers(peer);
    this.attachChannelHandlers(peer, dataChannel);

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.sendSignaling({
      type: 'offer',
      peerId: this.peerId,
      targetPeer: remotePeerId,
      offer
    });
  }

  async handleOffer(remotePeerId, offer) {
    this.removePeer(remotePeerId);

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = {
      peerId: remotePeerId,
      alias: remotePeerId,
      connection,
      dataChannel: null,
      state: 'connecting',
      snapshot: null
    };

    this.peers.set(remotePeerId, peer);
    this.attachConnectionHandlers(peer);

    connection.ondatachannel = (event) => {
      peer.dataChannel = event.channel;
      this.attachChannelHandlers(peer, event.channel);
    };

    await connection.setRemoteDescription(offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

    this.sendSignaling({
      type: 'answer',
      peerId: this.peerId,
      targetPeer: remotePeerId,
      answer
    });
  }

  async handleAnswer(remotePeerId, answer) {
    const peer = this.peers.get(remotePeerId);
    if (!peer) return;
    await peer.connection.setRemoteDescription(answer);
  }

  async handleIceCandidate(remotePeerId, candidate) {
    const peer = this.peers.get(remotePeerId);
    if (!peer || !candidate) return;
    try {
      await peer.connection.addIceCandidate(candidate);
    } catch (error) {
      this.emit('log', { level: 'warning', message: `ICE candidate rejected for ${remotePeerId}`, detail: error });
    }
  }

  attachConnectionHandlers(peer) {
    peer.connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignaling({
        type: 'ice-candidate',
        peerId: this.peerId,
        targetPeer: peer.peerId,
        candidate: event.candidate
      });
    };

    peer.connection.onconnectionstatechange = () => {
      const state = peer.connection.connectionState;
      peer.state = state === 'connected' ? 'connected' : 'connecting';
      if (['failed', 'closed', 'disconnected'].includes(state)) {
        this.removePeer(peer.peerId);
      }
      this.emit('peer-state', { peers: this.getPeerList() });
    };
  }

  attachChannelHandlers(peer, channel) {
    channel.onopen = () => {
      peer.state = 'connected';
      this.emit('peer-state', { peers: this.getPeerList() });
      this.sendToPeer(peer.peerId, {
        type: 'hello',
        alias: this.alias,
        peerId: this.peerId,
        protocol: AUDIT_PROTOCOL,
        spec: AUDIT_SPEC
      });
      if (this.latestSnapshot) {
        this.sendToPeer(peer.peerId, {
          type: 'audit-snapshot',
          snapshot: this.latestSnapshot
        });
      }
    };

    channel.onmessage = (event) => {
      this.handlePeerMessage(peer.peerId, event.data);
    };

    channel.onclose = () => {
      this.removePeer(peer.peerId);
      this.emit('peer-state', { peers: this.getPeerList() });
    };
  }

  handlePeerMessage(remotePeerId, rawData) {
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    const peer = this.peers.get(remotePeerId);
    if (!peer) return;

    if (message.type === 'hello') {
      peer.alias = clampText(message.alias || peer.alias, 48);
      this.emit('peer-state', { peers: this.getPeerList() });
      return;
    }

    if (message.type === 'audit-snapshot' && message.snapshot) {
      peer.snapshot = sanitizeSnapshot(message.snapshot);
      this.emit('peer-report', {
        peerId: remotePeerId,
        alias: peer.alias,
        snapshot: peer.snapshot
      });
      this.emit('peer-state', { peers: this.getPeerList() });
      return;
    }

    if (message.type === 'chat-message' && message.message) {
      this.emit('chat-message', {
        peerId: remotePeerId,
        alias: peer.alias,
        message: sanitizeChatMessage(message.message)
      });
    }
  }

  sendToPeer(remotePeerId, payload) {
    const peer = this.peers.get(remotePeerId);
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return false;
    peer.dataChannel.send(JSON.stringify(payload));
    return true;
  }

  broadcastSnapshot(snapshot) {
    this.latestSnapshot = snapshot;
    for (const peer of this.peers.values()) {
      this.sendToPeer(peer.peerId, {
        type: 'audit-snapshot',
        snapshot
      });
    }
  }

  broadcastChatMessage(message) {
    const sanitized = sanitizeChatMessage(message);
    if (!sanitized.body) return;
    for (const peer of this.peers.values()) {
      this.sendToPeer(peer.peerId, {
        type: 'chat-message',
        message: sanitized
      });
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendSignaling({
        type: 'heartbeat',
        peerId: this.peerId,
        roomId: this.roomId
      });
    }, 20000);
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  removePeer(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer) return;

    try {
      peer.dataChannel?.close();
    } catch {}
    try {
      peer.connection?.close();
    } catch {}

    this.peers.delete(remotePeerId);
  }

  closeAllPeers() {
    for (const peerId of this.peers.keys()) {
      this.removePeer(peerId);
    }
    this.emit('peer-state', { peers: this.getPeerList() });
  }
}
