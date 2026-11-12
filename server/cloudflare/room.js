/* global WebSocketPair */
import { DurableObject } from 'cloudflare:workers';
import bootstrap from '../../shared/config/swarm-bootstrap.json';
import { sha256Bytes as digest } from '../../packages/reploid/src/artifacts/signatures.js';
import {
  DISCOVERY_RELAY_ERROR, NEGOTIATION_FIELDS, allowsSwarmOrigin, boundIdentityError, discoveryJoinError,
  discoveryNamespace, forwardedNegotiation, frameError, joinIdentityError, negotiationError, parseFrame
} from '../swarm-protocol.js';

// Durable Object adapter over the shared signaling core (../swarm-protocol.js):
// this file keeps only hibernating sockets, capability storage, admission leases and alarms.
const limits = bootstrap.server;

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
    const join = discoveryNamespace(new URL(request.url).searchParams, bootstrap);
    if (!join || !allowsSwarmOrigin(request.headers.get('Origin'), bootstrap)) return new Response('Forbidden', { status: 403 });
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
      const bounded = frameError(raw, typeof raw !== 'string', limits.maxMessageBytes);
      if (bounded) return await this.reject(ws, bounded.error, bounded.code);
      const now = Date.now();
      if (now >= meta.resetAt) { meta.count = 0; meta.resetAt = now + limits.rateLimitWindowMs; }
      if (++meta.count > limits.maxMessagesPerWindow) return await this.reject(ws, 'Rate limit exceeded');
      ws.serializeAttachment(meta);
      const parsed = parseFrame(raw);
      if (parsed.error) return await this.reject(ws, parsed.error, parsed.code);
      const { message } = parsed;
      if (message.type === 'relay-message') return await this.reject(ws, DISCOVERY_RELAY_ERROR);
      if (message.type === 'join') return await this.join(ws, message);
      const identityError = meta.joining ? 'Join is required before signaling' : boundIdentityError(message, meta);
      if (identityError) return await this.reject(ws, identityError);
      meta.lastSeen = now;
      ws.serializeAttachment(meta);
      if (message.type === 'leave') return await this.retire(ws);
      if (message.type === 'heartbeat') {
        await this.arm(limits.heartbeatInterval);
        return;
      }
      if (!Object.hasOwn(NEGOTIATION_FIELDS, message.type)) return await this.reject(ws, `Unsupported message type: ${message.type || 'unknown'}`);
      const negotiation = negotiationError(message);
      if (negotiation) return await this.reject(ws, negotiation);
      const target = this.sockets().find(socket => socket.deserializeAttachment()?.peerId === message.targetPeer && !socket.deserializeAttachment()?.joining);
      if (!target) return await this.reject(ws, 'Target peer is not in this namespace');
      this.send(target, forwardedNegotiation(message, meta.peerId));
    } catch {
      console.error(JSON.stringify({ event: 'swarm-message-failed' }));
      await this.retire(ws, 1011, 'Discovery unavailable');
    }
  }

  async join(ws, message) {
    let meta = ws.deserializeAttachment();
    if (meta.joining || meta.peerId) return await this.reject(ws, 'Connection is already bound');
    const identityError = joinIdentityError(message) || discoveryJoinError(meta, message, bootstrap);
    if (identityError) return await this.reject(ws, identityError);
    const token = message.token;
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
    const now = Date.now(), at = now + delay, previous = await this.ctx.storage.getAlarm();
    // An overdue alarm may have exhausted retries during a storage outage.
    if (previous === null || previous <= now || previous > at) await this.ctx.storage.setAlarm(at);
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
    const remaining = this.sockets();
    if (remaining.length) {
      // The join timeout applies to pending joins, not every healthy peer.
      // Keep the earliest actual expiry and check lease validity each heartbeat.
      const now = Date.now();
      const delay = Math.min(limits.heartbeatInterval, ...remaining.map(ws => {
        const meta = ws.deserializeAttachment();
        const idleDeadline = meta.lastSeen + limits.peerTimeout;
        const deadline = !meta.peerId || meta.joining
          ? Math.min(idleDeadline, meta.connectedAt + limits.joinTimeoutMs) : idleDeadline;
        return Math.max(0, deadline - now);
      }));
      await this.arm(delay);
    }
  }
}
