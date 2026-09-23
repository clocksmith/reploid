import SignalingServer from './signaling-server.js';
import policy from '../self/config/swarm-bootstrap.json' with { type: 'json' };

/** Bounded rendezvous only. The legacy endpoint retains its original access gates. */
export class PublicSwarmServer extends SignalingServer {
  constructor(options = {}) {
    const bootstrap = options.policy || policy;
    super({ ...bootstrap.server, path: bootstrap.path, localOnly: false,
      allowedOrigins: bootstrap.allowedOrigins, logger: options.logger, virtualPeers: [] });
    this.bootstrap = bootstrap;
    this.joinTimers = new Map();
    this.connectionWindow = { end: 0, count: 0 };
  }

  handleUpgrade(req, socket, head) {
    const scope = new URL(req.url, 'http://swarm.invalid').searchParams.get('scope');
    if (!this.shouldHandle(req) || !['public', 'private'].includes(scope)) return this.rejectUpgrade(socket, 400, 'Invalid discovery scope');
    if (!this.bootstrap.allowedOrigins.includes(req.headers.origin)) return this.rejectUpgrade(socket, 403, 'Origin not allowed');
    const limits = this.bootstrap.server;
    const now = Date.now();
    if (now >= this.connectionWindow.end) this.connectionWindow = { end: now + limits.connectionWindowMs, count: 0 };
    if (++this.connectionWindow.count > limits.maxConnectionsPerWindow || this.wss.clients.size >= limits.maxConnections) {
      return this.rejectUpgrade(socket, 429, 'Discovery connection limit');
    }
    socket.setNoDelay?.(true);
    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
  }

  handleConnection(ws, req) {
    super.handleConnection(ws, req);
    const meta = this.connectionMeta.get(ws);
    meta.scope = new URL(req.url, 'http://swarm.invalid').searchParams.get('scope');
    const timer = setTimeout(() => {
      this.joinTimers.delete(ws);
      if (!meta.peerId) this.closeWithError(ws, 1008, 'Join deadline exceeded');
    }, this.bootstrap.server.joinTimeoutMs);
    this.joinTimers.set(ws, timer);
    ws.once('close', () => { clearTimeout(timer); this.joinTimers.delete(ws); });
  }

  validateJoin(message, meta) {
    if (meta.scope === 'public' && (message.roomId !== this.bootstrap.publicRoomId || message.token !== this.bootstrap.publicJoinMarker)) {
      return { valid: false, error: 'Public namespace required' };
    }
    if (meta.scope === 'private' && (message.roomId === this.bootstrap.publicRoomId || message.token === this.bootstrap.publicJoinMarker)) {
      return { valid: false, error: 'Private invitation capability required' };
    }
    if (meta.roomId && meta.roomId !== message.roomId) return { valid: false, error: 'Connection namespace is fixed' };
    return super.validateJoin(message, meta);
  }

  validateMessage(message, meta) {
    if (message?.type === 'relay-message') return { valid: false, error: 'Discovery does not relay application data' };
    return super.validateMessage(message, meta);
  }

  handleJoin(ws, message, meta) {
    super.handleJoin(ws, message, meta);
    if (meta.peerId) { clearTimeout(this.joinTimers.get(ws)); this.joinTimers.delete(ws); }
  }

  close() {
    for (const timer of this.joinTimers.values()) clearTimeout(timer);
    this.joinTimers.clear();
    for (const ws of this.wss.clients) ws.terminate();
    return super.close();
  }
}
