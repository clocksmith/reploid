import { DurableObject } from 'cloudflare:workers';
import bootstrap from '../../self/config/swarm-bootstrap.json';

const peerPattern = /^[a-z0-9][a-z0-9_-]{2,127}$/i;
export const roomPattern = /^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i;
const limits = bootstrap.server;
const encoder = new TextEncoder();
const digest = token => crypto.subtle.digest('SHA-256', encoder.encode(token));

export function namespace(url) {
  const scope = url.searchParams.get('scope');
  const roomId = url.searchParams.get('roomId') || (scope === 'public' ? bootstrap.publicRoomId : '');
  if (!['public', 'private'].includes(scope) || !roomPattern.test(roomId)) return null;
  if ((scope === 'public') !== (roomId === bootstrap.publicRoomId)) return null;
  return { scope, roomId };
}

export class SwarmRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS capability (id INTEGER PRIMARY KEY CHECK(id=1), hash BLOB NOT NULL)');
  }

  admission() { return this.env.ADMISSION.getByName('bounded-admission-v1'); }
  sockets() { return this.ctx.getWebSockets().filter(ws => !ws.deserializeAttachment()?.closed); }
  send(ws, message) { ws.send(JSON.stringify({ ...message, timestamp: Date.now() })); }
  broadcast(message, exclude) {
    for (const socket of this.sockets()) {
      if (socket !== exclude && socket.deserializeAttachment()?.peerId && !socket.deserializeAttachment()?.joining) {
        try { this.send(socket, message); } catch { this.ctx.waitUntil(this.retire(socket)); }
      }
    }
  }

  async fetch(request) {
    const join = namespace(new URL(request.url));
    if (!join || !bootstrap.allowedOrigins.includes(request.headers.get('Origin'))) return new Response('Forbidden', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.sockets().length >= limits.maxPeersPerRoom) return new Response('Room capacity reached', { status: 429 });
    const lease = await this.admission().reserve(join.roomId);
    if (!lease) return new Response('Discovery capacity reached', { status: 429 });
    // Recheck after asynchronous global admission.
    if (this.sockets().length >= limits.maxPeersPerRoom) {
      await this.admission().release(lease);
      return new Response('Room capacity reached', { status: 429 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...join, lease, peerId: null, closed: false,
      connectedAt: Date.now(), lastSeen: Date.now(), resetAt: Date.now() + limits.rateLimitWindowMs, count: 0 });
    await this.arm(limits.joinTimeoutMs);
    this.send(server, { type: 'welcome', path: bootstrap.path, localOnly: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (!meta || meta.closed) return;
    try {
      if (typeof raw !== 'string') return await this.reject(ws, 'Binary frames are not supported', 1003);
      if (encoder.encode(raw).byteLength > limits.maxMessageBytes) return await this.reject(ws, 'Message exceeds max size', 1009);
      const now = Date.now();
      if (now >= meta.resetAt) { meta.count = 0; meta.resetAt = now + limits.rateLimitWindowMs; }
      if (++meta.count > limits.maxMessagesPerWindow) return await this.reject(ws, 'Rate limit exceeded');
      ws.serializeAttachment(meta);
      let message;
      try { message = JSON.parse(raw); } catch { return await this.reject(ws, 'Invalid JSON payload', 1003); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return await this.reject(ws, 'Message must be an object');
      if (message.type === 'relay-message') return await this.reject(ws, 'Discovery does not relay application data');
      if (message.type === 'join') return await this.join(ws, message);
      if (!meta.peerId || meta.joining || message.peerId !== meta.peerId || (message.roomId && message.roomId !== meta.roomId)) return await this.reject(ws, 'Connection identity mismatch');
      meta.lastSeen = now;
      ws.serializeAttachment(meta);
      if (message.type === 'leave') return await this.retire(ws);
      if (message.type === 'heartbeat') return;
      if (!['offer', 'answer', 'ice-candidate'].includes(message.type) || !peerPattern.test(message.targetPeer)) return await this.reject(ws, 'Invalid negotiation message');
      const field = message.type === 'ice-candidate' ? 'candidate' : message.type;
      if (!message[field] || typeof message[field] !== 'object' || Array.isArray(message[field])) return await this.reject(ws, 'Invalid negotiation payload');
      const target = this.sockets().find(socket => socket.deserializeAttachment()?.peerId === message.targetPeer && !socket.deserializeAttachment()?.joining);
      if (!target) return await this.reject(ws, 'Target peer is not in this namespace');
      this.send(target, { type: message.type, peerId: meta.peerId, targetPeer: message.targetPeer, [field]: message[field] });
    } catch {
      console.error(JSON.stringify({ event: 'swarm-message-failed' }));
      await this.retire(ws, 1011, 'Discovery unavailable');
    }
  }

  async join(ws, message) {
    let meta = ws.deserializeAttachment();
    if (meta.joining || meta.peerId) return await this.reject(ws, 'Connection is already bound');
    if (typeof message.peerId !== 'string' || !peerPattern.test(message.peerId) || message.roomId !== meta.roomId) return await this.reject(ws, 'Invalid join identity');
    const token = message.token;
    if (typeof token !== 'string' || token.length < 32 || token.length > 1024) return await this.reject(ws, 'Invitation capability required');
    if ((meta.scope === 'public') !== (token === bootstrap.publicJoinMarker)) return await this.reject(ws, 'Discovery capability scope mismatch');
    meta.joining = true; ws.serializeAttachment(meta);
    const hash = await digest(token);
    meta = ws.deserializeAttachment();
    if (meta.closed) return;
    const previous = this.ctx.storage.sql.exec('SELECT hash FROM capability WHERE id=1').toArray()[0];
    if (previous && !crypto.subtle.timingSafeEqual(hash, previous.hash)) return await this.reject(ws, 'Unauthorized room access');
    if (this.sockets().some(socket => socket !== ws && socket.deserializeAttachment()?.peerId === message.peerId)) return await this.reject(ws, 'peerId is already connected');
    if (!previous) this.ctx.storage.sql.exec('INSERT INTO capability VALUES (1, ?)', hash);
    // Reserve identity before awaiting another actor, preventing duplicate join races.
    meta.peerId = message.peerId; ws.serializeAttachment(meta);
    if (!await this.admission().activate(meta.lease)) return await this.reject(ws, 'Peer capacity reached');
    meta = ws.deserializeAttachment();
    if (meta.closed) { await this.admission().release(meta.lease); return; }
    meta.joining = false; meta.lastSeen = Date.now(); ws.serializeAttachment(meta);
    const peers = this.sockets().filter(socket => socket !== ws).map(socket => socket.deserializeAttachment()).filter(peer => peer.peerId && !peer.joining).map(peer => peer.peerId);
    this.send(ws, { type: 'joined', peerId: meta.peerId, roomId: meta.roomId, peers });
    // No arbitrary metadata or application payload is distributed by discovery.
    this.broadcast({ type: 'peer-joined', peerId: meta.peerId, metadata: { capabilities: [] } }, ws);
  }

  async reject(ws, message, code = 1008) {
    try { this.send(ws, { type: 'error', error: message }); } catch { /* Socket may have closed. */ }
    await this.retire(ws, code, message);
  }

  async retire(ws, code = 1000, reason = 'Disconnected') {
    const meta = ws.deserializeAttachment();
    if (!meta || meta.closed) return;
    meta.closed = true; ws.serializeAttachment(meta);
    try { ws.close(code, reason); } catch { /* Already closed. */ }
    if (meta.peerId && !meta.joining) this.broadcast({ type: 'peer-left', peerId: meta.peerId }, ws);
    await this.admission().release(meta.lease);
  }
  async webSocketClose(ws) { await this.retire(ws); }
  async webSocketError(ws) { await this.retire(ws, 1011, 'Connection failed'); }

  async arm(delay) {
    const at = Date.now() + delay, previous = await this.ctx.storage.getAlarm();
    if (previous === null || previous > at) await this.ctx.storage.setAlarm(at);
  }
  async alarm() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const meta = ws.deserializeAttachment();
      if (((!meta.peerId || meta.joining) && now - meta.connectedAt >= limits.joinTimeoutMs)
        || now - meta.lastSeen >= limits.peerTimeout) await this.retire(ws, 4001, 'Discovery timeout');
    }
    const sockets = this.sockets();
    if (!sockets.length) return;
    const renewed = new Set(await this.admission().renew(sockets.map(ws => ws.deserializeAttachment().lease)));
    for (const ws of sockets) if (!renewed.has(ws.deserializeAttachment().lease)) await this.retire(ws, 4001, 'Admission expired');
    if (this.sockets().length) await this.arm(Math.min(limits.joinTimeoutMs, limits.heartbeatInterval));
  }
}
