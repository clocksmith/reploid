const CHAT_MAX_LENGTH = 280;
const AUDIT_PROTOCOL = 'security-audit-v1';
const AUDIT_SPEC = '2026-03-12';
const TRYSTERO_MODULE_URL = 'https://esm.run/trystero/nostr';
const TRYSTERO_APP_ID = 'reploid-openclaw-audit';

function summarizeFindings(findings = []) {
  return findings.reduce(
    (summary, finding) => {
      summary.total += 1;
      if (finding.severity === 'critical') summary.critical += 1;
      else summary.warning += 1;
      return summary;
    },
    { total: 0, critical: 0, warning: 0 }
  );
}

function clampText(value, max = 160) {
  return String(value || '').slice(0, max);
}

function sanitizeSnapshot(snapshot) {
  const rawFindings = Array.isArray(snapshot?.findings) ? snapshot.findings : [];
  const findings = rawFindings.slice(0, 20).map((finding) => ({
    severity: finding?.severity === 'critical' ? 'critical' : 'warning',
    code: clampText(finding?.code, 64),
    summary: clampText(finding?.summary, 220),
    surface: clampText(finding?.surface, 80),
    subject: clampText(finding?.subject, 80),
    remediation: clampText(finding?.remediation, 220)
  }));
  return {
    actor: {
      alias: clampText(snapshot?.actor?.alias, 48),
      peerId: clampText(snapshot?.actor?.peerId, 48)
    },
    generatedAt: clampText(snapshot?.generatedAt, 48),
    summary: summarizeFindings(findings),
    findings
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
    this.room = null;
    this.peers = new Map();
    this.latestSnapshot = null;
    this.modulePromise = null;
    this.sendHello = null;
    this.sendSnapshot = null;
    this.sendChat = null;
    this.sendRequest = null;
  }

  emit(type, detail = {}) {
    this.onEvent(type, detail);
  }

  async loadModule() {
    if (!this.modulePromise) {
      this.modulePromise = import(TRYSTERO_MODULE_URL);
    }
    return this.modulePromise;
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
    this.disconnect();

    this.alias = alias || this.alias;
    this.roomId = roomId;
    this.emit('signaling-state', { state: 'connecting' });

    const trystero = await this.loadModule();
    const { joinRoom, selfId, getRelaySockets } = trystero;

    this.room = joinRoom({ appId: TRYSTERO_APP_ID }, roomId, (error) => {
      this.emit('log', {
        level: 'error',
        message: `Relay join error: ${error?.message || 'unknown error'}`
      });
      this.emit('signaling-state', { state: 'error' });
    });

    this.peerId = selfId || this.peerId;

    this.room.onPeerJoin((peerId) => {
      const existing = this.peers.get(peerId) || {
        peerId,
        alias: peerId,
        state: 'connected',
        snapshot: null
      };
      existing.state = 'connected';
      this.peers.set(peerId, existing);
      this.emit('log', { level: 'info', message: `${existing.alias} joined the room` });
      this.emit('peer-state', { peers: this.getPeerList() });

      this.sendHello?.({
        alias: this.alias,
        peerId: this.peerId,
        protocol: AUDIT_PROTOCOL,
        spec: AUDIT_SPEC
      }, peerId);

      if (this.latestSnapshot) {
        this.sendSnapshot?.({ snapshot: this.latestSnapshot }, peerId);
      }
    });

    this.room.onPeerLeave((peerId) => {
      this.peers.delete(peerId);
      this.emit('log', { level: 'info', message: `${peerId} left the room` });
      this.emit('peer-state', { peers: this.getPeerList() });
    });

    const [sendHello, getHello] = this.room.makeAction('hello');
    const [sendSnapshot, getSnapshot] = this.room.makeAction('audit-snapshot');
    const [sendChat, getChat] = this.room.makeAction('chat-message');
    const [sendRequest, getRequest] = this.room.makeAction('audit-request');
    this.sendHello = sendHello;
    this.sendSnapshot = sendSnapshot;
    this.sendChat = sendChat;
    this.sendRequest = sendRequest;

    getHello((data, peerId) => {
      const peer = this.peers.get(peerId) || {
        peerId,
        alias: peerId,
        state: 'connected',
        snapshot: null
      };
      peer.alias = clampText(data?.alias || peer.alias, 48);
      peer.state = 'connected';
      this.peers.set(peerId, peer);
      this.emit('peer-state', { peers: this.getPeerList() });
    });

    getSnapshot((payload, peerId) => {
      const peer = this.peers.get(peerId) || {
        peerId,
        alias: peerId,
        state: 'connected',
        snapshot: null
      };
      peer.snapshot = sanitizeSnapshot(payload?.snapshot);
      this.peers.set(peerId, peer);
      this.emit('peer-report', {
        peerId,
        alias: peer.alias,
        snapshot: peer.snapshot
      });
      this.emit('peer-state', { peers: this.getPeerList() });
    });

    getChat((payload, peerId) => {
      const peer = this.peers.get(peerId) || {
        peerId,
        alias: peerId,
        state: 'connected',
        snapshot: null
      };
      this.peers.set(peerId, peer);
      this.emit('chat-message', {
        peerId,
        alias: peer.alias,
        message: sanitizeChatMessage(payload?.message)
      });
    });

    getRequest((payload, peerId) => {
      const peer = this.peers.get(peerId) || {
        peerId,
        alias: peerId,
        state: 'connected',
        snapshot: null
      };
      this.peers.set(peerId, peer);
      this.emit('audit-request', {
        peerId,
        alias: peer.alias,
        request: {
          requestedBy: clampText(payload?.requestedBy, 48),
          roomId: clampText(payload?.roomId, 48),
          note: clampText(payload?.note, 220),
          sentAt: clampText(payload?.sentAt, 48)
        }
      });
    });

    queueMicrotask(() => {
      this.sendHello?.({
        alias: this.alias,
        peerId: this.peerId,
        protocol: AUDIT_PROTOCOL,
        spec: AUDIT_SPEC
      });

      if (this.latestSnapshot) {
        this.sendSnapshot?.({ snapshot: this.latestSnapshot });
      }
    });

    this.emit('signaling-state', { state: 'connected' });

    const relays = typeof getRelaySockets === 'function' ? getRelaySockets() : {};
    const relayCount = Object.keys(relays || {}).length;
    this.emit('log', {
      level: 'info',
      message: relayCount
        ? `Joined room ${roomId} via ${relayCount} public relay socket${relayCount === 1 ? '' : 's'}`
        : `Joined room ${roomId} via public relay strategy`
    });
  }

  disconnect() {
    try {
      this.room?.leave();
    } catch {}

    this.room = null;
    this.sendHello = null;
    this.sendSnapshot = null;
    this.sendChat = null;
    this.sendRequest = null;
    this.peers.clear();
    this.emit('peer-state', { peers: this.getPeerList() });
    this.emit('signaling-state', { state: 'disconnected' });
  }

  broadcastSnapshot(snapshot) {
    this.latestSnapshot = snapshot;
    this.sendSnapshot?.({ snapshot });
  }

  broadcastChatMessage(message) {
    const sanitized = sanitizeChatMessage(message);
    if (!sanitized.body) return;
    this.sendChat?.({ message: sanitized });
  }

  broadcastAuditRequest(request) {
    this.sendRequest?.({
      requestedBy: clampText(request?.requestedBy, 48),
      roomId: clampText(request?.roomId, 48),
      note: clampText(request?.note, 220),
      sentAt: clampText(request?.sentAt, 48)
    });
  }
}
