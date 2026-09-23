import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import policy from '../../self/config/swarm-bootstrap.json' with { type: 'json' };

async function fixture(limits = {}) {
  const signaling = new PublicSwarmServer({ policy: { ...policy, server: { ...policy.server, ...limits } }, logger: { log() {}, error() {} } });
  const server = http.createServer();
  server.on('upgrade', (...args) => signaling.handleUpgrade(...args));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/swarm`;
  const sockets = [];
  const open = async (scope = 'public') => {
    const ws = new WebSocket(url + '?scope=' + scope, { origin: 'https://replo.id' });
    sockets.push(ws); const messages = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await once(ws, 'open');
    return { ws, messages, send: message => ws.send(JSON.stringify(message)) };
  };
  const close = async () => { sockets.forEach(ws => ws.terminate()); signaling.close(); await new Promise(resolve => server.close(resolve)); };
  return { url, signaling, open, close };
}
const publicJoin = peerId => ({ type: 'join', peerId, roomId: policy.publicRoomId, token: policy.publicJoinMarker });
const wait = async (peer, type) => { await expect.poll(() => peer.messages.find(m => m.type === type)).toBeTruthy(); return peer.messages.find(m => m.type === type); };

describe('public discovery signaling, not application relay', () => {
  it('joins the shared namespace and forwards negotiation only between its members', async () => {
    const f = await fixture();
    try {
      const a = await f.open(), b = await f.open();
      a.send(publicJoin('peer-a')); await wait(a, 'joined');
      b.send(publicJoin('peer-b')); expect((await wait(b, 'joined')).peers).toEqual(['peer-a']);
      a.send({ type: 'offer', peerId: 'peer-a', targetPeer: 'peer-b', offer: { type: 'offer', sdp: 'sdp' } });
      expect((await wait(b, 'offer')).peerId).toBe('peer-a');
      a.send({ type: 'relay-message', peerId: 'peer-a', targetPeer: 'peer-b', envelope: {} });
      expect((await wait(a, 'error')).error).toContain('does not relay');
      expect(b.messages.some(m => m.type === 'relay-message')).toBe(false);
    } finally { await f.close(); }
  });

  it('isolates private capabilities and denies public/private cross-scope joins and offers', async () => {
    const f = await fixture();
    try {
      const a = await f.open('private'), b = await f.open('private'), publicPeer = await f.open();
      const invite = { type: 'join', peerId: 'private-a', roomId: 'reploid-swarm-private', token: 'a'.repeat(32) };
      a.send(invite); await wait(a, 'joined');
      b.send({ ...invite, peerId: 'private-b', token: 'b'.repeat(32) });
      expect((await wait(b, 'error')).error).toContain('Unauthorized');
      publicPeer.send({ ...invite, peerId: 'public-a' });
      expect((await wait(publicPeer, 'error')).error).toContain('Public namespace');
      publicPeer.send(publicJoin('public-a')); await wait(publicPeer, 'joined');
      publicPeer.messages.length = 0;
      publicPeer.send({ type: 'offer', peerId: 'public-a', targetPeer: 'private-a', offer: {} });
      expect((await wait(publicPeer, 'error')).error).toContain('same room');
      b.messages.length = 0; b.send(publicJoin('private-b'));
      expect((await wait(b, 'error')).error).toContain('Private invitation');
    } finally { await f.close(); }
  });

  it('rejects absent or non-exact origins', async () => {
    const f = await fixture();
    try {
      for (const origin of [undefined, 'https://replo.id.evil.example']) {
        const ws = new WebSocket(f.url + '?scope=public', { origin });
        const status = await new Promise((resolve, reject) => {
          ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); req.destroy(); });
          ws.on('error', () => {}); ws.on('open', () => reject(new Error('Unexpected admission')));
        });
        expect(status).toBe(403);
      }
    } finally { await f.close(); }
  });

  it('bounds unjoined connections and message rates', async () => {
    const f = await fixture({ joinTimeoutMs: 40, maxMessagesPerWindow: 2 });
    try {
      const a = await f.open(); const closed = once(a.ws, 'close');
      expect((await closed)[0]).toBe(1008);
      const b = await f.open(); b.send(publicJoin('rate-peer')); await wait(b, 'joined');
      const limited = once(b.ws, 'close');
      for (let i = 0; i < 3; i++) b.send({ type: 'heartbeat', peerId: 'rate-peer' });
      expect((await limited)[0]).toBe(1008);
    } finally { await f.close(); }
  });

  it('bounds frames and total connections', async () => {
    const f = await fixture({ maxMessageBytes: 256, maxConnections: 1 });
    try {
      const a = await f.open();
      const status = await new Promise(resolve => {
        const b = new WebSocket(f.url + '?scope=public', { origin: 'https://replo.id' });
        b.on('unexpected-response', (req, res) => { resolve(res.statusCode); req.destroy(); }); b.on('error', () => {});
      });
      expect(status).toBe(429);
      const closed = once(a.ws, 'close'); a.ws.send('x'.repeat(257));
      expect((await closed)[0]).toBe(1009);
    } finally { await f.close(); }
  });
});
